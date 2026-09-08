import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";
import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { videoProbeEntries } from "../lib/video/encoding-contract";
import { parseFfprobeOutput, validateProbedVideoExport } from "../lib/video/media-probe";

export async function main() {
  const sourcePath = resolve(process.argv[2] ?? "tmp/pdfs/ryt-ryc302-product.png");
  const outputPath = resolve(process.argv[3] ?? "tmp/videos/ryc302-remotion-vercel-smoke.mp4");
  const publicSourceUrl = process.env.REMOTION_SMOKE_SOURCE_URL?.trim();
  let uploaded: Awaited<ReturnType<typeof put>> | undefined;
  let sourceUrl = publicSourceUrl;
  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
  let failed = false,
    failure: unknown,
    cleanupFailed = false;
  try {
    if (!sourceUrl) {
      const testKey = `video/test/remotion-sandbox-${Date.now()}${extname(sourcePath) || ".png"}`;
      uploaded = await put(testKey, new Blob([await readFile(sourcePath)], { type: "image/png" }), {
        access: "private",
        addRandomSuffix: false,
        contentType: "image/png",
      });
      const validUntil = Date.now() + 10 * 60 * 1_000;
      const readToken = await issueSignedToken({
        pathname: uploaded.pathname,
        operations: ["get"],
        validUntil,
      });
      sourceUrl = (
        await presignUrl(readToken, {
          access: "private",
          operation: "get",
          pathname: uploaded.pathname,
          validUntil,
          useCache: false,
        })
      ).presignedUrl;
    }

    sandbox = await createSandbox({
      timeoutInMilliseconds: 10 * 60 * 1_000,
      resources: { vcpus: 2 },
    });
    await addBundleToSandbox({ sandbox, bundleDir: resolve(".remotion") });
    const rendered = await renderMediaOnVercel({
      sandbox,
      compositionId: "AbcdIndustrialVertical",
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      colorSpace: "bt709",
      crf: 18,
      enforceAudioTrack: true,
      outputFile: "/vercel/sandbox/output.mp4",
      inputProps: {
        productName: "RYC302 Clutch Kit",
        ctaText: "Request product details",
        fps: 30,
        clips: [
          {
            id: "clip-smoke",
            src: sourceUrl,
            mediaType: "image",
            trimStartFrame: 0,
            durationInFrames: 120,
            fitMode: "contain",
            audioMode: "muted",
            caption: "Built for distributor inquiries",
            abcdRoles: ["attention", "branding", "connection", "direction"],
            motionPreset: "hero_reveal",
          },
        ],
      },
    });
    const ffprobeSearch = await sandbox.runCommand({
      cmd: "find",
      args: ["/vercel/sandbox/node_modules", "-type", "f", "-name", "ffprobe"],
    });
    const ffprobe = (await ffprobeSearch.stdout())
      .split("\n")
      .map((path) => path.trim())
      .find((path) => /^\/vercel\/sandbox\/node_modules\/.+\/ffprobe$/.test(path));
    if (ffprobeSearch.exitCode !== 0 || !ffprobe)
      throw new Error("Remotion Sandbox ffprobe was not found.");
    const inspected = await sandbox.runCommand({
      cmd: ffprobe,
      args: [
        "-v",
        "error",
        "-show_entries",
        videoProbeEntries,
        "-of",
        "json",
        rendered.sandboxFilePath,
      ],
    });
    if (inspected.exitCode !== 0) throw new Error("Remotion Sandbox output probe failed.");
    const measured = parseFfprobeOutput(JSON.parse(await inspected.stdout()));
    validateProbedVideoExport("facebook", measured);
    await writeFile(outputPath, await sandbox.fs.readFile(rendered.sandboxFilePath));
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    const cleanupSandbox = sandbox,
      cleanupUpload = uploaded;
    const cleanup = await Promise.allSettled([
      ...(cleanupSandbox ? [Promise.resolve().then(() => cleanupSandbox.stop())] : []),
      ...(cleanupUpload ? [Promise.resolve().then(() => del(cleanupUpload.url))] : []),
    ]);
    cleanupFailed = cleanup.some((result) => result.status === "rejected");
  }
  if (cleanupFailed)
    throw new Error(
      "Remotion smoke cleanup failed; inspect temporary Sandbox/Blob resources before retrying.",
    );
  if (failed) throw failure;
  console.log(
    `PASS Vercel Sandbox rendered and validated ${uploaded ? "private" : "public"} Remotion source against the project Facebook export preset: ${outputPath}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
