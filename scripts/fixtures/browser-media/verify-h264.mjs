import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Camoufox } from "/app/official-runtime/node_modules/camoufox/dist/index.js";
import imageTools from "/app/official-runtime/node_modules/playwright-core/lib/utilsBundle.js";

let browser;
try {
  browser = await Camoufox({
    headless: true,
    geoip: false,
    os: "linux",
    block_webrtc: true,
    exclude_addons: ["UBO"],
  });
  const page = await browser.newPage();
  const media = readFileSync(new URL("./h264-blue.mp4", import.meta.url)).toString("base64");
  const result = await page.evaluate(async (base64) => {
    const video = document.createElement("video");
    video.id = "synthetic-codec-probe";
    video.muted = true;
    document.body.append(video);
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: true }), 15_000);
      const finish = (result) => {
        clearTimeout(timer);
        resolve(result);
      };
      video.onerror = () => finish({ errorCode: video.error?.code });
      video.onloadeddata = () => finish({ width: video.videoWidth, height: video.videoHeight });
      video.src = url;
      video.load();
    });
  }, media);
  assert.equal(result.width, 128, JSON.stringify(result));
  assert.equal(result.height, 72);
  // The official launcher can randomize canvas readback. Inspect compositor
  // output instead of changing privacy settings to make a canvas assertion pass.
  // PNG decoding comes from the exact pinned Playwright package used by the image.
  const png = imageTools.PNG.sync.read(await page.locator("#synthetic-codec-probe").screenshot());
  for (const [x, y] of [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.25, 0.75],
    [0.75, 0.75],
  ]) {
    const offset = (Math.floor(png.height * y) * png.width + Math.floor(png.width * x)) * 4;
    const pixel = [...png.data.subarray(offset, offset + 4)];
    assert.ok(
      pixel[0] < 30 && pixel[1] < 30 && pixel[2] > 200 && pixel[3] === 255,
      `generated blue frame must render: ${JSON.stringify(pixel)}`,
    );
  }
  console.log("PASS: Firefox decoded and rendered the generated H.264 blue frame");
} finally {
  await browser?.close();
}
