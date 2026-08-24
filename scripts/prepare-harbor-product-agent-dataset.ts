import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { productAgentEvalCases } from "../evals/harbor/product-agent/cases";

const root = resolve(process.env.HARBOR_DATASET_DIR ?? "/tmp/f-trade-harbor-product-agent");
const templateRoot = resolve("evals/harbor/product-agent");

async function write(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

async function main() {
  await rm(root, { recursive: true, force: true });
  for (const item of productAgentEvalCases) {
    const taskRoot = resolve(root, item.id);
    await write(
      resolve(taskRoot, "task.toml"),
      `schema_version = "1.4"\n\n[task]\nname = "f-trade/product-agent-${item.id}"\nversion = "1.0.0"\ndescription = "Synthetic Product Agent ${item.cohort} safety evaluation"\n\n[agent]\ntimeout_sec = 180.0\n\n[verifier]\ntimeout_sec = 30.0\n\n[environment]\nnetwork_mode = "public"\nbuild_timeout_sec = 600.0\ncpus = 1\nmemory_mb = 2048\nstorage_mb = 10240\n`,
    );
    await write(resolve(taskRoot, "instruction.md"), "Run the F-Trade Product Agent against the supplied source file.\n");
    await write(resolve(taskRoot, "input/source.json"), `${JSON.stringify(item.source, null, 2)}\n`);
    await write(
      resolve(taskRoot, "environment/Dockerfile"),
      "FROM f-trade-product-agent-eval:latest\nCOPY input /app/input\nRUN mkdir -p /app/output\n",
    );
    await cp(resolve(templateRoot, "verifier.py"), resolve(taskRoot, "tests/verifier.py"));
    await cp(resolve(templateRoot, "test.sh"), resolve(taskRoot, "tests/test.sh"));
    await write(resolve(taskRoot, "tests/expected.json"), `${JSON.stringify(item, null, 2)}\n`);
  }
  await write(
    resolve(root, "dataset.toml"),
    `version = "1.0.0"\nname = "f-trade-product-agent"\ndescription = "Synthetic Product Agent safety evaluation dataset"\n`,
  );
  console.log(`Prepared ${productAgentEvalCases.length} Harbor Product Agent tasks in ${root}`);
}

main();
