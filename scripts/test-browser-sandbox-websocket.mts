import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { chromium, expect } from "@playwright/test";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

const template = z
  .object({
    snapshotId: z.string().regex(/^[A-Za-z0-9_-]+$/),
    agentImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    browserImage: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    builderDeleted: z.literal(true),
  })
  .parse(JSON.parse(await readFile(process.argv[2], "utf8")));
const runId = randomUUID();
const output = `tmp/browser-sandbox-websocket-${runId}`;
await mkdir(output, { recursive: true, mode: 0o700 });
console.log(`WebSocket evidence: ${output}`);
let sandbox: Sandbox | undefined;
async function run(stage: string, script: string, timeoutMs = 60000) {
  assert.ok(sandbox);
  const result = await sandbox
    .currentSession()
    .runCommand({ cmd: "bash", args: ["-euc", script], sudo: true, timeoutMs });
  await writeFile(`${output}/${stage}.log`, `${await result.stdout()}\n${await result.stderr()}`, {
    mode: 0o600,
  });
  assert.equal(result.exitCode, 0, `${stage} failed; see ignored log`);
  console.log(`PASS ${stage}`);
}
async function tunnel(url: URL, origin: string) {
  return new Promise<string>((resolve, reject) => {
    const request = https.request(url, {
      headers: {
        Origin: origin,
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": "binary",
      },
    });
    const timer = setTimeout(() => request.destroy(new Error("tunnel_timeout")), 15000);
    request.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    request.on("response", (r) => {
      r.resume();
      clearTimeout(timer);
      reject(new Error(`not_upgraded_${r.statusCode}`));
    });
    request.on("upgrade", (response, socket, head) => {
      assert.equal(response.statusCode, 101);
      let bytes = Buffer.from(head);
      const finish = () => {
        if (bytes.includes(Buffer.from("RFB 003."))) {
          clearTimeout(timer);
          socket.destroy();
          resolve("RFB");
        }
      };
      socket.on("data", (data) => {
        bytes = Buffer.concat([bytes, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
        if (bytes.length > 4096) socket.destroy(new Error("unexpected_payload"));
        finish();
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        if (!bytes.includes(Buffer.from("RFB 003."))) reject(new Error("no_rfb_greeting"));
      });
      socket.setTimeout(15000, () => socket.destroy(new Error("rfb_timeout")));
      finish();
    });
    request.end();
  });
}
try {
  sandbox = await Sandbox.create({
    source: { type: "snapshot", snapshotId: template.snapshotId },
    persistent: false,
    ports: [9400],
    timeout: 300000,
    resources: { vcpus: 2 },
  });
  await writeFile(`${output}/sandbox-name`, sandbox.name, { mode: 0o600 });
  const origin = sandbox.domain(9400),
    ticket = randomBytes(32).toString("hex"),
    password = randomBytes(4).toString("hex");
  await sandbox.currentSession().writeFiles([
    {
      path: "/tmp/ftrade-vnc-fixture/config.json",
      content: JSON.stringify({ runId, origin, ticket, password }),
      mode: 0o600,
    },
    {
      path: "/tmp/ftrade-vnc-fixture/gateway.mjs",
      content: await readFile("scripts/browser-sandbox-gateway-fixture.mjs"),
      mode: 0o600,
    },
    {
      path: "/tmp/ftrade-profile-fixture.mjs",
      content: await readFile("scripts/browser-sandbox-profile-fixture.mjs"),
      mode: 0o600,
    },
  ]);
  await run("cgroups", "bash /vercel/sandbox/source/ops/browser-node/prepare-sandbox-cgroups.sh");
  await sandbox.currentSession().runCommand({
    cmd: "sh",
    args: ["-c", "exec dockerd >/tmp/ftrade-dockerd.log 2>&1"],
    sudo: true,
    detached: true,
  });
  await run(
    "docker-ready",
    "for i in $(seq 1 30); do docker info >/dev/null 2>&1 && exit 0; sleep 1; done; exit 1",
  );
  // Secrets here are random synthetic VNC credentials, never a real node key.
  await run(
    "browser",
    `docker run -d --name vnc-proof --read-only --shm-size=256m --tmpfs /tmp:rw,size=512m,mode=1777 --tmpfs /root/.camoufox:rw,size=16m,mode=700 -v vnc-proof:/data -v /tmp/ftrade-profile-fixture.mjs:/fixture.mjs:ro -p 127.0.0.1:6080:6080 -e ENABLE_VNC=1 -e VNC_BIND=0.0.0.0 -e VNC_PASSWORD=${password} -e CAMOFOX_PROFILE_DIR=/data/profiles -e CAMOFOX_DISABLE_DEFAULT_ADDONS=true -e FTRADE_LEASE_DEADLINE=$(( $(date +%s) * 1000 + 90000 )) ${template.browserImage} >/dev/null\ntimeout --kill-after=5s 120s docker exec vnc-proof node /fixture.mjs write`,
    150000,
  );
  await run(
    "vnc-ready",
    "for i in $(seq 1 20); do curl -fsS http://127.0.0.1:6080/core/rfb.js >/dev/null && exit 0; sleep 1; done; exit 1",
  );
  await run(
    "gateway",
    `docker run -d --name gateway-proof --network host -v /tmp/ftrade-vnc-fixture:/fixture:ro ${template.agentImage} node /fixture/gateway.mjs >/dev/null\nfor i in $(seq 1 10); do curl -fsS http://127.0.0.1:9400/viewer >/dev/null && exit 0; sleep 1; done; exit 1`,
  );
  const admit = await fetch(`${origin}/admit`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(admit.status, 200);
  const admitted = (await admit.json()) as { module: string; websocket: string };
  const asset = await fetch(new URL(admitted.module, origin), {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /class RFB/);
  const address = new URL(admitted.websocket, origin);
  assert.equal(await tunnel(address, origin), "RFB");
  console.log("PASS TLS WebSocket proxy delivered real VNC RFB greeting");
  await assert.rejects(tunnel(address, origin));
  console.log("PASS used WebSocket capability rejected");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(`${origin}/viewer`, { waitUntil: "networkidle", timeout: 15000 });
    // This isolated viewer is its own parent on the fixture's allowed origin.
    // Real platform postMessage admission remains a separate integration check.
    await page.evaluate(
      ({ token, target }) => {
        window.postMessage({ type: "ftrade-browser-ticket", token }, target);
      },
      { token: `${ticket}-viewer`, target: origin },
    );
    await expect(page.locator("#status")).toContainText("已连接", { timeout: 20000 });
    const canvas = page.locator("#screen canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(
        () =>
          canvas.evaluate((element) => {
            const c = element as HTMLCanvasElement;
            return c.width > 100 && c.height > 100;
          }),
        { timeout: 10000 },
      )
      .toBe(true);
    await expect
      .poll(
        () =>
          canvas.evaluate((element) => {
            const c = element as HTMLCanvasElement;
            const context = c.getContext("2d");
            if (!context) return 0;
            const pixels = context.getImageData(0, 0, c.width, c.height).data;
            const colors = new Set<string>();
            for (let i = 0; i < pixels.length; i += 256) {
              colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
              if (colors.size > 8) break;
            }
            return colors.size;
          }),
        { timeout: 15000 },
      )
      .toBeGreaterThan(8);
    await page.screenshot({ path: `${output}/desktop.png` });
    console.log("PASS real noVNC viewer authenticated and received nonblank desktop");
  } finally {
    await browser.close();
  }
} finally {
  if (sandbox) {
    try {
      await sandbox.currentSession().stop();
    } finally {
      await sandbox.delete({ deleteOrphanSnapshots: true });
    }
    console.log("Test VM and snapshots deleted");
  }
}
await writeFile(
  `${output}/result.json`,
  JSON.stringify({
    templateSnapshotId: template.snapshotId,
    passed: true,
    scope:
      "real noVNC password authentication and desktop canvas over TLS; no platform admission, proxy or real account",
    cleanedUp: true,
  }),
  { mode: 0o600 },
);
