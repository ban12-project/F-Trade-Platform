import "server-only";

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";

import { parseFfprobeOutput } from "./media-probe";
import { createRemotionCompositionProps } from "./remotion-props";
import type { VideoRenderRequest } from "./rendering";
import type { SandboxVideoSource } from "./sandbox-sources";

type SignedSources = ReadonlyMap<string, SandboxVideoSource>;

export const remotionCompositionId = "AbcdIndustrialVertical";

async function sandboxCommand(sandbox: Awaited<ReturnType<typeof createSandbox>>, executable: string, args: string[]) {
  const result = await sandbox.runCommand({ cmd: executable, args, cwd: "/vercel/sandbox" });
  if (result.exitCode !== 0) throw new Error((await result.stderr()).trim().slice(0, 1_000) || `${executable} 执行失败。`);
  return result.stdout();
}

async function findSandboxExecutable(sandbox: Awaited<ReturnType<typeof createSandbox>>, name: "ffprobe") {
  const matches = (await sandboxCommand(sandbox, "find", ["/vercel/sandbox/node_modules", "-type", "f", "-name", name]))
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const executable = matches.find((value) => /^\/vercel\/sandbox\/node_modules\/.+\/ffprobe$/.test(value));
  if (!executable) throw new Error("Remotion Sandbox 缺少 ffprobe，无法执行成片验收。");
  return executable;
}

/** Renders the governed ABCD composition inside an ephemeral Vercel Sandbox. */
export async function renderMarketingTimelineWithRemotion(
  request: VideoRenderRequest,
  sources: SignedSources,
  productName: string,
) {
  const bundleDir = resolve(process.cwd(), ".remotion");
  if (!existsSync(bundleDir)) throw new Error("Remotion 合成包不存在；部署前必须运行 build:remotion。");
  const inputProps = createRemotionCompositionProps(request, sources, productName);
  const sandbox = await createSandbox({
    timeoutInMilliseconds: 10 * 60 * 1_000,
    resources: { vcpus: Number(process.env.VIDEO_SANDBOX_VCPUS ?? 2) },
  });
  try {
    await addBundleToSandbox({ sandbox, bundleDir });
    const rendered = await renderMediaOnVercel({
      sandbox,
      compositionId: remotionCompositionId,
      inputProps: inputProps as unknown as Record<string, unknown>,
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      crf: 18,
      enforceAudioTrack: true,
      outputFile: "/vercel/sandbox/output.mp4",
      timeoutInMilliseconds: 8 * 60 * 1_000,
    });
    const ffprobe = await findSandboxExecutable(sandbox, "ffprobe");
    const probe = parseFfprobeOutput(JSON.parse(await sandboxCommand(sandbox, ffprobe, [
      "-v", "error",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,r_frame_rate",
      "-of", "json",
      rendered.sandboxFilePath,
    ])));
    return { data: new Uint8Array(await sandbox.fs.readFile(rendered.sandboxFilePath)), probe };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
