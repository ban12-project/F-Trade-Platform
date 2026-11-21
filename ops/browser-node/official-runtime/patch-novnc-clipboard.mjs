// The noVNC public paste API returns after Notify. X0tigervnc requests the
// bytes in a subsequent RFB round trip. Signal when Provide has been queued on
// the same socket so the following key events are ordered after the text.
import { readFileSync, writeFileSync } from "node:fs";

const path = "/usr/share/novnc/core/rfb.js";
let source = readFileSync(path, "utf8");
function replaceOnce(original, replacement) {
  if (source.split(original).length !== 2) throw new Error("unsupported_noVNC_clipboard_source");
  source = source.replace(original, replacement);
}
replaceOnce("clipboardPasteFrom(text) {", "clipboardPasteFrom(text, provided) {");
replaceOnce(
  "this._clipboardText = text;",
  "this._clipboardText = text;\n            this._clipboardProvided = provided;",
);
const provide =
  "RFB.messages.extendedClipboardProvide(this._sock, [extendedClipboardFormatText], [this._clipboardText]);";
replaceOnce(
  provide,
  `${provide}
                        const provided = this._clipboardProvided;
                        this._clipboardProvided = undefined;
                        provided?.();`,
);
const legacy = "RFB.messages.clientCutText(this._sock, data);";
replaceOnce(legacy, `${legacy}\n            provided?.();`);
writeFileSync(path, source);
