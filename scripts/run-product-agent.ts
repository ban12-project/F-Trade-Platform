import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createProductAgentModel } from "../lib/ai/model-provider";
import { resolveProductAgentModelConfig } from "../lib/ai/product-agent-model-config";
import { validateProductAgentSource } from "../lib/product/agent";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import { EvidenceLocatedProductAgent } from "../lib/product/evidence-located-agent";

function option(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

async function main() {
  const inputPath = resolve(option("--input", "input/source.json"));
  const outputPath = resolve(option("--output", "output/product-draft.json"));
  const documentPath = option("--document", "");

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
  const result = await new EvidenceLocatedProductAgent().run({
    model: createProductAgentModel(await resolveProductAgentModelConfig()),
    source,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        draft: result.draft,
        _evaluation: { ...result.metadata, evidence_mode: "bounded_location" },
        document: preparedDocument && {
          document_sha256: preparedDocument.document_sha256,
          filename: preparedDocument.filename,
          media_type: preparedDocument.media_type,
          ocr_enabled: preparedDocument.ocr_enabled,
        },
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Product Agent failed";
  console.error(`Product Agent failed: ${message}`);
  process.exitCode = 1;
});
