import { randomBytes } from "node:crypto";
import http from "node:http";

export function dockerClient(socketPath = "/var/run/docker.sock") {
  return async function docker(method, path, body, timeout = 45_000) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const request = http.request(
        {
          socketPath,
          method,
          path,
          headers: data
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
            : {},
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > 4 * 1024 * 1024) {
              response.destroy();
              reject(new Error("docker_response_limit"));
            } else chunks.push(chunk);
          });
          response.on("end", () => {
            if ((response.statusCode ?? 500) >= 300) {
              const error = new Error(`docker_http_${response.statusCode}`);
              error.status = response.statusCode;
              reject(error);
              return;
            }
            const text = Buffer.concat(chunks).toString("utf8");
            try {
              resolve(text ? JSON.parse(text) : null);
            } catch {
              reject(new Error("docker_response_invalid"));
            }
          });
          response.on("error", reject);
        },
      );
      request.setTimeout(timeout, () => request.destroy(new Error("docker_timeout")));
      request.on("error", reject);
      request.end(data);
    });
  };
}
function identifier(value) {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error("invalid_runtime_identifier");
  return value;
}
export function containerSpec(nodeId, run, imageId, deadline) {
  identifier(nodeId);
  identifier(run.id);
  identifier(run.accountId);
  if (!Number.isInteger(run.memoryMb) || run.memoryMb < 1024 || run.memoryMb > 8192)
    throw new Error("invalid_memory_limit");
  const proxy = run.proxy;
  if (
    !proxy ||
    !/^[A-Za-z0-9.-]{1,253}$/.test(proxy.host) ||
    !Number.isInteger(proxy.port) ||
    proxy.port < 1 ||
    proxy.port > 65535
  )
    throw new Error("fixed_proxy_required");
  if (
    ![proxy.username, proxy.password].every(
      (s) => typeof s === "string" && s.length <= 4096 && !s.includes("\0"),
    )
  )
    throw new Error("proxy_credentials_invalid");
  const accessKey = randomBytes(32).toString("base64url");
  const vncPassword = randomBytes(4).toString("hex");
  const name = `ftbrowser-${nodeId}-${run.id}`;
  const volume = `ftbrowser-${nodeId}-${run.accountId}`;
  const labels = {
    "io.ftrade.node": nodeId,
    "io.ftrade.run": run.id,
    "io.ftrade.account": run.accountId,
  };
  return {
    name,
    volume,
    labels,
    accessKey,
    vncPassword,
    body: {
      Image: imageId,
      Labels: labels,
      Env: [
        "NODE_ENV=production",
        "CAMOFOX_BIND_HOST=0.0.0.0",
        "CAMOFOX_PORT=9377",
        `CAMOFOX_ACCESS_KEY=${accessKey}`,
        "ENABLE_VNC=1",
        "VNC_BIND=0.0.0.0",
        "VNC_RESOLUTION=1440x900",
        `VNC_PASSWORD=${vncPassword}`,
        "CAMOFOX_DISABLE_DEFAULT_ADDONS=true",
        "CAMOFOX_CRASH_REPORT_ENABLED=false",
        "CAMOFOX_PROFILE_DIR=/data/profiles",
        "CAMOFOX_COOKIES_DIR=/data/cookies",
        "CAMOFOX_UPLOADS_DIR=/data/uploads",
        "CAMOFOX_TRACES_DIR=/data/traces",
        "MAX_SESSIONS=1",
        "MAX_TABS_PER_SESSION=4",
        "MAX_TABS_GLOBAL=4",
        "MAX_CONCURRENT_PER_USER=1",
        "BROWSER_IDLE_TIMEOUT_MS=0",
        "SESSION_TIMEOUT_MS=900000",
        "TAB_INACTIVITY_MS=900000",
        "PROXY_STRATEGY=round_robin",
        `PROXY_HOST=${proxy.host}`,
        `PROXY_PORT=${proxy.port}`,
        `PROXY_USERNAME=${proxy.username}`,
        `PROXY_PASSWORD=${proxy.password}`,
        `FTRADE_LEASE_DEADLINE=${deadline}`,
      ],
      ExposedPorts: { "9377/tcp": {}, "6080/tcp": {} },
      HostConfig: {
        Init: true,
        RestartPolicy: { Name: "no" },
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        PidsLimit: 256,
        Memory: run.memoryMb * 1024 * 1024,
        MemorySwap: run.memoryMb * 1024 * 1024,
        NanoCpus: 2_000_000_000,
        ShmSize: 256 * 1024 * 1024,
        Tmpfs: { "/tmp": "rw,nosuid,nodev,size=512m,mode=1777" },
        Mounts: [{ Type: "volume", Source: volume, Target: "/data" }],
        NetworkMode: name,
        PortBindings: {
          "9377/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
          "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "0" }],
        },
        LogConfig: { Type: "none" },
      },
    },
  };
}
export async function renewWatchdog(docker, containerId, deadline) {
  const exec = await docker("POST", `/containers/${containerId}/exec`, {
    AttachStdout: false,
    AttachStderr: false,
    Cmd: [
      "node",
      "-e",
      "require('node:fs').writeFileSync('/tmp/ftrade-lease',process.argv[1],{mode:0o600})",
      String(deadline),
    ],
  });
  await docker("POST", `/exec/${exec.Id}/start`, { Detach: true });
}
export async function stopContainer(docker, id) {
  try {
    const current = await docker("GET", `/containers/${id}/json`);
    if (current.State.Running) await docker("POST", `/containers/${id}/stop?t=20`);
    const stopped = await docker("GET", `/containers/${id}/json`);
    if (stopped.State.Running) throw new Error("browser_stop_unconfirmed");
    await docker("DELETE", `/containers/${id}?v=false`);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
}
