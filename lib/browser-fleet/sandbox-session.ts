/** Operates on a captured VM session, never the auto-resuming Sandbox facade. */
export type BrowserSandboxSession = {
  sessionId: string;
  status: string;
  runCommand(input: {
    cmd: string;
    args: string[];
    sudo: boolean;
    timeoutMs: number;
  }): Promise<{ exitCode: number; stdout(): Promise<string> }>;
  stop(): Promise<unknown>;
};

export async function stopIdleBrowserSandboxSession(
  session: BrowserSandboxSession,
  nodeId: string,
  expectedSessionId: string,
) {
  return stopBrowserSandboxSession(session, nodeId, expectedSessionId, false);
}

/** Only the platform's current authorization check can select this path. */
export async function stopRevokedBrowserSandboxSession(
  session: BrowserSandboxSession,
  nodeId: string,
  expectedSessionId: string,
) {
  return stopBrowserSandboxSession(session, nodeId, expectedSessionId, true);
}

async function stopBrowserSandboxSession(
  session: BrowserSandboxSession,
  nodeId: string,
  expectedSessionId: string,
  revoked: boolean,
) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(nodeId))
    throw new Error("sandbox_node_invalid");
  if (session.sessionId !== expectedSessionId) return "superseded" as const;
  if (session.status !== "running") return "inactive" as const;
  const inspected = await session.runCommand({
    cmd: "docker",
    args: [
      "inspect",
      "--format",
      '{{index .Config.Labels "io.ftrade.node"}}|{{.State.Status}}',
      "ftrade-browser-agent",
    ],
    sudo: true,
    timeoutMs: 10_000,
  });
  if (inspected.exitCode !== 0) throw new Error("sandbox_agent_state_unknown");
  const [owner, status, extra] = (await inspected.stdout()).trim().split("|");
  if (owner !== nodeId || extra !== undefined) throw new Error("sandbox_agent_identity_mismatch");
  if ((status === "running" || status === "restarting") && !revoked) return "busy" as const;
  if (!["exited", "running", "restarting"].includes(status))
    throw new Error("sandbox_agent_state_unknown");

  // Agent failure can leave a browser behind. Gracefully drain only this node's
  // containers before stopping compute; the broker reconciles the old leases.
  let drained = false;
  try {
    if (revoked && status !== "exited") {
      // Let Agent stop/checkpoint its browsers before the residual cleanup.
      const agent = await session.runCommand({
        cmd: "docker",
        args: ["stop", "-t", "60", "ftrade-browser-agent"],
        sudo: true,
        timeoutMs: 70000,
      });
      if (agent.exitCode !== 0) throw new Error("sandbox_agent_stop_unconfirmed");
    }
    const result = await session.runCommand({
      cmd: "sh",
      args: [
        "-ec",
        'ids=$(docker ps -q --filter "label=io.ftrade.node=$1"); if [ -n "$ids" ]; then docker stop -t 20 $ids >/dev/null; fi; test -z "$(docker ps -q --filter "label=io.ftrade.node=$1")"; pid=$(cat /var/run/docker.pid); kill -TERM "$pid"; for i in $(seq 1 30); do ! kill -0 "$pid" 2>/dev/null && exit 0; sleep 1; done; exit 1',
        "ftrade-drain",
        nodeId,
      ],
      sudo: true,
      timeoutMs: 70_000,
    });
    drained = result.exitCode === 0;
  } catch {
    // Transport errors cannot establish a clean drain.
  }
  // Even a failed drain must not leave paid compute resident. Stop this exact
  // session, then report the failure so a caller cannot mark it a clean stop.
  await session.stop();
  if (!drained) throw new Error("sandbox_drain_unconfirmed");
  return "stopped" as const;
}
