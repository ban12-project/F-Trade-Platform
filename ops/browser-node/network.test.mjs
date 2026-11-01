import assert from "node:assert/strict";
import { test } from "node:test";
import { containerSpec } from "./docker.mjs";
import {
  agentNetworkMode,
  findAgentContainer,
  removeTaskNetwork,
  workerEndpoint,
} from "./network.mjs";

const nodeId = "11111111-1111-4111-8111-111111111111";
const id = "a".repeat(64);
const local = {
  eth0: [{ family: "IPv4", internal: false, address: "172.20.0.3", mac: "02:42:ac:14:00:03" }],
};
const own = {
  Id: id,
  NetworkSettings: {
    Networks: { project: { IPAddress: "172.20.0.3", MacAddress: "02:42:ac:14:00:03" } },
  },
};

test("bridge self-discovery requires one matching address and MAC, independent of hostname", async () => {
  assert.equal(await findAgentContainer(async () => [own], local), id);
  await assert.rejects(
    findAgentContainer(async () => [], local),
    /identity_unresolved/,
  );
  await assert.rejects(
    findAgentContainer(async () => [own, { ...own, Id: "b".repeat(64) }], local),
    /identity_unresolved/,
  );
  await assert.rejects(
    findAgentContainer(async () => [own], {
      eth0: [{ ...local.eth0[0], mac: "02:42:ac:14:00:04" }],
    }),
    /identity_unresolved/,
  );
});

test("bridge workers keep isolation and persistence without publishing control ports", () => {
  const run = {
    id: "22222222-2222-4222-8222-222222222222",
    accountId: "33333333-3333-4333-8333-333333333333",
    memoryMb: 2048,
    proxy: { host: "proxy.example", port: 8080, username: "u", password: "p" },
  };
  const host = containerSpec(nodeId, run, "sha256:test", Date.now() + 60000, true, 2048);
  const bridge = containerSpec(
    nodeId,
    run,
    "sha256:test",
    Date.now() + 60000,
    true,
    2048,
    "bridge",
  );
  assert.deepEqual(bridge.body.HostConfig.PortBindings, {});
  assert.equal(host.body.HostConfig.PortBindings["9377/tcp"][0].HostIp, "127.0.0.1");
  for (const key of [
    "ReadonlyRootfs",
    "CapDrop",
    "SecurityOpt",
    "PidsLimit",
    "Memory",
    "MemorySwap",
    "NanoCpus",
    "Tmpfs",
    "Mounts",
    "NetworkMode",
    "RestartPolicy",
  ])
    assert.deepEqual(bridge.body.HostConfig[key], host.body.HostConfig[key], key);
  assert.equal(bridge.volume, host.volume);
  assert.equal(agentNetworkMode(), "host");
  assert.throws(() => agentNetworkMode("public"), /network_mode_invalid/);
});

test("worker destination comes only from its own job network; missing endpoints fail closed", () => {
  assert.deepEqual(
    workerEndpoint(
      { NetworkSettings: { Networks: { job: { IPAddress: "172.22.0.2" } } } },
      "job",
      "bridge",
    ),
    {
      workerHost: "172.22.0.2",
      apiPort: 9377,
      vncPort: 6080,
    },
  );
  assert.throws(
    () =>
      workerEndpoint(
        { NetworkSettings: { Networks: { foreign: { IPAddress: "172.22.0.2" } } } },
        "job",
        "bridge",
      ),
    /endpoint_missing/,
  );
  assert.deepEqual(
    workerEndpoint(
      {
        NetworkSettings: {
          Ports: { "9377/tcp": [{ HostPort: "33001" }], "6080/tcp": [{ HostPort: "33002" }] },
        },
      },
      "job",
      "host",
    ),
    {
      workerHost: "127.0.0.1",
      apiPort: 33001,
      vncPort: 33002,
    },
  );
});

test("cleanup detaches only this Agent, then deletes its owned job network", async () => {
  const calls = [];
  const docker = async (method, path, body) => {
    calls.push([method, path, body]);
    if (method === "GET")
      return {
        Id: "network-id",
        Labels: { "io.ftrade.node": nodeId, "io.ftrade.run": "run" },
        Containers: { [id]: {} },
      };
  };
  await removeTaskNetwork(docker, "job", nodeId, id);
  assert.deepEqual(calls.slice(1), [
    ["POST", "/networks/network-id/disconnect", { Container: id, Force: false }],
    ["DELETE", "/networks/network-id", undefined],
  ]);
});

test("cleanup refuses foreign networks and propagates unexpected endpoint conflicts", async () => {
  let mutations = 0;
  await assert.rejects(
    removeTaskNetwork(
      async (method) => {
        if (method !== "GET") mutations++;
        return {
          Id: "foreign",
          Labels: { "io.ftrade.node": "another-node", "io.ftrade.run": "run" },
        };
      },
      "foreign",
      nodeId,
      id,
    ),
    /ownership_mismatch/,
  );
  assert.equal(mutations, 0);
  await assert.rejects(
    removeTaskNetwork(
      async (method) => {
        if (method === "GET")
          return {
            Id: "job",
            Labels: { "io.ftrade.node": nodeId, "io.ftrade.run": "run" },
            Containers: { other: {} },
          };
        assert.equal(method, "DELETE");
        throw Object.assign(new Error("active endpoint"), { status: 403 });
      },
      "job",
      nodeId,
      id,
    ),
    /active endpoint/,
  );
  await removeTaskNetwork(
    async () => {
      throw Object.assign(new Error("gone"), { status: 404 });
    },
    "gone",
    nodeId,
    id,
  );
});
