// Run inside a disposable bridge-network Agent image with the Docker socket.
// No platform key is used. All created objects have a fresh synthetic node UUID.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { containerSpec, dockerClient, renewWatchdog, stopContainer } from "./docker.mjs";
import { waitForBrowserReady } from "./egress.mjs";
import { findAgentContainer, removeTaskNetwork, workerEndpoint } from "./network.mjs";

const docker = dockerClient();
const nodeId = randomUUID();
const accountId = randomUUID();
const run = {
  id: randomUUID(),
  accountId,
  memoryMb: 2048,
  kind: "interactive",
  proxy: { host: "synthetic.invalid", port: 9, username: "synthetic", password: "synthetic" },
};
const imageId = process.env.BROWSER_IMAGE;
assert.match(imageId ?? "", /^sha256:[a-f0-9]{64}$/);
const agentId = await findAgentContainer(docker);
const active = await docker(
  "GET",
  `/containers/json?filters=${encodeURIComponent(JSON.stringify({ label: ["io.ftrade.run"] }))}`,
);
assert.equal(active.length, 0, "browser smoke requires no existing browser task");
const base = containerSpec(nodeId, run, imageId, Date.now() + 90000, true, 2048, "bridge");
const fixture = http.createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>Synthetic bridge fixture</title><p>isolated fixture</p>");
});
await new Promise((resolve) => fixture.listen(8081, "0.0.0.0", resolve));
let workerId;
let initializerId;
let stoppedAgentId;
let renewal;
let volumeCreated = false;
let networkCreated = false;
try {
  await docker("POST", "/volumes/create", {
    Name: base.volume,
    Labels: {
      "io.ftrade.node": nodeId,
      "io.ftrade.account": accountId,
      "io.ftrade.synthetic": "bridge-smoke",
    },
  });
  volumeCreated = true;
  const initializer = await docker("POST", "/containers/create", {
    Image: imageId,
    Labels: { "io.ftrade.node": nodeId, "io.ftrade.synthetic": "bridge-smoke" },
    Entrypoint: ["node"],
    Cmd: [
      "--input-type=module",
      "-e",
      `import { initializeNativeProfile } from '/app/ftrade-native-profile.mjs'; await initializeNativeProfile({ nodeId: '${nodeId}', accountId: '${accountId}', source: 'empty' });`,
    ],
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      Memory: 128 * 1024 * 1024,
      Mounts: [{ Type: "volume", Source: base.volume, Target: "/data" }],
    },
  });
  initializerId = initializer.Id;
  await docker("POST", `/containers/${initializerId}/start`);
  const exited = await docker("POST", `/containers/${initializerId}/wait`, undefined, 30000);
  assert.equal(exited.StatusCode, 0, "synthetic native profile initialization");
  await stopContainer(docker, initializerId);
  initializerId = null;
  await docker("POST", "/networks/create", {
    Name: base.name,
    Driver: "bridge",
    Internal: true,
    Labels: base.labels,
  });
  networkCreated = true;
  await docker("POST", `/networks/${base.name}/connect`, { Container: agentId });
  const self = await docker("GET", `/containers/${agentId}/json`);
  const fixtureIp = self.NetworkSettings.Networks[base.name].IPAddress;
  for (let pass = 0; pass < 2; pass++) {
    const spec = containerSpec(nodeId, run, imageId, Date.now() + 90000, true, 2048, "bridge");
    // Synthetic local-only fixture: no real proxy, account, or external navigation.
    spec.body.Env = spec.body.Env.filter((value) => !value.startsWith("PROXY_"));
    spec.body.HostConfig.ExtraHosts = [`fixture.test:${fixtureIp}`];
    const created = await docker("POST", `/containers/create?name=${spec.name}`, spec.body);
    workerId = created.Id;
    await docker("POST", `/containers/${workerId}/start`);
    renewal = setInterval(() => {
      renewWatchdog(docker, workerId, Date.now() + 90000).catch(() => {});
    }, 20000);
    const details = await docker("GET", `/containers/${workerId}/json`);
    assert.deepEqual(details.HostConfig.PortBindings, {});
    assert.equal(details.HostConfig.ReadonlyRootfs, true);
    assert.deepEqual(details.HostConfig.CapDrop, ["ALL"]);
    assert.equal(details.HostConfig.Memory, 2048 * 1024 * 1024);
    assert.equal(details.HostConfig.PidsLimit, 512);
    assert.equal(
      details.Mounts.some((mount) => mount.Destination === "/var/run/docker.sock"),
      false,
    );
    const endpoint = workerEndpoint(details, spec.name, "bridge");
    const request = (path, body, timeout = 30000) =>
      fetch(`http://${endpoint.workerHost}:${endpoint.apiPort}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${spec.accessKey}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeout),
      });
    await waitForBrowserReady(request, { assertActive() {}, sleep });
    const denied = await fetch(`http://${endpoint.workerHost}:${endpoint.apiPort}/tabs`);
    assert.ok([401, 403].includes(denied.status), "API requires authentication");
    await denied.body?.cancel();
    const openedResponse = await request("/tabs", {
      userId: accountId,
      sessionKey: run.id,
      url: "http://fixture.test:8081",
      trace: false,
    });
    const opened = await openedResponse.json();
    assert.equal(openedResponse.ok, true, JSON.stringify(opened));
    assert.equal(typeof opened.tabId, "string");
    const expression =
      pass === 0
        ? "(() => { localStorage.setItem('bridge-smoke','persisted'); document.cookie='bridgeSmoke=persisted; max-age=3600; path=/'; return {value:localStorage.getItem('bridge-smoke'),cookie:document.cookie}; })()"
        : "({value:localStorage.getItem('bridge-smoke'),cookie:document.cookie})";
    const evaluatedResponse = await request(`/tabs/${opened.tabId}/evaluate`, {
      userId: accountId,
      expression,
    });
    const evaluated = await evaluatedResponse.json();
    assert.equal(evaluatedResponse.ok, true, JSON.stringify(evaluated));
    const value = evaluated.result;
    assert.equal(value.value, "persisted", `cold start ${pass}: localStorage`);
    assert.match(value.cookie, /bridgeSmoke=persisted/, `cold start ${pass}: cookie`);
    const vnc = await request("/vnc/status");
    assert.equal((await vnc.json()).running, true);
    const asset = await fetch(`http://${endpoint.workerHost}:${endpoint.vncPort}/vnc.html`, {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(asset.ok, true, "VNC HTTP reachable through task bridge");
    await asset.body?.cancel();
    const foreign = await request("/tabs", {
      userId: randomUUID(),
      sessionKey: run.id,
      url: "http://fixture.test:8081",
      trace: false,
    });
    assert.equal(foreign.status, 403, "native profile cross-account request rejected");
    await foreign.body?.cancel();
    clearInterval(renewal);
    renewal = null;
    await stopContainer(docker, workerId);
    workerId = null;
    console.log(
      JSON.stringify({
        stage: "cold-start",
        pass,
        api: true,
        vnc: true,
        persistence: true,
        isolation: true,
      }),
    );
  }
  // OpenShip can retain the exited previous deployment container until the new
  // one is ready. Verify SIGKILL releases its network endpoint without deleting
  // that container record or force-disconnecting any unknown workload.
  const oldAgent = await docker("POST", "/containers/create", {
    Image: self.Image,
    Labels: { "io.ftrade.node": nodeId, "io.ftrade.synthetic": "bridge-smoke" },
    Cmd: ["node", "-e", "setInterval(()=>{},1000)"],
    HostConfig: { NetworkMode: base.name, Memory: 64 * 1024 * 1024, PidsLimit: 32 },
  });
  stoppedAgentId = oldAgent.Id;
  await docker("POST", `/containers/${stoppedAgentId}/start`);
  const beforeKill = await docker("GET", `/networks/${base.name}`);
  assert.ok(beforeKill.Containers[stoppedAgentId], "previous Agent endpoint initially attached");
  await docker("POST", `/containers/${stoppedAgentId}/kill?signal=SIGKILL`);
  await docker("POST", `/containers/${stoppedAgentId}/wait`, undefined, 30000);
  const afterKill = await docker("GET", `/networks/${base.name}`);
  assert.equal(
    afterKill.Containers?.[stoppedAgentId],
    undefined,
    "SIGKILL releases old Agent endpoint",
  );
  await removeTaskNetwork(docker, base.name, nodeId, agentId);
  networkCreated = false;
  await assert.rejects(docker("GET", `/networks/${base.name}`), (error) => error.status === 404);
  const retained = await docker("GET", `/containers/${stoppedAgentId}/json`);
  assert.equal(
    retained.State.Status,
    "exited",
    "cleanup works while old deployment record remains",
  );
  console.log(
    JSON.stringify({
      stage: "complete",
      networkCleanup: true,
      stoppedAgentEndpointReleased: true,
      nodeId,
    }),
  );
} finally {
  if (renewal) clearInterval(renewal);
  if (workerId) await stopContainer(docker, workerId);
  if (initializerId) await stopContainer(docker, initializerId);
  if (stoppedAgentId) await stopContainer(docker, stoppedAgentId);
  if (networkCreated) await removeTaskNetwork(docker, base.name, nodeId, agentId);
  if (volumeCreated) await docker("DELETE", `/volumes/${base.volume}`);
  fixture.close();
}
