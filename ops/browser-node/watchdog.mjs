import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const initial = Number(process.env.FTRADE_LEASE_DEADLINE);
if (!Number.isFinite(initial) || initial <= Date.now() || initial > Date.now() + 95_000) process.exit(1);
writeFileSync("/tmp/ftrade-lease", String(initial), { mode: 0o600 });
// Browser output can include page/account data; never forward it to shared logs.
const child = spawn("node", ["--max-old-space-size=512", "server.js"], { cwd: "/app", stdio: "ignore" });
let closing = false;
function stop() {
  if (closing) return; closing = true; child.kill("SIGTERM");
  setTimeout(() => { child.kill("SIGKILL"); process.exit(1); }, 15_000).unref();
}
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGTERM", stop); process.on("SIGINT", stop);
setInterval(() => {
  try {
    const deadline = Number(readFileSync("/tmp/ftrade-lease", "utf8"));
    if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 95_000) stop();
  } catch { stop(); }
}, 1000);
