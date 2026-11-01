import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

export function agentNetworkMode(value = "host") {
  if (!["host", "bridge"].includes(value)) throw new Error("agent_network_mode_invalid");
  return value;
}

// OpenShip chooses the hostname, so it cannot be used as a Docker container ID.
// Match the current namespace's address AND MAC, and fail closed on ambiguity.
export async function findAgentContainer(docker, interfaces = networkInterfaces()) {
  const local = Object.values(interfaces)
    .flat()
    .filter(
      (entry) =>
        entry && !entry.internal && entry.family === "IPv4" && entry.mac !== "00:00:00:00:00:00",
    );
  const containers = await docker("GET", "/containers/json");
  const matches = containers.filter((container) =>
    Object.values(container.NetworkSettings?.Networks ?? {}).some((endpoint) =>
      local.some(
        (entry) =>
          entry.address === endpoint.IPAddress &&
          entry.mac.toLowerCase() === endpoint.MacAddress?.toLowerCase(),
      ),
    ),
  );
  if (matches.length !== 1 || !/^[a-f0-9]{64}$/.test(matches[0].Id))
    throw new Error("agent_container_identity_unresolved");
  return matches[0].Id;
}

export function workerEndpoint(details, name, mode) {
  if (mode === "bridge") {
    const host = details.NetworkSettings?.Networks?.[name]?.IPAddress;
    if (isIP(host ?? "") !== 4) throw new Error("browser_network_endpoint_missing");
    return { workerHost: host, apiPort: 9377, vncPort: 6080 };
  }
  const ports = details.NetworkSettings?.Ports;
  const apiPort = Number(ports?.["9377/tcp"]?.[0]?.HostPort);
  const vncPort = Number(ports?.["6080/tcp"]?.[0]?.HostPort);
  if (![apiPort, vncPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535))
    throw new Error("browser_network_endpoint_missing");
  return { workerHost: "127.0.0.1", apiPort, vncPort };
}

export async function removeTaskNetwork(docker, name, nodeId, agentContainerId) {
  try {
    const network = await docker("GET", `/networks/${name}`);
    if (network.Labels?.["io.ftrade.node"] !== nodeId || !network.Labels?.["io.ftrade.run"])
      throw new Error("browser_network_ownership_mismatch");
    if (agentContainerId && network.Containers?.[agentContainerId]) {
      await docker("POST", `/networks/${network.Id}/disconnect`, {
        Container: agentContainerId,
        Force: false,
      });
    }
    // Never force-disconnect another endpoint: unexpected ownership must block cleanup.
    await docker("DELETE", `/networks/${network.Id}`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}
