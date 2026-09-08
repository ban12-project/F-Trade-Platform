import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { freemem } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { isLive } from "../../lib/browser-fleet/policy.ts";
import { accessKeyNodeId, secureOrigin } from "../../lib/browser-fleet/security.ts";
import { containerSpec, dockerClient, renewWatchdog, stopContainer } from "./docker.mjs";
import { openEgressCheckedSession, verifyBrowserEgress } from "./egress.mjs";
import { createGateway } from "./gateway.mjs";
import { localDeadline, prepareClaimBeforeStart } from "./lease.mjs";
import { createPublicationAuthorizer, createPublicationReporter } from "./publication.mjs";

const appOrigin = secureOrigin(process.env.FTRADE_URL ?? "");
const accessKey = process.env.BROWSER_NODE_ACCESS_KEY_FILE
  ? (await readFile(process.env.BROWSER_NODE_ACCESS_KEY_FILE, "utf8")).trim()
  : (process.env.BROWSER_NODE_ACCESS_KEY ?? "").trim();
const nodeId = accessKeyNodeId(accessKey);
const stateDir = process.env.NODE_STATE_DIR ?? "/var/lib/browser-node";
await mkdir(stateDir, { recursive: true, mode: 0o700 });
let installationId;
try {
  installationId = (await readFile(`${stateDir}/installation-id`, "utf8")).trim();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  installationId = randomUUID();
  await writeFile(`${stateDir}/installation-id`, installationId, { flag: "wx", mode: 0o600 });
}
const bootId = randomUUID();
const maxSlots = Math.min(16, Math.max(1, Number(process.env.MAX_RUNNING_BROWSERS ?? 2)));
const reserveMb = Math.max(512, Number(process.env.HOST_RESERVE_MB ?? 1024));
if (!Number.isInteger(maxSlots) || !Number.isFinite(reserveMb))
  throw new Error("node_capacity_invalid");
const docker = dockerClient(process.env.DOCKER_SOCKET ?? "/var/run/docker.sock");
const image = await docker(
  "GET",
  `/images/${encodeURIComponent(process.env.BROWSER_IMAGE ?? "ftrade-browser:lease-v1")}/json`,
);
if (image.Config?.Labels?.["io.ftrade.lease-watchdog"] !== "1")
  throw new Error("reviewed_watchdog_image_required");
