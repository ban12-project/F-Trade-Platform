import "server-only";

import {
  type ComputeRuntime,
  createComputeRuntime,
  downloadComputeSource,
} from "../compute/runtime";
import type { SandboxVideoSource } from "../video/sandbox-sources";
import { parseProductMediaProbeOutput, type RawProductMediaProbe } from "./media-probe-parser";
import type { ProductMediaProbe } from "./media-service";

async function command(sandbox: ComputeRuntime, executable: string, args: string[]) {
  const result = await sandbox.runCommand({ cmd: executable, args, cwd: "/vercel/sandbox" });
  if (result.exitCode !== 0) {
    throw new Error((await result.stderr()).trim().slice(0, 1_000) || `${executable} 执行失败。`);
  }
  return result.stdout();
}

/**
 * Downloads one exact, short-lived private source into an isolated Sandbox and
 * derives technical metadata with ffprobe. No browser field can declare width,
 * duration, FPS, audio presence, or media type.
 */
export async function probeProductMediaEvidenceInSandbox(
  assetRef: string,
  sources: ReadonlyMap<string, SandboxVideoSource>,
): Promise<ProductMediaProbe> {
  const source = sources.get(assetRef);
  if (!source || source.assetRef !== assetRef) throw new Error("产品媒体的私有源文件不可用。");

  const sandbox = await createComputeRuntime("light");
  try {
    await sandbox.fs.mkdir("/vercel/sandbox/work", { recursive: true });
    const input = `/vercel/sandbox/work/product-media${source.extension}`;
    await downloadComputeSource(sandbox, source, input);

    const raw = JSON.parse(
      await command(sandbox, "ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate",
        "-of",
        "json",
        input,
      ]),
    ) as RawProductMediaProbe;
    return parseProductMediaProbeOutput(raw, source.contentType);
  } finally {
    await sandbox.stop();
  }
}
