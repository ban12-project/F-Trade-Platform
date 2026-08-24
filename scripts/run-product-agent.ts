import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createProductAgentModel } from "../lib/ai/model-provider";
import { AiSdkProductAgent, validateProductAgentSource } from "../lib/product/agent";
import { preprocessProductAgentDocument } from "../lib/product/document-source";

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main() {
  const inputPath = resolve(option("--input", "input/source.json"));
  const outputPath = resolve(option("--output", "output/product-draft.json"));
  const documentPath = option("--document", "");
  const modelId = option("--model", process.env.F_TRADE_MODEL ?? "");
  if (!modelId) throw new Error("Pass --model provider/model or set F_TRADE_MODEL");

  const preparedDocument = documentPath
    ? await preprocessProductAgentDocument({
        documentPath,
        recordId: option("--record-id", "") || `document-${Date.now()}`,
        imageAvailability: option("--image-availability", "none") as "real_product_image" | "none",
        imageRefs: [],
      })
    : undefined;
  const source = preparedDocument
    ? preparedDocument.source
    : validateProductAgentSource(JSON.parse(await readFile(inputPath, "utf8")));
  const result = await new AiSdkProductAgent().run({
    model: createProductAgentModel(modelId),
    source,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({
      draft: result.draft,
      _evaluation: result.metadata,
      document: preparedDocument && {
        document_sha256: preparedDocument.document_sha256,
        filename: preparedDocument.filename,
        media_type: preparedDocument.media_type,
        ocr_enabled: preparedDocument.ocr_enabled,
      },
    }, null, 2)}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Product Agent failed";
  console.error(`Product Agent failed: ${message}`);
  process.exitCode = 1;
});
