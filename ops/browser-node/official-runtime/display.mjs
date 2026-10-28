import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, writeFile } from "node:fs/promises";
import net from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

async function portReady(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    let done = false;
    const finish = (ready) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ready);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(300, () => finish(false));
  });
}

/** The desktop is private to one container. Only the Agent's ticket gateway
 * exposes it; x11vnc itself only listens on the container loopback interface.
 */
export async function startDisplay({ environment = process.env, onFailure = () => {} } = {}) {
  const resolution = environment.VNC_RESOLUTION ?? "1440x900";
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(resolution);
  if (
    !match ||
    +match[1] < 800 ||
    +match[1] > 3840 ||
    +match[2] < 600 ||
    +match[2] > 2160 ||
    environment.ENABLE_VNC !== "1" ||
    !/^[a-f0-9]{8}$/.test(environment.VNC_PASSWORD ?? "")
  )
    throw new Error("display_configuration_invalid");
  const children = [];
  let closing = false,
    failed = false,
    viewerStarted = false;
  const start = (command, args) => {
    const child = spawn(command, args, { stdio: "ignore" });
    children.push(child);
    const fail = () => {
      failed = true;
      if (!closing) onFailure();
    };
    child.once("error", fail);
    child.once("exit", fail);
    return child;
  };
  async function close() {
    closing = true;
    for (const child of [...children].reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      const exited = once(child, "exit").catch(() => {});
      child.kill("SIGTERM");
      await Promise.race([exited, sleep(1500)]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }
  const display = ":99";
  try {
    // A fresh per-container tmpfs must own these paths; never remove lock files
    // to take over a display belonging to another process.
    try {
      await access("/tmp/.X99-lock");
      throw new Error("display_already_owned");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    start("Xvfb", [display, "-screen", "0", `${resolution}x24`, "-nolisten", "tcp", "-noreset"]);
    let ready = false;
    for (let i = 0; i < 50 && !failed; i++) {
      try {
        await access("/tmp/.X11-unix/X99");
        ready = true;
        break;
      } catch {}
      await sleep(100);
    }
    if (!ready || failed) throw new Error("display_start_failed");
    return {
      display,
      async startViewer() {
        if (viewerStarted || closing || failed) throw new Error("viewer_state_invalid");
        viewerStarted = true;
        // The password is never passed in argv, a URL or process output.
        await writeFile("/tmp/ftrade-vnc-password", environment.VNC_PASSWORD, {
          mode: 0o600,
          flag: "wx",
        });
        start("x11vnc", [
          "-display",
          display,
          "-listen",
          "127.0.0.1",
          "-rfbport",
          "5900",
          "-forever",
          "-shared",
          "-noxdamage",
          "-passwdfile",
          "/tmp/ftrade-vnc-password",
        ]);
        start("websockify", ["--web", "/usr/share/novnc", "0.0.0.0:6080", "127.0.0.1:5900"]);
        for (let i = 0; i < 50 && !failed; i++) {
          if ((await portReady(5900)) && (await portReady(6080))) return;
          await sleep(100);
        }
        throw new Error("viewer_start_failed");
      },
      async status() {
        return (
          viewerStarted && !closing && !failed && (await portReady(5900)) && (await portReady(6080))
        );
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
