import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { createComputeRuntime } from "../compute/runtime";

import type { ProductAgentSource } from "./agent";

const execFileAsync = promisify(execFile);
const maximumDocumentBytes = 25 * 1024 * 1024;

interface MarkItDownResult {
  source_text: string;
  document_sha256: string;
  filename: string;
  media_type: string;
  ocr_enabled?: boolean;
  layout_recovered_pages?: number[];
  conversion_status?: "converted" | "no_text";
}

export interface ProductAgentDocumentRequest {
  documentPath: string;
  recordId: string;
  imageAvailability: ProductAgentSource["image_availability"];
  imageRefs: string[];
  allowEmptySource?: boolean;
}

export interface ProductAgentDocumentSource {
  source: ProductAgentSource;
  document_sha256: string;
  filename: string;
  media_type: string;
  ocr_enabled: boolean;
  layout_recovered_pages: number[];
  conversion_status: "converted" | "no_text";
}

function markItDownPython() {
  return process.env.MARKITDOWN_PYTHON ?? "python3";
}

async function preprocessInVps(documentPath: string, allowEmptySource: boolean) {
  const simpleText = [".txt", ".md"].includes(extname(documentPath).toLowerCase());
  const light = simpleText && (await stat(documentPath)).size <= 1024 * 1024;
  const sandbox = await createComputeRuntime(light ? "light" : "heavy");
  try {
    await sandbox.fs.mkdir("/vercel/sandbox/work", { recursive: true });
    const input = `/vercel/sandbox/work/input${extname(documentPath).toLowerCase()}`;
    await sandbox.fs.writeFile(input, await readFile(documentPath));
    const result = await sandbox.runCommand({
      cmd: "/opt/markitdown/bin/python3",
      args: ["/opt/f-trade/markitdown_preprocess.py", input],
      cwd: "/vercel/sandbox",
      env: {
        F_TRADE_METADATA_PREFLIGHT: allowEmptySource ? "1" : "0",
        F_TRADE_LOCAL_OCR_ENABLED: process.env.F_TRADE_LOCAL_OCR_ENABLED === "1" ? "1" : "0",
        F_TRADE_LOCAL_OCR_LANGUAGE: process.env.F_TRADE_LOCAL_OCR_LANGUAGE ?? "eng",
      },
    });
    if (result.exitCode !== 0) {
      throw new Error(
        (await result.stderr()).trim().slice(0, 1_000) || "MarkItDown VPS preprocessing failed",
      );
    }
    return result.stdout();
  } finally {
    await sandbox.stop();
  }
}

export async function preprocessProductAgentDocument(
  request: ProductAgentDocumentRequest,
  execution: "vps" | "local-preflight" = "vps",
): Promise<ProductAgentDocumentSource> {
  if (request.imageAvailability !== "none" && request.imageAvailability !== "real_product_image") {
    throw new Error("Product Agent document image availability is invalid");
  }
  if (request.imageAvailability === "none" && request.imageRefs.length > 0) {
    throw new Error("No-image Product Agent document cannot include image references");
  }
  if (request.imageAvailability === "real_product_image" && request.imageRefs.length === 0) {
    throw new Error("Image-backed Product Agent document needs image references");
  }
  const documentPath = resolve(request.documentPath);
  const info = await stat(documentPath);
  if (!info.isFile()) throw new Error("Product Agent document input must be a regular local file");
  if (info.size > maximumDocumentBytes)
    throw new Error(`Product Agent document exceeds ${maximumDocumentBytes} byte limit`);

  // Only trusted CLI preflight callers opt in; application requests use VPS.
  z.enum(["vps", "local-preflight"]).parse(execution);
  const stdout =
    execution === "vps"
      ? await preprocessInVps(documentPath, request.allowEmptySource === true)
      : (
          await execFileAsync(
            markItDownPython(),
            [resolve("scripts/markitdown_preprocess.py"), documentPath],
            {
              maxBuffer: 32 * 1024 * 1024,
              env: {
                ...process.env,
                F_TRADE_METADATA_PREFLIGHT: request.allowEmptySource ? "1" : "0",
              },
            },
          )
        ).stdout;
  const converted = JSON.parse(stdout) as MarkItDownResult;
  const layoutPages = z
    .array(z.number().int().positive())
    .safeParse(converted.layout_recovered_pages ?? []);
  if (!layoutPages.success) {
    throw new Error("MarkItDown preprocessing returned invalid layout page metadata");
  }
  const conversionStatus = converted.conversion_status ?? "converted";
  if (
    !/^[a-f0-9]{64}$/.test(converted.document_sha256) ||
    (conversionStatus !== "converted" && conversionStatus !== "no_text") ||
    (!converted.source_text && (!request.allowEmptySource || conversionStatus !== "no_text"))
  ) {
    throw new Error("MarkItDown preprocessing returned an invalid conversion result");
  }

  const sourceRef = `document:${converted.document_sha256}`;
  return {
    source: {
      record_id: request.recordId,
      source_ref: sourceRef,
      evidence_refs: [sourceRef],
      source_text: converted.source_text,
      image_availability: request.imageAvailability,
      image_refs: request.imageRefs,
    },
    document_sha256: converted.document_sha256,
    filename: converted.filename || basename(documentPath),
    media_type: converted.media_type,
    ocr_enabled: converted.ocr_enabled === true,
    layout_recovered_pages: layoutPages.data,
    conversion_status: conversionStatus,
  };
}
