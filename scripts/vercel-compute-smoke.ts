/** Live cloud smoke using only generated fixtures. No database or business writes. */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { del, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { createComputeRuntime } from "../lib/compute/runtime";
import { preprocessProductAgentDocument } from "../lib/product/document-source";
import { probeProductMediaEvidenceInSandbox } from "../lib/product/media-sandbox-probe";
import { renderMarketingTimelineWithRemotion } from "../lib/video/remotion-sandbox";
import type { VideoRenderRequest } from "../lib/video/rendering";
import {
  extractMarketingVisualSamplesInSandbox,
  renderMarketingTimelineInSandbox,
} from "../lib/video/sandbox-media";

export async function runVercelComputeSmoke() {
  assert.equal(process.env.COMPUTE_PROVIDER, "vercel", "Smoke must explicitly select Vercel");
  const fixture = await createComputeRuntime("light");
  let fixtureData: Buffer;
  try {
    const generated = await fixture.runCommand({
      cmd: "ffmpeg",
      args: [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=320x568:rate=30",
        "-t",
        "3",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "/vercel/sandbox/work/synthetic.mp4",
      ],
    });
    assert.equal(generated.exitCode, 0);
    fixtureData = await fixture.fs.readFile("/vercel/sandbox/work/synthetic.mp4");
    const blocked = await fixture.runCommand({
      cmd: "python3",
      args: [
        "-c",
        "import urllib.request; urllib.request.urlopen('https://example.com', timeout=3)",
      ],
    });
    assert.notEqual(blocked.exitCode, 0, "Compute must not have Internet access");
  } finally {
    await fixture.stop();
  }
  const pathname = `synthetic/compute-801/${randomUUID()}.mp4`;
  try {
    await put(pathname, fixtureData, { access: "private", addRandomSuffix: false });
    const validUntil = Date.now() + 10 * 60 * 1000;
    const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
    const { presignedUrl: sourceUrl } = await presignUrl(token, {
      access: "private",
      operation: "get",
      pathname,
      validUntil,
      useCache: false,
    });
    const output = resolve(tmpdir(), `vercel-compute-smoke-${randomUUID()}`);
    await mkdir(output, { recursive: true });
    const documentPath = resolve(output, "synthetic.txt");
    await writeFile(documentPath, "SYNTHETIC TEST DOCUMENT. No product facts or customer data.\n");
    console.log("smoke stage: document");
    const document = await preprocessProductAgentDocument({
      documentPath,
      recordId: "vercel-synthetic",
      imageAvailability: "none",
      imageRefs: [],
    });
    assert.match(document.source.source_text, /SYNTHETIC TEST DOCUMENT/);
    const pdfPath = resolve(output, "synthetic.pdf");
    const stream = "BT /F1 18 Tf 50 750 Td (SYNTHETIC TEST DOCUMENT) Tj ET";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    for (const [index, object] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    await writeFile(pdfPath, pdf);
    const pdfDocument = await preprocessProductAgentDocument({
      documentPath: pdfPath,
      recordId: "vercel-synthetic-pdf",
      imageAvailability: "none",
      imageRefs: [],
    });
    assert.match(pdfDocument.source.source_text, /SYNTHETIC TEST DOCUMENT/);
    const assetRef = "evidence-vercel-synthetic";
    const sources = new Map([
      [
        assetRef,
        {
          assetRef,
          signedGetUrl: sourceUrl,
          hostname: new URL(sourceUrl).hostname,
          extension: ".mp4",
          contentType: "video/mp4",
        },
      ],
    ]);
    console.log("smoke stage: media-probe");
    const media = await probeProductMediaEvidenceInSandbox(assetRef, sources);
    console.log("smoke stage: visual-sampling");
    const sampled = await extractMarketingVisualSamplesInSandbox(
      [{ assetRef, mediaType: "video", rightsEvidenceRef: "evidence-vercel-synthetic-rights" }],
      sources,
    );
    assert.ok(sampled.candidates.length && sampled.visualSamples.length);
    assert.ok(sampled.visualSamples.every((sample) => sample.data.length > 100));
    const request: VideoRenderRequest = {
      platform: "facebook",
      width: 1080,
      height: 1920,
      fps: 30,
      timeline: {
        durationSeconds: 3,
        scenes: [
          {
            sceneId: "synthetic-scene",
            assetRef,
            mediaType: "video",
            trimStartSeconds: 0,
            fitMode: "contain",
            audioMode: "muted",
            abcdRoles: ["attention", "branding", "connection", "direction"],
            motionPreset: "cta_hold",
            startSeconds: 0,
            durationSeconds: 3,
            prompt: "Synthetic fixture",
            claimRefs: [],
            subtitles: [{ text: "SYNTHETIC TEST", startSeconds: 0, endSeconds: 3, claimRefs: [] }],
          },
        ],
        cta: { text: "Synthetic fixture only", startSeconds: 0, endSeconds: 3 },
      },
    };
    console.log("smoke stage: ffmpeg-render");
    const ffmpeg = await renderMarketingTimelineInSandbox(request, sources);
    assert.equal(ffmpeg.probe.videoCodec, "h264");
    assert.equal(ffmpeg.probe.audioCodec, "aac");
    assert.equal(ffmpeg.probe.width, 1080);
    await writeFile(resolve(output, "ffmpeg.mp4"), ffmpeg.data);
    console.log("smoke stage: remotion-render");
    const remotion = await renderMarketingTimelineWithRemotion(
      request,
      sources,
      "SYNTHETIC TEST PRODUCT",
    );
    assert.equal(remotion.probe.videoCodec, "h264");
    assert.equal(remotion.probe.audioCodec, "aac");
    assert.equal(remotion.probe.width, 1080);
    assert.equal(remotion.probe.height, 1920);
    assert.ok(Math.abs(remotion.probe.durationSeconds - 3) < 0.1);
    await writeFile(resolve(output, "remotion.mp4"), remotion.data);
    const result = {
      document: { sha256: document.document_sha256, status: document.conversion_status },
      pdfDocument: { sha256: pdfDocument.document_sha256, status: pdfDocument.conversion_status },
      media,
      sampleCount: sampled.visualSamples.length,
      ffmpeg: ffmpeg.probe,
      remotion: remotion.probe,
    };
    await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ status: "passed", output, ...result }, null, 2));
    return result;
  } finally {
    await del(pathname);
  }
}
