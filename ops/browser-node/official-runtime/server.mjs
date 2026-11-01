import { readFileSync } from "node:fs";
import { createStartupDiagnostics } from "../startup-diagnostics.mjs";

const startupDiagnostics = createStartupDiagnostics();

import { startDisplay } from "./display.mjs";
import { createOfficialLauncher } from "./launcher.mjs";
import { createRuntimeService } from "./service.mjs";

let display, runtime, server, stopping;
function stop(code = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    // The outer watchdog is the final deadline if a browser cannot shut down.
    server?.close();
    await runtime?.close().catch(() => {});
    await display?.close().catch(() => {});
    process.exit(code);
  })();
  return stopping;
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
try {
  const e = process.env;
  if (
    e.PROXY_PROTOCOL !== "http" ||
    !/^[A-Za-z0-9.-]{1,253}$/.test(e.PROXY_HOST ?? "") ||
    !/^\d{1,5}$/.test(e.PROXY_PORT ?? "") ||
    +e.PROXY_PORT < 1 ||
    +e.PROXY_PORT > 65535
  )
    throw new Error("fixed_proxy_required");
  const leaseDeadline = () => Number(readFileSync("/tmp/ftrade-lease", "utf8"));
  startupDiagnostics.begin();
  display = await startDisplay({ onFailure: () => void stop(1) });
  const launcher = createOfficialLauncher({
    root: "/data",
    leaseDeadline,
    startupDiagnostics,
    display: display.display,
    executablePath: "/root/.cache/camoufox/browsers/official/158.0.1-beta.41/camoufox-bin",
    proxy: {
      server: `http://${e.PROXY_HOST}:${e.PROXY_PORT}`,
      username: e.PROXY_USERNAME,
      password: e.PROXY_PASSWORD,
    },
  });
  runtime = createRuntimeService({
    launcher,
    accountId: e.FTRADE_PROFILE_ACCOUNT_ID,
    runId: e.FTRADE_RUNTIME_RUN_ID,
    accessKey: e.CAMOFOX_ACCESS_KEY,
    leaseDeadline,
    startupDiagnostics,
    viewer: display,
    onFatal: () => void stop(1),
  });
  // Binding is fixed to the isolated container, never supplied by a task.
  server = runtime.app.listen(9377, "0.0.0.0");
  server.on("error", () => void stop(1));
  await runtime.start();
  await display.startViewer();
} catch {
  // Even launch failures can contain proxy credentials; shared logs get no
  // upstream error or request body. The Agent reports its bounded launch stage.
  await stop(1);
}