// Resolve the local tag once. Platform payloads cannot choose images, mounts,
// shell commands, host ports, or a Docker API endpoint.
const imageId = image.Id;
let adapter = { capabilities: ["interactive"] };
if (process.env.BROWSER_TASK_ADAPTER) {
  const extra = await import(pathToFileURL(process.env.BROWSER_TASK_ADAPTER).href);
  if (
    typeof extra.execute !== "function" ||
    !Array.isArray(extra.capabilities) ||
    extra.capabilities.some((c) => !["inbox", "publish"].includes(c))
  )
    throw new Error("reviewed_adapter_invalid");
  adapter = { capabilities: ["interactive", ...extra.capabilities], execute: extra.execute };
}
const slots = new Map();
let gatewayOrigin = "";
let stopping = false;
let pendingClaim = null;
async function nodeCall(operation, fields = {}) {
  const started = performance.now();
  const response = await fetch(`${appOrigin}/api/browser-nodes`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${accessKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ operation, installationId, bootId, ...fields }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`platform_http_${response.status}`);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  data.roundTripMs = performance.now() - started;
  return data;
}
async function checkpoint() {
  const safe = [...slots.values()].map((s) => ({
    id: s.run.id,
    leaseId: s.run.leaseId,
    accountId: s.run.accountId,
    kind: s.run.kind,
    stopped: !!s.stopped,
  }));
  const file = `${stateDir}/leases-${randomUUID()}.tmp`;
  await writeFile(file, JSON.stringify(safe), { mode: 0o600 });
  await rename(file, `${stateDir}/leases.json`);
}
async function browserRequest(slot, path, body, timeout = 30_000) {
  if (slot.expiresAt <= Date.now()) throw new Error("local_lease_expired");
  const response = await fetch(`http://127.0.0.1:${slot.apiPort}${path}`, {
    method: body === undefined ? "GET" : "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${slot.accessKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.any([slot.abort.signal, AbortSignal.timeout(timeout)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("browser_request_failed");
  }
  return response;
}
const sync = await nodeCall("sync");
if (sync.nodeId !== nodeId) throw new Error("node_identity_mismatch");
gatewayOrigin = secureOrigin(sync.gatewayOrigin);
const filters = encodeURIComponent(JSON.stringify({ label: [`io.ftrade.node=${nodeId}`] }));
const leftovers = await docker("GET", `/containers/json?all=true&filters=${filters}`);
for (const container of leftovers) await stopContainer(docker, container.Id);
const oldNetworks = await docker("GET", `/networks?filters=${filters}`);
for (const network of oldNetworks) await docker("DELETE", `/networks/${network.Id}`);
await nodeCall("recover", {
  stoppedRunIds: sync.runs.filter(isLive).map((r) => r.id),
  capabilities: adapter.capabilities,
});
const gateway = createGateway({
  appOrigin,
  nodeCall,
  slots,
  port: Number(process.env.GATEWAY_PORT ?? 9400),
});
console.log("browser_node_ready");

async function stop(slot, outcome = "failed") {
  if (slot.stopPromise) return slot.stopPromise;
  slot.stopping = true;
  gateway.closeRun(slot.run.id);
  slot.stopPromise = (async () => {
    if (!slot.stopped) {
      // Wait for create/start to settle; never acknowledge a slot while a late
      // Docker create could still bring a browser online.
      slot.abort.abort();
      if (slot.startPromise) await slot.startPromise.catch(() => {});
      if (slot.apiPort && slot.expiresAt > Date.now()) {
        try {
          const response = await fetch(
            `http://127.0.0.1:${slot.apiPort}/sessions/${slot.run.accountId}/storage_state`,
            {
              headers: { Authorization: `Bearer ${slot.accessKey}` },
              redirect: "error",
              signal: AbortSignal.timeout(5000),
            },
          );
          await response.body?.cancel();
        } catch {
          /* Graceful server shutdown still attempts persistence. */
        }
      }
      await stopContainer(docker, slot.containerId ?? slot.name);
      try {
        await docker("DELETE", `/networks/${slot.name}`);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      slot.stopped = true;
      await checkpoint();
    }
    await nodeCall("finish", {
      runId: slot.run.id,
      leaseId: slot.run.leaseId,
      stopped: true,
      outcome,
    });
    slots.delete(slot.run.id);
    await checkpoint();
  })();
  try {
    await slot.stopPromise;
  } finally {
    slot.stopPromise = null;
  }
}
async function launch(slot) {
  const spec = slot.spec;
  await docker("POST", "/volumes/create", {
    Name: spec.volume,
    Labels: { "io.ftrade.node": nodeId, "io.ftrade.account": slot.run.accountId },
  });
  await docker("POST", "/networks/create", {
    Name: spec.name,
    Driver: "bridge",
    Labels: spec.labels,
  });
  if (slot.stopping) return;
  const created = await docker("POST", `/containers/create?name=${spec.name}`, spec.body);
  slot.containerId = created.Id;
  if (slot.stopping) return;
  await docker("POST", `/containers/${created.Id}/start`);
  const details = await docker("GET", `/containers/${created.Id}/json`);
  slot.apiPort = Number(details.NetworkSettings.Ports["9377/tcp"][0].HostPort);
  slot.vncPort = Number(details.NetworkSettings.Ports["6080/tcp"][0].HostPort);
  for (let i = 0; i < 60; i++) {
    if (slot.stopping || slot.expiresAt <= Date.now()) throw new Error("start_cancelled");
    try {
      const response = await browserRequest(slot, "/health", undefined, 2000);
      await response.body?.cancel();
      break;
    } catch {
      if (i === 59) throw new Error("browser_start_timeout");
      await sleep(1000, undefined, { signal: slot.abort.signal });
    }
  }
  slot.egressTabId = await openEgressCheckedSession(
    (path, body) => browserRequest(slot, path, body),
    slot.run,
  );
  slot.egressCheckedAt = Date.now();
  if (slot.stopping) return;
  for (let i = 0; i < 30; i++) {
    const response = await browserRequest(slot, "/vnc/status");
    const status = await response.json();
    if (status.running === true) break;
    if (i === 29) throw new Error("vnc_not_ready");
    await sleep(1000, undefined, { signal: slot.abort.signal });
  }
  const renewed = await nodeCall("heartbeat", {
    runId: slot.run.id,
    leaseId: slot.run.leaseId,
    ready: true,
  });
  if (!renewed.active || slot.stopping) throw new Error("lease_revoked");
  slot.expiresAt = localDeadline(renewed, renewed.leaseUntil);
  await renewWatchdog(docker, slot.containerId, slot.expiresAt);
  slot.ready = true;
  slot.readyAt = Date.now();
  // Secrets already live in this isolated runtime. Drop the claim's copy.
  delete slot.run.proxy;
  delete slot.spec;
}
async function heartbeat(slot) {
  if (slot.stopping) {
    await stop(slot, slot.outcome ?? "failed");
    return;
  }
  if (slot.expiresAt <= Date.now()) {
    slot.outcome = "unknown";
    await stop(slot, "unknown");
    return;
  }
  if (slot.ready && Date.now() - slot.egressCheckedAt >= 30_000) {
    try {
      await verifyBrowserEgress(
        (path, body) => browserRequest(slot, path, body),
        slot.run,
        slot.egressTabId,
      );
      slot.egressCheckedAt = Date.now();
    } catch {
      slot.outcome = "egress_mismatch";
      await stop(slot, slot.outcome);
      return;
    }
  }
  const renewed = await nodeCall("heartbeat", {
    runId: slot.run.id,
    leaseId: slot.run.leaseId,
    ready: !!slot.ready,
  });
  if (!renewed.active) {
    await stop(slot, slot.run.kind === "publish" ? "unknown" : "failed");
    return;
  }
  slot.expiresAt = localDeadline(renewed, renewed.leaseUntil);
  const pendingConnection = Number(renewed.connectBefore ?? 0) > renewed.serverNow;
  if (
    slot.ready &&
    slot.run.kind === "interactive" &&
    ((!slot.connected && !pendingConnection && Date.now() - slot.readyAt > 60_000) ||
      (slot.disconnectedAt && Date.now() - slot.disconnectedAt > 15_000))
  ) {
    await stop(slot, "completed");
    return;
  }
  if (slot.containerId && slot.ready) {
    const runtime = await docker("GET", `/containers/${slot.containerId}/json`);
    if (!runtime.State.Running) {
      await stop(slot, "unknown");
      return;
    }
  }
  if (slot.containerId) await renewWatchdog(docker, slot.containerId, slot.expiresAt);
}
let ticking = false;
async function tick() {
  if (ticking || stopping) return;
  ticking = true;
  try {
    await Promise.all(
      [...slots.values()].map(async (slot) => {
        try {
          await heartbeat(slot);
        } catch {
          if (slot.expiresAt <= Date.now()) await stop(slot, "unknown").catch(() => {});
        }
      }),
    );
    if (slots.size >= maxSlots || [...slots.values()].some((s) => s.stopping)) return;
    pendingClaim ??= randomUUID();
    const result = await nodeCall("claim", {
      requestId: pendingClaim,
      availableMemoryMb: Math.max(0, Math.floor(freemem() / 1024 / 1024 - reserveMb)),
      localSlots: maxSlots,
    });
    if (!result.run || slots.has(result.run.id)) {
      pendingClaim = null;
      return;
    }
    const prepared = await prepareClaimBeforeStart(
      result,
      (claim) => {
        const expiresAt = localDeadline(claim, claim.run.leaseUntil);
        return { expiresAt, spec: containerSpec(nodeId, claim.run, imageId, expiresAt) };
      },
      (outcome) => nodeCall("finish", outcome),
    );
    pendingClaim = null;
    if (!prepared) return;
    const { expiresAt, spec } = prepared;
    const slot = {
      run: result.run,
      spec,
      name: spec.name,
      accessKey: spec.accessKey,
      vncPassword: spec.vncPassword,
      expiresAt,
      gatewayOrigin,
      abort: new AbortController(),
      ready: false,
      stopping: false,
    };
    slots.set(result.run.id, slot);
    try {
      await checkpoint();
    } catch {
      await stop(slot, "failed");
      return;
    }
    slot.startPromise = launch(slot);
    void slot.startPromise
      .then(async () => {
        if (!slot.ready || slot.stopping || slot.run.kind === "interactive") return;
        try {
          const authorizePublication = createPublicationAuthorizer({
            run: slot.run,
            assertActive() {
              if (
                !slot.ready ||
                slot.stopping ||
                slot.abort.signal.aborted ||
                slot.expiresAt <= Date.now()
              )
                throw new Error("publication_lease_inactive");
            },
            async checkEgress() {
              try {
                await verifyBrowserEgress(
                  (path, body) => browserRequest(slot, path, body),
                  slot.run,
                  slot.egressTabId,
                );
              } catch (error) {
                await stop(slot, "egress_mismatch");
                throw error;
              }
            },
            request: nodeCall,
          });
          const outcome = await adapter.execute({
            run: structuredClone(slot.run),
            authorizePublication,
            reportPublication: createPublicationReporter({ run: slot.run, request: nodeCall }),
            signal: slot.abort.signal,
            browserRequest: (path, body) => browserRequest(slot, path, body),
          });
          slot.outcome = [
            "completed",
            "needs_login",
            "needs_2fa",
            "checkpoint",
            "failed",
            "unknown",
          ].includes(outcome)
            ? outcome
            : "unknown";
        } catch {
          slot.outcome = "unknown";
        }
        await stop(slot, slot.outcome);
      })
      .catch((error) => {
        slot.outcome = error.message?.startsWith("egress_") ? "egress_mismatch" : "failed";
        void stop(slot, slot.outcome).catch(() => {});
      });
  } catch {
    console.error("browser_node_poll_failed");
  } finally {
    ticking = false;
  }
}
const timer = setInterval(() => {
  void tick();
}, 10_000);
await tick();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  gateway.close();
  await Promise.allSettled(
    [...slots.values()].map((slot) =>
      stop(slot, slot.run.kind === "publish" ? "unknown" : "failed"),
    ),
  );
  process.exit(0);
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
