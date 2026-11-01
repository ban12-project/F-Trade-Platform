// Credential-free transport characterization, not actual-proxy acceptance.
// Run only in a disposable container on a dedicated internal-only network.
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { Camoufox } from "/app/official-runtime/node_modules/camoufox/dist/index.js";

const family = process.env.SYNTHETIC_IP_FAMILY ?? "IPv4";
assert.ok(["IPv4", "IPv6"].includes(family), "unsupported synthetic address family");
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter(
    (entry) =>
      entry && entry.family === family && !entry.internal && !entry.address.startsWith("fe80:"),
  );
assert.equal(addresses.length, 1, "requires one isolated interface of the selected family");
const address = addresses[0].address;
const host = family === "IPv6" ? `[${address}]` : address;
const bind = family === "IPv6" ? "::" : "0.0.0.0";
// Production accepts IPv4/hostname proxies, not IPv6-literal proxy hosts.
// Keep that transport while independently probing the selected target/STUN family.
const proxyAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === "IPv4" && !entry.internal);
assert.equal(proxyAddresses.length, 1, "requires one isolated IPv4 proxy interface");
const proxyHost = proxyAddresses[0].address;
let packets = 0;
let bindingRequests = 0;
let targetRequests = 0;
let proxyRequests = 0;
const udp = createSocket(family === "IPv6" ? "udp6" : "udp4");
udp.on("message", (packet) => {
  packets++;
  if (packet.length >= 20 && packet.readUInt16BE(0) === 1 && packet.readUInt32BE(4) === 0x2112a442)
    bindingRequests++;
});
udp.bind(0, bind);
await once(udp, "listening");
const target = createServer((_request, response) => {
  targetRequests++;
  response.end("SYNTHETIC isolated target");
});
target.listen(0, bind);
await once(target, "listening");
const targetUrl = `http://${host}:${target.address().port}/`;
const proxy = createServer((request, response) => {
  proxyRequests++;
  // Never forward arbitrary browser/background traffic or leave this fixture.
  if (request.url !== targetUrl) {
    response.writeHead(403).end();
    return;
  }
  response.end("SYNTHETIC isolated proxy");
});
proxy.on("connect", (_request, socket) => socket.destroy());
proxy.listen(0, "0.0.0.0");
await once(proxy, "listening");
let browser;
const results = [];
try {
  // A real received datagram checks the independent observer before Firefox.
  const positiveControl = Buffer.from("SYNTHETIC UDP observer control");
  udp.send(positiveControl, udp.address().port, address);
  await once(udp, "message");
  assert.equal(packets, 1);
  for (const mode of [
    "direct-default",
    "proxy-default",
    "proxy-unreachable",
    "proxy-webrtc-disabled",
  ]) {
    console.error(JSON.stringify({ phase: "launch", mode }));
    packets = bindingRequests = targetRequests = proxyRequests = 0;
    const proxied = mode !== "direct-default";
    browser = await Camoufox({
      headless: true,
      timeout: 20000,
      // No external IP lookup; this is explicitly NOT production GeoIP coverage.
      geoip: false,
      exclude_addons: ["UBO"],
      ...(proxied
        ? {
            proxy: {
              server: `http://${proxyHost}:${mode === "proxy-unreachable" ? 9 : proxy.address().port}`,
            },
          }
        : {}),
      ...(mode === "proxy-webrtc-disabled" ? { block_webrtc: true } : {}),
    });
    const page = await browser.newPage();
    console.error(JSON.stringify({ phase: "navigate", mode }));
    if (mode === "proxy-unreachable") {
      await assert.rejects(page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12000 }));
      await page.goto("about:blank");
    } else {
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
      assert.equal(
        await page.locator("body").innerText(),
        proxied ? "SYNTHETIC isolated proxy" : "SYNTHETIC isolated target",
      );
    }
    const observation = await page.evaluate(
      async ({ address, port }) => {
        if (typeof RTCPeerConnection !== "function") return { available: false, candidates: 0 };
        const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:${address}:${port}` }] });
        let candidates = 0;
        peer.onicecandidate = (event) => {
          if (event.candidate) candidates++;
        };
        try {
          peer.createDataChannel("synthetic-network-probe");
          await peer.setLocalDescription(await peer.createOffer());
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { available: true, candidates, gatheringState: peer.iceGatheringState };
        } finally {
          peer.close();
        }
      },
      { address: host, port: udp.address().port },
    );
    await browser.close();
    browser = null;
    console.error(
      JSON.stringify({
        phase: "observed",
        family,
        mode,
        ...observation,
        targetRequests,
        proxyRequests,
        packets,
        bindingRequests,
      }),
    );
    if (proxied) {
      assert.equal(targetRequests, 0, "HTTP must not bypass fixture proxy");
      assert.equal(bindingRequests, 0, "proxy mode must not send STUN to the independent receiver");
      assert.equal(packets, 0, "proxy mode must not send other UDP to the receiver");
      if (observation.available) assert.equal(observation.gatheringState, "complete");
    }
    results.push({ mode, ...observation, targetRequests, proxyRequests, packets, bindingRequests });
  }
  assert.ok(results[0].bindingRequests > 0, "Firefox STUN positive control is required");
  assert.equal(results[3].available, false, "explicit disable must remove the peer API");
  console.log(
    JSON.stringify({ synthetic: true, family, actualProxy: false, geoipVerified: false, results }),
  );
} finally {
  await browser?.close();
  udp.close();
  proxy.closeAllConnections();
  proxy.close();
  target.closeAllConnections();
  target.close();
}
