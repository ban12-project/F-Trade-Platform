import { initialState, publicState } from "../../lib/browser-fleet/policy";

export const nodeTimestamp = "2027-01-01T00:30:15.000Z";
const instant = Date.parse(nodeTimestamp);

export function syntheticBrowserNodes() {
  return [true, false].map((observed, index) => {
    const state = initialState({ maxBrowsers: 1, memoryBudgetMb: 3072, browserMemoryMb: 2048 });
    state.lastSeenAt = observed ? instant : 0;
    state.capabilities = ["interactive"];
    state.accounts = [
      {
        id: `00000000-0000-4000-8000-00000000070${index + 3}`,
        displayName: observed ? "合成已检查账号" : "合成未检查账号",
        channelRef: "facebook-personal",
        accountRef: `synthetic-timezone-${index}`,
        enabled: false,
        authState: "needs_login",
        credentialVersion: 1,
        loginCiphertext: null,
        proxyCiphertext: null,
        pollSeconds: 900,
        nextPollAt: 0,
        lastCheckedAt: observed ? instant : null,
      },
    ];
    return {
      id: `00000000-0000-4000-8000-00000000070${index + 1}`,
      name: observed ? "合成已连接服务" : "合成未连接服务",
      gatewayOrigin: "https://synthetic.invalid",
      status: "active" as const,
      ...publicState(state, instant),
      sandbox: null,
    };
  });
}
