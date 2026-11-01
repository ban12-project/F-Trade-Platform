import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rejectRetiredSandboxExecution } from "../lib/browser-fleet/sandbox-retired";

/** Retired live cloud smoke. Fail before uploading any Blob or creating a VM. */
export async function main(): Promise<never> {
  return rejectRetiredSandboxExecution();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
