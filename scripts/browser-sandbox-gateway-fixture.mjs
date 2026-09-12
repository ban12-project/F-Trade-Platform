// Synthetic live fixture inside the template's Agent image; no real broker.
import { readFileSync } from "node:fs";
import { createGateway } from "/app/ops/browser-node/gateway.mjs";

const config = JSON.parse(readFileSync("/fixture/config.json", "utf8"));
const slot = {
  run: { id: config.runId },
  ready: true,
  stopping: false,
  expiresAt: Date.now() + 90000,
  gatewayOrigin: config.origin,
  vncPort: 6080,
  vncPassword: config.password,
};
const gateway = createGateway({
  appOrigin: config.origin,
  slots: new Map([[config.runId, slot]]),
  nodeCall: async (operation, input) => {
    if (operation !== "admit" || input.ticket !== config.ticket) throw new Error("denied");
    return { runId: config.runId };
  },
});
setTimeout(() => {
  gateway.close();
  process.exit(0);
}, 100000);
