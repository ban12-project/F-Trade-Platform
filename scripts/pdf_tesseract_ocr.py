"""Optional, process-isolated Tesseract 5.3.4 sessions for bounded cell OCR.

Models are reused within one page only. The parent enforces the same deadline
as the CLI path; no native library code runs in the converter process.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import multiprocessing
import os
import sys
import time

TSV_HEADER = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
MAX_CELL_PIXELS = 9_000_000


def _worker(connection, language):
    os.environ["OMP_THREAD_LIMIT"] = "1"
    handles = {}
    library = None
    try:
        path = ctypes.util.find_library("tesseract")
        if not path:
            raise OSError("Tesseract library unavailable")
        library = ctypes.CDLL(path)

        def bind(name, restype, *arguments):
            function = getattr(library, name)
            function.restype = restype
            function.argtypes = arguments
            return function

        pointer = ctypes.c_void_p
        integer = ctypes.c_int
        version = bind("TessVersion", ctypes.c_char_p)
        if version() != b"5.3.4":
            raise OSError("Unverified Tesseract library version")
        create = bind("TessBaseAPICreate", pointer)
        initialize = bind("TessBaseAPIInit3", integer, pointer, ctypes.c_char_p, ctypes.c_char_p)
        set_mode = bind("TessBaseAPISetPageSegMode", None, pointer, integer)
        set_image = bind("TessBaseAPISetImage", None, pointer, pointer, integer, integer, integer, integer)
        recognize = bind("TessBaseAPIRecognize", integer, pointer, pointer)
        get_tsv = bind("TessBaseAPIGetTsvText", pointer, pointer, integer)
        delete_text = bind("TessDeleteText", None, pointer)
        clear = bind("TessBaseAPIClear", None, pointer)
        clear_adaptive = bind("TessBaseAPIClearAdaptiveClassifier", None, pointer)
        bind("TessBaseAPIDelete", None, pointer)
        monitor_create = bind("TessMonitorCreate", pointer)
        monitor_deadline = bind("TessMonitorSetDeadlineMSecs", None, pointer, integer)
        monitor_delete = bind("TessMonitorDelete", None, pointer)
        connection.send(True)
        while True:
            request = connection.recv()
            if request is None:
                break
            width, height, channels, pixels, psm, data_directory, timeout = request
            if (type(width) is not int or type(height) is not int or min(width, height) < 1
                    or width * height > MAX_CELL_PIXELS or channels not in (1, 3)
                    or len(pixels) != width * height * channels or psm not in (6, 7, 8)):
                raise ValueError("Invalid bounded OCR request")
            handle = handles.get(data_directory)
            if handle is None:
                handle = create()
                if not handle:
                    raise OSError("Tesseract session allocation failed")
                handles[data_directory] = handle
                if initialize(handle, data_directory.encode() if data_directory else None, language.encode()):
                    raise OSError("Tesseract session initialization failed")
            clear_adaptive(handle)
            set_mode(handle, psm)
            buffer = ctypes.create_string_buffer(pixels)
            set_image(handle, buffer, width, height, channels, width * channels)
            monitor = monitor_create()
            if not monitor:
                raise OSError("Tesseract monitor allocation failed")
            monitor_deadline(monitor, max(1, int(timeout * 1000)))
            try:
                if recognize(handle, monitor):
                    # A damaged/too-small cell is a per-image recognition
                    # failure. Clear it before the next independent request;
                    # it must not discard a healthy model session for the page.
                    connection.send("unreadable")
                    continue
                result = get_tsv(handle, 0)
                if not result:
                    raise ValueError("Missing structured OCR output")
                try:
                    text = ctypes.string_at(result).decode("utf8")
                finally:
                    delete_text(result)
                if len(text) > 1_000_000:
                    raise ValueError("Oversized structured OCR output")
                connection.send(TSV_HEADER + text)
            finally:
                monitor_delete(monitor)
                clear(handle)
    except (OSError, ValueError, AttributeError, EOFError, BrokenPipeError):
        # No source content or native exception details cross this boundary.
        try:
            connection.send(False)
        except (OSError, EOFError):
            pass
    finally:
        if library:
            for handle in handles.values():
                library.TessBaseAPIDelete(handle)
        connection.close()


class CellOcrSession:
    def __init__(self, language, deadline):
        if language != "eng":
            raise ValueError("Reusable cell OCR is verified for English only")
        self.deadline = deadline
        self.connection = None
        self.process = None
        if not sys.platform.startswith("linux") or "fork" not in multiprocessing.get_all_start_methods():
            raise OSError("Reusable cell OCR requires the Linux document runtime")
        context = multiprocessing.get_context("fork")
        parent, child = context.Pipe()
        self.connection = parent
        self.process = context.Process(target=_worker, args=(child, language), daemon=True)
        try:
            self.process.start()
            child.close()
            if not parent.poll(max(0, min(5, deadline - time.monotonic()))) or parent.recv() is not True:
                raise OSError("Reusable cell OCR unavailable")
        except BaseException:
            child.close()
            self.close()
            raise

    def read(self, image, psm, data_directory=None):
        remaining = min(5, self.deadline - time.monotonic())
        if remaining <= 0:
            raise TimeoutError("Disc table OCR deadline exceeded")
        if not self.process or not self.process.is_alive():
            raise OSError("Cell OCR worker unavailable")
        if image.width * image.height > MAX_CELL_PIXELS:
            raise ValueError("Cell image exceeds OCR bound")
        with image.convert("L" if image.mode == "L" else "RGB") as readable:
            self.connection.send((readable.width, readable.height, 1 if readable.mode == "L" else 3,
                                  readable.tobytes(), psm, str(data_directory) if data_directory else None, remaining))
        if not self.connection.poll(max(0, min(remaining, self.deadline - time.monotonic()))):
            self.close()
            raise TimeoutError("Cell OCR worker timed out")
        try:
            response = self.connection.recv()
        except EOFError as error:
            self.close()
            raise OSError("Cell OCR worker stopped") from error
        if response == "unreadable":
            raise ValueError("Cell recognition failed")
        if not isinstance(response, str) or not response.startswith(TSV_HEADER):
            self.close()
            raise OSError("Cell OCR worker failed")
        return response

    def close(self):
        if self.connection:
            self.connection.close()
            self.connection = None
        if self.process and self.process.pid is not None:
            if self.process.is_alive():
                self.process.terminate()
            self.process.join(timeout=.2)
            if self.process.is_alive():
                self.process.kill()
                self.process.join(timeout=.2)
            self.process.close()
        self.process = None
