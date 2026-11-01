import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export async function prepareRenderWorkspace(root) {
  const directory = join(root, "tmp");
  await mkdir(directory, { recursive: true });
  process.env.TMPDIR = directory;
}
