import { randomBytes } from "node:crypto";
import http from "node:http";

export function dockerClient(socketPath = "/var/run/docker.sock") {
  async function docker(method, path, body, timeout = 45_000) {
    return new Promise((resolve, reject) => {
      const binary = Buffer.isBuffer(body);
      const data = body === undefined ? undefined : binary ? body : JSON.stringify(body);
      const request = http.request(
        {
          socketPath,
          method,
          path,
          headers: data
            ? {
                "Content-Type": binary ? "application/x-tar" : "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
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
  }
  // Docker's archive endpoint rejects a read-only rootfs even when /tmp is a
  // writable tmpfs. Stream verified bytes into a short-lived exec instead.
  docker.execInput = async (containerId, path, bytes, sha256, timeout = 120_000) => {
    if (
      !/^[a-f0-9]{64}$/.test(containerId) ||
      !/^\/tmp\/ftrade-uploads\/[a-f0-9]{64}\.(png|jpg|mp4)$/.test(path) ||
      !Buffer.isBuffer(bytes) ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      throw new Error("publication_upload_invalid");
    if (!path.startsWith(`/tmp/ftrade-uploads/${sha256}.`))
      throw new Error("publication_upload_invalid");
    const receive = `const fs=require('node:fs'),crypto=require('node:crypto');
const target=process.argv[1],length=Number(process.argv[2]),expected=process.argv[3];
fs.mkdirSync('/tmp/ftrade-uploads',{recursive:true,mode:0o700});
const temporary=target+'.partial-'+process.pid;
let fd=fs.openSync(temporary,'wx',0o600),received=0;
const hash=crypto.createHash('sha256');
function fail(){try{fs.closeSync(fd)}catch{};try{fs.unlinkSync(temporary)}catch{};process.exit(1)}
process.stdin.on('data',chunk=>{try{
  if(received+chunk.length>length) return fail();
  for(let offset=0;offset<chunk.length;){
    const written=fs.writeSync(fd,chunk,offset,chunk.length-offset);
    if(written<=0)return fail();
    offset+=written;
  }
  hash.update(chunk);received+=chunk.length;
  if(received===length){
    if(hash.digest('hex')!==expected)return fail();
    fs.closeSync(fd);fs.renameSync(temporary,target);process.exit(0);
  }
}catch{fail()}});
process.stdin.on('end',()=>{if(received!==length)fail()});
process.stdin.on('error',fail);`;
    const exec = await docker("POST", `/containers/${containerId}/exec`, {
      AttachStdin: true,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      Cmd: ["node", "-e", receive, path, String(bytes.length), sha256],
    });
    if (!/^[a-f0-9]{64}$/.test(exec?.Id ?? "")) throw new Error("docker_exec_invalid");
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ Detach: false, Tty: false });
      const request = http.request({
        socketPath,
        method: "POST",
        path: `/exec/${exec.Id}/start`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Connection: "Upgrade",
          Upgrade: "tcp",
        },
      });
      const timer = setTimeout(() => request.destroy(new Error("docker_exec_timeout")), timeout);
      const finish = (error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      request.on("upgrade", (response, socket) => {
        if (response.statusCode !== 101) return finish(new Error("docker_exec_upgrade_failed"));
        socket.on("error", finish);
        socket.on("close", () => finish());
        socket.end(bytes);
      });
      request.on("response", () => finish(new Error("docker_exec_upgrade_failed")));
      request.on("error", finish);
      request.end(body);
    });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const state = await docker("GET", `/exec/${exec.Id}/json`);
      if (!state?.Running) {
        if (state?.ExitCode !== 0) throw new Error("docker_exec_upload_failed");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("docker_exec_upload_unconfirmed");
  };
  return docker;
}
function identifier(value) {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new Error("invalid_runtime_identifier");
  return value;
}
export function containerSpec(nodeId, run, imageId, deadline, nativeProfile = false) {
  if (typeof nativeProfile !== "boolean") throw new Error("native_profile_mode_invalid");
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
        ...(nativeProfile
          ? [
              "FTRADE_NATIVE_PROFILE=1",
              `FTRADE_PROFILE_NODE_ID=${nodeId}`,
              `FTRADE_PROFILE_ACCOUNT_ID=${run.accountId}`,
            ]
          : []),
        ...(run.kind === "interactive"
          ? [
              "FTRADE_DIAGNOSTIC_KIND=interactive",
              `FTRADE_DIAGNOSTIC_ACCOUNT=${run.accountId}`,
              `FTRADE_DIAGNOSTIC_RUN=${run.id}`,
            ]
          : []),
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
        "CAMOFOX_UPLOADS_DIR=/tmp/ftrade-uploads",
        "CAMOFOX_TRACES_DIR=/data/traces",
        "MAX_SESSIONS=1",
        "MAX_TABS_PER_SESSION=4",
        "MAX_TABS_GLOBAL=4",
        "MAX_CONCURRENT_PER_USER=1",
        // Upstream schedules setTimeout directly: zero races first-page creation.
        "BROWSER_IDLE_TIMEOUT_MS=900000",
        "SESSION_TIMEOUT_MS=900000",
        "TAB_INACTIVITY_MS=900000",
        "PROXY_STRATEGY=round_robin",
        "PROXY_PROTOCOL=http",
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
        Tmpfs: {
          "/tmp": "rw,nosuid,nodev,size=512m,mode=1777",
          // Camoufox beta.24 requires this directory even with Playwright's
          // separate profile path. Keep runtime metadata ephemeral; account
          // storage is checkpointed by the persistence plugin into /data.
          "/root/.camoufox": "rw,nosuid,nodev,size=16m,mode=700",
          // Firefox 152 also writes runtime metadata here before its control
          // connection becomes ready. This is not the persisted account profile.
          "/root/camoufox": "rw,nosuid,nodev,size=16m,mode=700",
        },
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
      "const fs=require('node:fs');const p='/tmp/ftrade-lease.'+process.pid;fs.writeFileSync(p,process.argv[1],{mode:0o600});fs.renameSync(p,'/tmp/ftrade-lease')",
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
