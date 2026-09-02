import "server-only";

import { Sandbox } from "@vercel/sandbox";

import { parseProductMediaProbeOutput, type RawProductMediaProbe } from "./media-probe-parser";
import type { ProductMediaProbe } from "./media-service";
import type { SandboxVideoSource } from "../video/sandbox-sources";

function sandboxImage() {
  const image = process.env.VIDEO_SANDBOX_IMAGE?.trim();
  if (!image) throw new Error("未配置 VIDEO_SANDBOX_IMAGE，无法安全探测产品媒体。");
  return image;
}

async function command(sandbox: Sandbox, executable: string, args: string[]) {
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

  const sandbox = await Sandbox.create({
    image: sandboxImage(),
    timeout: 10 * 60 * 1_000,
    resources: { vcpus: Number(process.env.VIDEO_SANDBOX_VCPUS ?? 2) },
    networkPolicy: { allow: [source.hostname] },
    persistent: false,
  });
  try {
    await sandbox.fs.mkdir("/vercel/sandbox/work", { recursive: true });
    const input = `/vercel/sandbox/work/product-media${source.extension}`;
    const config = "/vercel/sandbox/work/download.conf";
    await sandbox.fs.writeFile(config, `url = "${source.signedGetUrl}"\noutput = "${input}"\n`);
    await command(sandbox, "curl", ["--fail", "--silent", "--show-error", "--location", "--config", config]);
    await sandbox.fs.rm(config, { force: true });

    const raw = JSON.parse(await command(sandbox, "ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate",
      "-of", "json",
      input,
    ])) as RawProductMediaProbe;
    return parseProductMediaProbeOutput(raw, source.contentType);
  } finally {
    await sandbox.stop();
  }
}
