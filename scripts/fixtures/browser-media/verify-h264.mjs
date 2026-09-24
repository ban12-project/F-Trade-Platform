import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Camoufox } from "/app/node_modules/camoufox-js/dist/index.js";

let browser;
try {
  browser = await Camoufox({
    headless: true,
    geoip: false,
    block_webrtc: true,
    exclude_addons: ["UBO"],
  });
  const page = await browser.newPage();
  const media = readFileSync(new URL("./h264-blue.mp4", import.meta.url)).toString("base64");
  const result = await page.evaluate(async (base64) => {
    const video = document.createElement("video");
    video.muted = true;
    document.body.append(video);
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
    try {
      return await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timedOut: true }), 15_000);
        const finish = (result) => {
          clearTimeout(timer);
          resolve(result);
        };
        video.onerror = () => finish({ errorCode: video.error?.code });
        video.onloadeddata = () => {
          try {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d");
            context.drawImage(video, 0, 0, 1, 1);
            finish({
              width: video.videoWidth,
              height: video.videoHeight,
              pixel: [...context.getImageData(0, 0, 1, 1).data],
            });
          } catch {
            finish({ frameReadFailed: true });
          }
        };
        video.src = url;
        video.load();
      });
    } finally {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    }
  }, media);
  assert.equal(result.width, 128, JSON.stringify(result));
  assert.equal(result.height, 72);
  assert.ok(
    result.pixel[0] < 30 &&
      result.pixel[1] < 30 &&
      result.pixel[2] > 200 &&
      result.pixel[3] === 255,
    "generated blue frame must decode",
  );
  console.log("PASS: Firefox decoded the generated H.264 frame");
} finally {
  await browser?.close();
}
