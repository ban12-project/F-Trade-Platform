import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";

import type { ProductAgentSource } from "./agent";

const execFileAsync = promisify(execFile);

interface MarkItDownResult {
  source_text: string;
  document_sha256: string;
  filename: string;
  media_type: string;
  ocr_enabled?: boolean;
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
  conversion_status: "converted" | "no_text";
}

function markItDownPython() {
  return process.env.MARKITDOWN_PYTHON ?? "python3";
}

export async function preprocessProductAgentDocument(
  request: ProductAgentDocumentRequest,
): Promise<ProductAgentDocumentSource> {
  if (
    request.imageAvailability !== "none" &&
    request.imageAvailability !== "real_product_image"
  ) {
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

  const { stdout } = await execFileAsync(markItDownPython(), [
    resolve("scripts/markitdown_preprocess.py"),
    documentPath,
  ], {
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      F_TRADE_METADATA_PREFLIGHT: request.allowEmptySource ? "1" : "0",
    },
  });
  const converted = JSON.parse(stdout) as MarkItDownResult;
  const conversionStatus = converted.conversion_status ?? "converted";
  if (
    !/^[a-f0-9]{64}$/.test(converted.document_sha256)
    || (conversionStatus !== "converted" && conversionStatus !== "no_text")
    || (!converted.source_text && (!request.allowEmptySource || conversionStatus !== "no_text"))
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
    conversion_status: conversionStatus,
  };
}
