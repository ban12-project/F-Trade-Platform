import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { promisify } from "node:util";

import { Sandbox } from "@vercel/sandbox";

import type { ProductAgentSource } from "./agent";

const execFileAsync = promisify(execFile);
const maximumDocumentBytes = 25 * 1024 * 1024;

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

function productDocumentSandboxImage() {
  const image = (
    process.env.PRODUCT_DOCUMENT_SANDBOX_IMAGE ?? process.env.VIDEO_SANDBOX_IMAGE
  )?.trim();
  if (!image)
    throw new Error("Product Agent document preprocessing requires a pinned Sandbox image");
  return image;
}

function shouldUseProductDocumentSandbox() {
  return process.env.VERCEL === "1" || Boolean(process.env.PRODUCT_DOCUMENT_SANDBOX_IMAGE?.trim());
}

async function preprocessInSandbox(documentPath: string, allowEmptySource: boolean) {
  const sandbox = await Sandbox.create({
    image: productDocumentSandboxImage(),
    timeout: 10 * 60 * 1_000,
    resources: { vcpus: Number(process.env.PRODUCT_DOCUMENT_SANDBOX_VCPUS ?? 2) },
    networkPolicy: "deny-all",
    persistent: false,
  });
  try {
    await sandbox.fs.mkdir("/vercel/sandbox/work", { recursive: true });
    const input = `/vercel/sandbox/work/input${extname(documentPath).toLowerCase()}`;
    await sandbox.fs.writeFile(input, await readFile(documentPath));
    const result = await sandbox.runCommand({
      cmd: "/opt/markitdown/bin/python3",
      args: ["/opt/f-trade/markitdown_preprocess.py", input],
      cwd: "/vercel/sandbox",
      env: { F_TRADE_METADATA_PREFLIGHT: allowEmptySource ? "1" : "0" },
    });
    if (result.exitCode !== 0) {
      throw new Error(
        (await result.stderr()).trim().slice(0, 1_000) || "MarkItDown Sandbox preprocessing failed",
      );
    }
    return result.stdout();
  } finally {
    await sandbox.stop();
  }
}

export async function preprocessProductAgentDocument(
  request: ProductAgentDocumentRequest,
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

  const stdout = shouldUseProductDocumentSandbox()
    ? await preprocessInSandbox(documentPath, request.allowEmptySource === true)
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
    conversion_status: conversionStatus,
  };
}
