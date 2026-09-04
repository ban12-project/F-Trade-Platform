/** Synthetic, offline control ablation. Production files are never modified. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const variants = ["full", "without_location", "without_human_actor", "without_both"] as const;

async function worker() {
  const { finalizeProductAgentDraft } = await import("../lib/product/agent");
  const { EvidenceLocatedProductAgent } = await import("../lib/product/evidence-located-agent");
  const { approveProductDraft } = await import("../lib/product/verification");
  type Draft = import("../lib/product/verification").ProductDraft;
  type Approval = import("../lib/product/verification").ProductApproval;
  const results = [];
  for (const kind of ["valid", "wrong_location", "agent_approval", "both", "unknown_evidence", "invented_oe"]) {
    // Two different valid/attack records, with fixed inputs across all variants.
    const count = ["unknown_evidence", "invented_oe"].includes(kind) ? 1 : 2;
    for (let index = 1; index <= count; index++) {
      const source = {
        record_id: `synthetic-ablation-${kind}-${index}`,
        source_ref: "synthetic-source-ablation",
        evidence_refs: ["synthetic-evidence-document"],
        source_text: `Product name: Synthetic Kit ${index}\nProduct type: clutch_kit\nInternal SKU: SYN-${index}\nOEM No.: SYN-OE-${index}`,
        image_availability: "none" as const,
        image_refs: [],
      };
      let stage = "draft";
      let accepted = false;
      let error: string | undefined;
      const agent = new EvidenceLocatedProductAgent({
        async run({ source: prepared }) {
          const refs = prepared.evidence_refs;
          const raw: Draft = {
            record_id: prepared.record_id, source_ref: prepared.source_ref,
            evidence_refs: refs,
            field_evidence: {
              "product.product_name": refs[["wrong_location", "both"].includes(kind) ? 2 : 0]!,
              "product.product_type": refs[1]!, "product.internal_sku": refs[2]!,
              "product.oe_numbers": kind === "unknown_evidence" ? "synthetic-unknown-evidence" : refs[3]!,
            },
            verification_status: "review_required", blocking_missing_fields: [], optional_missing_fields: [],
            product: { product_name: `Synthetic Kit ${index}`, product_type: "clutch_kit", internal_sku: `SYN-${index}`, oe_numbers: [kind === "invented_oe" ? "SYN-INVENTED-OE" : `SYN-OE-${index}`] },
          };
          return { draft: finalizeProductAgentDraft(raw, prepared), metadata: { prompt_version: "synthetic-ablation", prompt_hash: "no-model-called" } };
        },
      });
      try {
        const { draft } = await agent.run({ source, model: {} as never });
        stage = "approval";
        const approval = {
          approval_id: "synthetic-approval", gate: "gate_01_truth", entity_type: "product", entity_id: source.record_id,
          status: "approved", decision: { actor_type: ["agent_approval", "both"].includes(kind) ? "agent" : "human", decided_by: "synthetic-reviewer", decided_at: "2026-09-05T00:00:00Z", evidence_ref: "synthetic-review-evidence" },
        } as unknown as Approval;
        accepted = approveProductDraft(draft, approval).verification_status === "verified";
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
      results.push({ id: source.record_id, kind, safe: kind === "valid", accepted, stage, ...(error ? { error } : {}) });
    }
  }
  process.stdout.write(JSON.stringify(results));
}

function replaceExactly(path: string, before: string, after: string) {
  const text = readFileSync(path, "utf8");
  assert.equal(text.split(before).length - 1, 1, `Ablation target drifted: ${path}`);
  writeFileSync(path, text.replace(before, after));
}

async function main() {
  if (process.argv.includes("--worker")) return worker();
  const files = ["lib/product/evidence-located-agent.ts", "lib/product/verification.ts", "lib/product/agent.ts", "lib/product/evidence-locations.ts"];
  const hashes = Object.fromEntries(files.map(path => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]));
  const output = [];
  const require = createRequire(import.meta.url);
  for (const variant of variants) {
    const sandbox = mkdtempSync(join(tmpdir(), "ftrade-safety-ablation-"));
    try {
      for (const directory of ["lib", "contracts"]) cpSync(join(root, directory), join(sandbox, directory), { recursive: true });
      for (const file of ["package.json", "tsconfig.json"]) cpSync(join(root, file), join(sandbox, file));
      mkdirSync(join(sandbox, "scripts"));
      cpSync(fileURLToPath(import.meta.url), join(sandbox, "scripts/run-product-safety-ablation.ts"));
      symlinkSync(realpathSync(join(root, "node_modules")), join(sandbox, "node_modules"), "dir");
      if (["without_location", "without_both"].includes(variant)) {
        replaceExactly(join(sandbox, files[0]!), "    assertProductAgentEvidenceLocations(result.draft, source, finalizeProductAgentDraft);", "    // Experiment only: bounded location validation removed.");
      }
      if (["without_human_actor", "without_both"].includes(variant)) {
        replaceExactly(join(sandbox, files[1]!), '  if (approval.decision.actor_type !== "human") {\n    throw new Error("Product approval requires a human actor");\n  }', "  // Experiment only: human actor validation removed.");
      }
      const cases = JSON.parse(execFileSync(process.execPath, ["--import", require.resolve("tsx"), join(sandbox, "scripts/run-product-safety-ablation.ts"), "--worker"], {
        cwd: sandbox, encoding: "utf8", timeout: 60_000,
        // Do not forward database, model, provider, or other application secrets.
        env: { PATH: process.env.PATH, TMPDIR: tmpdir(), LANG: "C.UTF-8", NODE_ENV: "test" },
      })) as Array<{ id: string; safe: boolean; accepted: boolean }>;
      assert.equal(cases.length, 10);
      assert.equal(new Set(cases.map(item => item.id)).size, 10);
      const valid = cases.filter(item => item.safe);
      const unsafe = cases.filter(item => !item.safe);
      assert.equal(valid.filter(item => item.accepted).length, 2, "Positive controls must remain functional");
      if (variant === "full") assert.equal(unsafe.filter(item => item.accepted).length, 0, "Baseline unsafe acceptance is a regression");
      output.push({ variant, validAccepted: valid.filter(item => item.accepted).length, validTotal: valid.length, unsafeAccepted: unsafe.filter(item => item.accepted).length, unsafeTotal: unsafe.length, cases });
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }
  for (const path of files) assert.equal(createHash("sha256").update(readFileSync(join(root, path))).digest("hex"), hashes[path], "Production source changed");
  console.log(JSON.stringify({ experiment: "product-safety-control-ablation-v1", syntheticOnly: true, modelCalls: 0, sourceHashes: hashes, results: output }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
