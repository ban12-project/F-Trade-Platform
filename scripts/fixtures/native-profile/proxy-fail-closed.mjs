import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { Camoufox } from "/app/node_modules/camoufox-js/dist/index.js";

let directRequests = 0;
const target = createServer((_request, response) => {
  directRequests++;
  response.end("direct-route-open");
});
target.listen(0, "127.0.0.1");
await once(target, "listening");
const port = target.address().port;
const direct = await fetch(`http://target.browser.test:${port}/`);
assert.equal(await direct.text(), "direct-route-open");
let directBrowser;
try {
  directBrowser = await Camoufox({
    headless: true,
    geoip: false,
    block_webrtc: true,
    exclude_addons: ["UBO"],
  });
  const directPage = await directBrowser.newPage();
  await directPage.goto(`http://target.browser.test:${port}/`, {
    timeout: 12000,
    waitUntil: "domcontentloaded",
  });
  assert.equal(await directPage.locator("body").innerText(), "direct-route-open");
  assert.ok(directRequests > 0, "Firefox direct control must reach the target");
} finally {
  await directBrowser?.close();
}
directRequests = 0;
let browser;
try {
  browser = await Camoufox({
    headless: true,
    geoip: false,
    block_webrtc: true,
    proxy: "http://127.0.0.1:9",
    exclude_addons: ["UBO"],
  });
  const page = await browser.newPage();
  let navigationFailed = false;
  try {
    await page.goto(`http://target.browser.test:${port}/`, {
      timeout: 12000,
      waitUntil: "domcontentloaded",
    });
  } catch {
    navigationFailed = true;
  }
  assert.equal(navigationFailed, true, "navigation must fail when the proxy is down");
  assert.equal(directRequests, 0, "Firefox must not reach the target directly");
  console.log(JSON.stringify({ proxyDown: true, navigationFailed, directRequests }));
} finally {
  await browser?.close();
  target.close();
}
