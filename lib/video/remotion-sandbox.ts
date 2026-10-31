import "server-only";

import { existsSync } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { VpsCompute, vpsComputeEnabled } from "../compute/vps";
import { videoProbeEntries } from "./encoding-contract";
import { parseFfprobeOutput } from "./media-probe";
import { createRemotionCompositionProps } from "./remotion-props";
import type { VideoRenderRequest } from "./rendering";
import type { SandboxVideoSource } from "./sandbox-sources";

type SignedSources = ReadonlyMap<string, SandboxVideoSource>;

export const remotionCompositionId = "AbcdIndustrialVertical";

/** Renders the governed ABCD composition inside an ephemeral offline VPS container. */
export async function renderMarketingTimelineWithRemotion(
  request: VideoRenderRequest,
  sources: SignedSources,
  productName: string,
) {
  const bundleDir = resolve(process.cwd(), ".remotion");
  if (!existsSync(bundleDir))
    throw new Error("Remotion 合成包不存在；部署前必须运行 build:remotion。");
  const inputProps = createRemotionCompositionProps(request, sources, productName);
  vpsComputeEnabled();
  return renderRemotionOnVps(bundleDir, inputProps, sources);
}

/** Upload this deployment's exact bundle. A renderer image update must not
 * silently render an old composition from a separately baked bundle. */
async function uploadBundle(runtime: VpsCompute, localRoot: string) {
  let total = 0;
  let files = 0;
  async function visit(relative: string) {
    const directory = resolve(localRoot, relative);
    await runtime.fs.mkdir(`/vercel/sandbox/work/bundle${relative ? `/${relative}` : ""}`, {
      recursive: true,
    });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name)) throw new Error("remotion_bundle_path_invalid");
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error("remotion_bundle_symlink_rejected");
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const absolute = resolve(localRoot, path);
        const info = await lstat(absolute);
        total += info.size;
        if (++files > 2000 || total > 128 * 1024 * 1024) throw new Error("remotion_bundle_limit");
        await runtime.fs.writeFile(`/vercel/sandbox/work/bundle/${path}`, await readFile(absolute));
      } else throw new Error("remotion_bundle_file_invalid");
    }
  }
  await visit("");
}

async function renderRemotionOnVps(
  bundleDir: string,
  inputProps: ReturnType<typeof createRemotionCompositionProps>,
  sources: SignedSources,
) {
  const runtime = await VpsCompute.create();
  try {
    await uploadBundle(runtime, bundleDir);
    const localSources = new Map<string, string>();
    for (const [index, source] of [...sources.values()].entries()) {
      if (!/^\.(?:jpg|png|webp|mp4|mov)$/.test(source.extension))
        throw new Error("remotion_source_extension_invalid");
      const filename = `media-${index}${source.extension}`;
      await runtime.download(
        source.signedGetUrl,
        source.hostname,
        `/vercel/sandbox/work/${filename}`,
      );
      localSources.set(source.signedGetUrl, `http://127.0.0.1:8765/${filename}`);
    }
    const offlineProps = {
      ...inputProps,
      clips: inputProps.clips.map((clip) => {
        const src = localSources.get(clip.src);
        if (!src) throw new Error("remotion_source_missing");
        return { ...clip, src };
      }),
    };
    await runtime.fs.writeFile("/vercel/sandbox/work/props.json", JSON.stringify(offlineProps));
    const rendered = await runtime.runCommand({
      cmd: "node",
      args: ["/opt/ftrade-remotion/render.mjs"],
    });
    if (rendered.exitCode !== 0) throw new Error("VPS Remotion 渲染失败。");
    const output = "/vercel/sandbox/work/output.mp4";
    const inspected = await runtime.runCommand({
      cmd: "ffprobe",
      args: ["-v", "error", "-show_entries", videoProbeEntries, "-of", "json", output],
    });
    if (inspected.exitCode !== 0) throw new Error("VPS Remotion 成片验收失败。");
    const probe = parseFfprobeOutput(JSON.parse(await inspected.stdout()));
    return { data: new Uint8Array(await runtime.fs.readFile(output)), probe };
  } finally {
    await runtime.stop();
  }
}
