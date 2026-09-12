/** Controlled source-level ablations. Weakened variants exist only in a temporary
 * directory, never as deployable flags. All inputs are synthetic; no Facebook or
 * registry operations occur. Seeds permute the same fixed workload, not users.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const temp = await mkdtemp(join(tmpdir(), "ftrade-control-ablation-"));
const output = resolve(process.env.REVIEW_OUTPUT_DIR ?? "artifacts/browser-fleet-review");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const sources = {
  policy: await readFile(join(root, "lib/browser-fleet/policy.ts"), "utf8"),
  vault: await readFile(join(root, "lib/social/facebook-vault-crypto.ts"), "utf8"),
  gateway: await readFile(join(root, "ops/browser-node/gateway.mjs"), "utf8"),
};
function replaceOnce(source, before, after) {
  assert.equal(
    source.split(before).length,
    2,
    `Mutation anchor must occur exactly once: ${before}`,
  );
  return source.replace(before, after);
}
async function moduleFor(name, source) {
  const file = join(temp, `${name}.ts`);
  await writeFile(file, source);
  return import(pathToFileURL(file).href);
}
function shuffle(values, seed) {
  const result = [...values];
  let state = seed >>> 0;
  for (let i = result.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function fixture(policy, seed, maxBrowsers = 2) {
  const state = policy.initialState({ maxBrowsers, memoryBudgetMb: 4096, browserMemoryMb: 2048 });
  state.capabilities = ["interactive", "inbox", "publish"];
  state.accounts = shuffle(
    Array.from({ length: 30 }, (_, i) => ({
      id: `account-${seed}-${i}`,
      channelRef: "synthetic-facebook",
      accountRef: `synthetic-${seed}-${i}`,
      enabled: true,
      authState: "ready",
      credentialVersion: 1,
      loginCiphertext: null,
      proxyCiphertext: null,
      pollSeconds: 900,
      nextPollAt: 0,
      lastCheckedAt: null,
    })),
    seed,
  );
  let id = 0;
  const enqueue = (
    account = state.accounts[id % state.accounts.length],
    kind = "interactive",
    time = 1000,
  ) =>
    policy.enqueueRun(
      state,
      {
        id: `run-${seed}-${++id}`,
        accountId: account.id,
        kind,
        jobRef: null,
        requestedBy: "synthetic-owner",
        authSessionId: "synthetic-session",
      },
      time,
    );
  let claims = 0;
  const claim = (time = 1001, requestId = `request-${seed}-${++claims}`, memory = 65_536) =>
    policy.claimRun(
      state,
      { requestId, leaseId: `lease-${seed}-${claims}`, availableMemoryMb: memory, localSlots: 30 },
      time,
    );
  return { state, enqueue, claim };
}
const experiments = [
  {
    name: "capacity_limit",
    mutate: (s) =>
      replaceOnce(
        s,
        "  if (!availableSlots(state, input.availableMemoryMb, input.localSlots)) return null;",
        "",
      ),
    run(p, seed) {
      const f = fixture(p, seed);
      for (const a of f.state.accounts) f.enqueue(a);
      const count = Array.from({ length: 30 }, () => f.claim()).filter(Boolean).length;
      return { violated: count > 2, allocated: count, limit: 2 };
    },
  },
  {
    name: "memory_budget",
    mutate: (s) =>
      replaceOnce(
        s,
        "      Math.floor(state.limits.memoryBudgetMb / state.limits.browserMemoryMb) - active,",
        "",
      ),
    run(p, seed) {
      const f = fixture(p, seed, 30);
      for (const a of f.state.accounts) f.enqueue(a);
      const count = Array.from({ length: 30 }, () => f.claim(1001, undefined, 16_384)).filter(
        Boolean,
      ).length;
      return { violated: count * 2048 > 4096, reservedMiB: count * 2048, budgetMiB: 4096 };
    },
  },
  {
    name: "current_free_memory",
    mutate: (s) =>
      replaceOnce(s, "      Math.floor(availableMemoryMb / state.limits.browserMemoryMb),", ""),
    run(p, seed) {
      const f = fixture(p, seed);
      f.enqueue();
      const run = f.claim(1001, undefined, 0);
      return { violated: !!run, startedWithZeroAvailable: Number(!!run) };
    },
  },
  {
    name: "same_account_exclusion",
    mutate: (s) => replaceOnce(s, "        !occupied.has(r.accountId) &&", ""),
    run(p, seed) {
      const f = fixture(p, seed);
      f.enqueue(f.state.accounts[0], "interactive");
      f.enqueue(f.state.accounts[0], "inbox");
      const count = [f.claim(), f.claim()].filter(Boolean).length;
      return { violated: count > 1, concurrentLeasesForOneAccount: count };
    },
  },
  {
    name: "claim_idempotency",
    mutate: (s) =>
      replaceOnce(
        s,
        `  if (previous)
    return isLive(previous) && previous.status !== "quarantined" && !previous.stopRequested
      ? previous
      : null;`,
        "",
      ),
    run(p, seed) {
      const f = fixture(p, seed);
      f.enqueue(f.state.accounts[0]);
      f.enqueue(f.state.accounts[1]);
      const runs = Array.from({ length: 10 }, () => f.claim(1001, "same-lost-response-request"));
      const count = new Set(runs.filter(Boolean).map((r) => r.id)).size;
      return { violated: count !== 1, uniqueRunsForOneRequest: count };
    },
  },
  {
    name: "unconfirmed_stop_quarantine",
    mutate: (s) =>
      replaceOnce(
        s,
        'export const LIVE_STATUSES: RunStatus[] = ["starting", "running", "stopping", "quarantined"];',
        'export const LIVE_STATUSES: RunStatus[] = ["starting", "running", "stopping"];',
      ),
    run(p, seed) {
      const f = fixture(p, seed, 1);
      f.enqueue(f.state.accounts[0]);
      f.enqueue(f.state.accounts[1]);
      f.claim();
      // Fault injection: no container-stop acknowledgement was received for the first run.
      const replacement = f.claim(100_000);
      return { violated: !!replacement, replacementBeforeConfirmedStop: Number(!!replacement) };
    },
  },
  {
    name: "credential_version_fence",
    mutate: (s) => replaceOnce(s, "run.credentialVersion !== a.credentialVersion", "false"),
    run(p, seed) {
      const f = fixture(p, seed);
      f.enqueue(f.state.accounts[0]);
      const r = f.claim();
      assert.ok(p.renewRun(f.state, r.id, r.leaseId, true, 1002), "valid lease positive control");
      f.state.accounts[0].credentialVersion++;
      const renewed = p.renewRun(f.state, r.id, r.leaseId, true, 1003);
      return { violated: !!renewed, staleLeaseAccepted: Number(!!renewed) };
    },
  },
  {
    name: "revoked_account_fence",
    mutate: (s) => replaceOnce(s, "    !a?.enabled ||", "    false ||"),
    run(p, seed) {
      const f = fixture(p, seed);
      f.enqueue(f.state.accounts[0]);
      const r = f.claim();
      f.state.accounts[0].enabled = false;
      const renewed = p.renewRun(f.state, r.id, r.leaseId, true, 1003);
      return { violated: !!renewed, revokedLeaseAccepted: Number(!!renewed) };
    },
  },
  {
    name: "priority_aging",
    mutate: (s) => replaceOnce(s, "Math.floor((now - r.createdAt) / 300_000)", "0"),
    run(p, seed) {
      const f = fixture(p, seed, 1);
      const old = f.enqueue(f.state.accounts[0], "inbox", 0);
      let firstGrant = null;
      for (let i = 1; i <= 20; i++) {
        const time = 7_000_000 + i * 1000;
        f.enqueue(f.state.accounts[1], "interactive", time);
        const r = f.claim(time + 1);
        assert.ok(r);
        p.finishRun(f.state, r.id, "completed", true, time + 2);
        if (r.id === old.id) {
          firstGrant = i;
          break;
        }
      }
      return {
        violated: firstGrant === null,
        oldInboxFirstGrant: firstGrant,
        observationGrants: 20,
      };
    },
  },
  {
    name: "installation_binding",
    mutate: (s) =>
      replaceOnce(s, "state.installationId && state.installationId !== installationId", "false"),
    run(p, seed) {
      const f = fixture(p, seed);
      p.bindInstallation(f.state, "host-a");
      p.bindInstallation(f.state, "host-a");
      let accepted = false;
      try {
        p.bindInstallation(f.state, "host-b");
        accepted = true;
      } catch {}
      return { violated: accepted, secondInstallationAccepted: Number(accepted) };
    },
  },
  {
    name: "poll_fast_path_only",
    equivalent: true,
    mutate: (s) =>
      replaceOnce(
        s,
        `    if (
      state.runs.some(
        (r) => r.accountId === a.id && r.kind === "inbox" && (r.status === "queued" || isLive(r)),
      )
    )
      continue;`,
        "",
      ),
    run(p, seed) {
      const f = fixture(p, seed);
      let id = 0;
      for (let i = 0; i < 10; i++) p.scheduleInbox(f.state, 1000 + i, () => `poll-${seed}-${++id}`);
      return { violated: f.state.runs.length !== 30, queuedPolls: f.state.runs.length };
    },
  },
];
const report = {
  design: "paired deterministic source ablation",
  seeds: Array.from({ length: 30 }, (_, i) => i + 1),
  referenceRevision: "2aa242f5d2d512ae4c8d51eccfd4f9aa14ad4c8b",
  testedRevision:
    process.env.REVIEW_REVISION ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  nodeVersion: process.version,
  sourceHashes: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, hash(v)])),
  scope:
    "Production policy functions with synthetic faults; not Facebook/VPS throughput or RAM measurements. Seeds permute fixed inputs; no population significance claim.",
  experiments: [],
};
try {
  const baseline = await moduleFor("baseline-policy", sources.policy);
  for (const e of experiments) {
    const mutated = e.mutate(sources.policy);
    const ablated = await moduleFor(e.name, mutated);
    const trials = report.seeds.map((seed) => ({
      seed,
      baseline: e.run(baseline, seed),
      ablated: e.run(ablated, seed),
    }));
    assert.ok(
      trials.every((t) => !t.baseline.violated),
      `${e.name}: full system failed`,
    );
    assert.ok(
      trials.every((t) => t.ablated.violated !== !!e.equivalent),
      `${e.name}: ablation did not show expected effect`,
    );
    report.experiments.push({
      control: e.name,
      equivalent: !!e.equivalent,
      mutatedHash: hash(mutated),
      baselineViolatedTrials: trials.filter((t) => t.baseline.violated).length,
      ablatedViolatedTrials: trials.filter((t) => t.ablated.violated).length,
      trials,
    });
  }
  const vault = await moduleFor("baseline-vault", sources.vault);
  const unboundSource = replaceOnce(
    sources.vault,
    `      scope.channelRef,
      scope.accountRef,
      purpose,`,
    `      "unbound-channel",
      "unbound-account",
      "unbound-purpose",`,
  );
  const unbound = await moduleFor("unbound-vault", unboundSource);
  function vaultTrial(v, seed) {
    const ring = {
      activeKeyId: "synthetic",
      keys: { synthetic: Buffer.alloc(32, seed).toString("base64") },
    };
    const a = { channelRef: "synthetic", accountRef: "synthetic-a" };
    const cipher = v.encryptFacebookCredential({ marker: "synthetic-only" }, a, "login", ring);
    assert.deepEqual(v.decryptFacebookCredential(cipher, a, "login", ring), {
      marker: "synthetic-only",
    });
    let accepted = false;
    try {
      v.decryptFacebookCredential(cipher, { ...a, accountRef: "synthetic-b" }, "proxy", ring);
      accepted = true;
    } catch {}
    return { violated: accepted, crossScopeCiphertextAccepted: Number(accepted) };
  }
  const vaultTrials = report.seeds.map((seed) => ({
    seed,
    baseline: vaultTrial(vault, seed),
    ablated: vaultTrial(unbound, seed),
  }));
  assert.ok(vaultTrials.every((t) => !t.baseline.violated && t.ablated.violated));
  report.experiments.push({
    control: "vault_account_purpose_aad",
    equivalent: false,
    mutatedHash: hash(unboundSource),
    baselineViolatedTrials: 0,
    ablatedViolatedTrials: 30,
    trials: vaultTrials,
  });

  // Real loopback HTTP/WS tests, same assertions against isolated source variants.
  const gatewaySuite = await readFile(
    join(root, "scripts/test-browser-review-gateway.mjs"),
    "utf8",
  );
  await writeFile(
    join(temp, "viewer.js"),
    await readFile(join(root, "ops/browser-node/viewer.js")),
  );
  const gatewayVariants = [
    ["full", sources.gateway, 0],
    [
      "without_ws_origin",
      replaceOnce(sources.gateway, "request.headers.origin !== entry.slot.gatewayOrigin", "false"),
      1,
    ],
    [
      "without_active_tunnel_expiry",
      replaceOnce(
        sources.gateway,
        "dispose(key, entry);\n    }\n  }, 250);",
        "void entry;\n    }\n  }, 250);",
      ),
      2,
    ],
  ];
  report.gateway = [];
  for (const [name, source, expectedFailures] of gatewayVariants) {
    const file = join(temp, `gateway-${name}.mjs`);
    await writeFile(file, source);
    const suite = join(temp, `test-${name}.mjs`);
    await writeFile(
      suite,
      gatewaySuite.replace(
        '"../ops/browser-node/gateway.mjs"',
        JSON.stringify(pathToFileURL(file).href),
      ),
    );
    const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", suite], {
      encoding: "utf8",
      timeout: 15_000,
    });
    const failed = Number(/# fail (\d+)/.exec(run.stdout)?.[1] ?? -1);
    const passed = Number(/# pass (\d+)/.exec(run.stdout)?.[1] ?? -1);
    assert.equal(failed, expectedFailures, `${name}: ${run.stdout}\n${run.stderr}`);
    assert.equal(passed + failed, 5);
    assert.equal(run.status, expectedFailures ? 1 : 0);
    report.gateway.push({
      variant: name,
      passed,
      failed,
      mutatedHash: hash(source),
      transcript: run.stdout,
    });
  }
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "control-ablation.json"), `${JSON.stringify(report, null, 2)}\n`);
  const csv = ["control,paired_trials,baseline_violated_trials,ablated_violated_trials,equivalent"];
  for (const e of report.experiments)
    csv.push(
      `${e.control},${e.trials.length},${e.baselineViolatedTrials},${e.ablatedViolatedTrials},${e.equivalent}`,
    );
  await writeFile(join(output, "control-ablation.csv"), `${csv.join("\n")}\n`);
  console.log(csv.join("\n"));
  console.log(
    "PASS: isolated control ablations and loopback gateway variants; production source unchanged",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
