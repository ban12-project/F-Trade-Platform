import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { addBundleToSandbox, createSandbox, renderMediaOnVercel } from "@remotion/vercel";

async function main() {
  const sourcePath = resolve(process.argv[2] ?? "tmp/pdfs/ryt-ryc302-product.png");
  const outputPath = resolve(process.argv[3] ?? "tmp/videos/ryc302-remotion-vercel-smoke.mp4");
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const publicSourceUrl = process.env.REMOTION_SMOKE_SOURCE_URL?.trim();
  let uploaded: Awaited<ReturnType<typeof put>> | undefined;
  let sourceUrl = publicSourceUrl;
  if (!sourceUrl) {
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for the private-source smoke test.");
    const testKey = `video/test/remotion-sandbox-${Date.now()}${extname(sourcePath) || ".png"}`;
    uploaded = await put(testKey, new Blob([await readFile(sourcePath)], { type: "image/png" }), {
      access: "private",
      addRandomSuffix: false,
      contentType: "image/png",
      token,
    });
    const validUntil = Date.now() + 10 * 60 * 1_000;
    const readToken = await issueSignedToken({ pathname: uploaded.pathname, operations: ["get"], validUntil });
    sourceUrl = (await presignUrl(readToken, { access: "private", operation: "get", pathname: uploaded.pathname, validUntil, useCache: false })).presignedUrl;
  }

  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
  try {
    sandbox = await createSandbox({ timeoutInMilliseconds: 10 * 60 * 1_000, resources: { vcpus: 2 } });
    await addBundleToSandbox({ sandbox, bundleDir: resolve(".remotion") });
    const rendered = await renderMediaOnVercel({
      sandbox,
      compositionId: "AbcdIndustrialVertical",
      codec: "h264",
      audioCodec: "aac",
      pixelFormat: "yuv420p",
      crf: 18,
      enforceAudioTrack: true,
      outputFile: "/vercel/sandbox/output.mp4",
      inputProps: {
        productName: "RYC302 Clutch Kit",
        ctaText: "Request product details",
        fps: 30,
        clips: [{
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
        }],
      },
    });
    const ffprobeSearch = await sandbox.runCommand({ cmd: "find", args: ["/vercel/sandbox/node_modules", "-type", "f", "-name", "ffprobe"] });
    if (ffprobeSearch.exitCode !== 0 || !(await ffprobeSearch.stdout()).trim()) throw new Error("Remotion Sandbox ffprobe was not found.");
    await writeFile(outputPath, await sandbox.fs.readFile(rendered.sandboxFilePath));
    console.log(`PASS Vercel Sandbox rendered ${uploaded ? "private" : "public"} Remotion source to ${outputPath}`);
  } finally {
    await sandbox?.stop().catch(() => undefined);
    if (uploaded && token) await del(uploaded.url, { token }).catch(() => undefined);
  }
}

void main();
