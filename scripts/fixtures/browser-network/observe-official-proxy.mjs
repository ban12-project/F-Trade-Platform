// Explicit operator-run acceptance only. A protected proxy case is supplied by
// the authorized host; this fixture never mounts or opens a real account profile.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createSocket } from "node:dgram";
import { lookup, resolve4 } from "node:dns/promises";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { startDisplay } from "/app/official-runtime/display.mjs";
import { createOfficialLauncher } from "/app/official-runtime/launcher.mjs";
import { getGeolocation } from "/app/official-runtime/node_modules/camoufox/dist/geolocation.js";
import { Camoufox } from "/app/official-runtime/node_modules/camoufox/dist/index.js";

const { proxy, expectedEgressIp } = JSON.parse(readFileSync("/run/proxy-case.json", "utf8"));
assert.ok(isIP(expectedEgressIp));
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && !a.internal && a.family === "IPv4");
assert.equal(addresses.length, 1);
const address = addresses[0].address;
const receiver = createSocket("udp4");
let packets = 0,
  bindingRequests = 0;
receiver.on("message", (bytes) => {
  packets++;
  if (bytes.length >= 20 && bytes.readUInt16BE(0) === 1 && bytes.readUInt32BE(4) === 0x2112a442)
    bindingRequests++;
});
receiver.bind(0, "0.0.0.0");
await once(receiver, "listening");
const marker = (name) => writeFileSync(`/tmp/proxy-${name}`, "1", { mode: 0o600 });
async function wait(name) {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (existsSync(`/tmp/proxy-${name}`)) return;
    await sleep(500);
  }
  throw new Error("observer_handshake_timeout");
}
async function rtc(page) {
  return page.evaluate(
    async ({ address, port }) => {
      const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:${address}:${port}` }] });
      const candidates = [];
      peer.onicecandidate = ({ candidate }) => {
        if (candidate) candidates.push(candidate.candidate);
      };
      try {
        peer.createDataChannel("proxy-acceptance");
        await peer.setLocalDescription(await peer.createOffer());
        await new Promise((resolve) => {
          const timeout = setTimeout(resolve, 20000);
          peer.onicegatheringstatechange = () => {
            if (peer.iceGatheringState === "complete") {
              clearTimeout(timeout);
              resolve();
            }
          };
          if (peer.iceGatheringState === "complete") {
            clearTimeout(timeout);
            resolve();
          }
        });
        let statsAvailable = false;
        try {
          const stats = await peer.getStats();
          statsAvailable = typeof stats.forEach === "function";
        } catch {}
        return { candidates, gatheringState: peer.iceGatheringState, statsAvailable };
      } finally {
        peer.close();
      }
    },
    { address, port: receiver.address().port },
  );
}

let direct,
  display,
  context,
  stage = "capture-control";
try {
  marker("ready");
  await wait("start-control");
  await resolve4("example.com").catch(() => {});
  direct = await Camoufox({ headless: true, os: "linux", geoip: false, exclude_addons: ["UBO"] });
  const directPage = await direct.newPage();
  await rtc(directPage);
  await direct.close();
  direct = null;
  assert.ok(bindingRequests > 0, "independent_stun_control_required");
  marker("control-done");
  await wait("start-runtime");
  packets = bindingRequests = 0;
  stage = "proxy-baseline";
  const proxyAddresses = (await lookup(proxy.host, { all: true })).map((a) => a.address);
  // curl receives credentials on stdin, not in argv or shared logs.
  const curlConfig = [
    `proxy = ${JSON.stringify(`http://${proxy.host}:${proxy.port}`)}`,
    `proxy-user = ${JSON.stringify(`${proxy.username}:${proxy.password}`)}`,
    'url = "https://api.ipify.org/"',
    'noproxy = ""',
    "silent",
    "show-error",
    "max-time = 20",
  ].join("\n");
  const baseline = execFileSync("curl", ["--config", "-"], {
    input: curlConfig,
    encoding: "utf8",
    timeout: 25000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  assert.equal(baseline, expectedEgressIp, "proxy_baseline_exit_mismatch");
  stage = "official-launch";
  display = await startDisplay();
  const launcher = createOfficialLauncher({
    root: "/data",
    leaseDeadline: () => Date.now() + 180000,
    display: display.display,
    executablePath: "/root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin",
    proxy: {
      server: `http://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    },
  });
  await launcher.ensureBrowser(60000);
  context = await launcher.contextFor(process.env.FTRADE_PROFILE_ACCOUNT_ID);
  stage = "browser-egress";
  const page = await context.newPage();
  await page.goto("https://api.ipify.org/", { waitUntil: "domcontentloaded", timeout: 30000 });
  assert.equal(
    (await page.locator("body").innerText()).trim(),
    expectedEgressIp,
    "browser_exit_mismatch",
  );
  const timezone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const geo = (await getGeolocation(expectedEgressIp)).asConfig();
  assert.equal(timezone, geo.timezone, "geoip_timezone_mismatch");
  let proxyIpv6Available = false;
  try {
    await page.goto("https://api6.ipify.org/", { waitUntil: "domcontentloaded", timeout: 15000 });
    proxyIpv6Available = isIP((await page.locator("body").innerText()).trim()) === 6;
  } catch {}
  await page.goto("about:blank");
  stage = "rtc-observation";
  const observation = await rtc(page);
  console.log(
    JSON.stringify({
      rtcGatheringState: observation.gatheringState,
      candidateCount: observation.candidates.length,
      observerUdp: packets,
    }),
  );
  stage = "rtc-gathering-complete";
  assert.equal(observation.gatheringState, "complete");
  const candidateAddresses = observation.candidates.map((value) => value.split(" ")[4]);
  stage = "rtc-candidate-addresses";
  assert.ok(candidateAddresses.every((value) => value === expectedEgressIp));
  stage = "rtc-udp-observer";
  assert.equal(packets, 0, "proxy_sent_udp_to_observer");
  await context.close();
  context = null;
  await display.close();
  display = null;
  // The host keeps this metadata private and publishes only aggregate verdicts.
  writeFileSync(
    "/tmp/proxy-result.json",
    JSON.stringify({
      passed: true,
      baselineMatches: true,
      browserMatches: true,
      timezoneMatches: true,
      proxyIpv6Available,
      proxyAddresses,
      proxyPort: proxy.port,
      proxyHost: proxy.host,
      numericCandidates: candidateAddresses.length,
      statsAvailable: observation.statsAvailable,
      packets,
      bindingRequests,
    }),
    { mode: 0o600 },
  );
  marker("runtime-done");
  await wait("capture-stopped");
  console.log(
    JSON.stringify({
      actualProxy: true,
      expectedExitMatched: true,
      geoipTimezoneMatched: true,
      observerUdp: packets,
    }),
  );
} catch {
  console.error(JSON.stringify({ actualProxy: true, passed: false, stage }));
  process.exitCode = 1;
} finally {
  await direct?.close().catch(() => {});
  await context?.close().catch(() => {});
  await display?.close().catch(() => {});
  receiver.close();
}
