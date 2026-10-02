import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { generateText, jsonSchema, Output } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { productAgentEvalCases } from "../evals/harbor/product-agent/cases";
import {
  SELECTION_EXECUTION_MONITOR,
  SelectionExecutionClock,
} from "../evals/harbor/product-agent/execution-health";
import { evaluationExpectation } from "../evals/harbor/product-agent/expectations";
import { summarizeSelection } from "../evals/harbor/product-agent/selection-summary";
import { createProductAgentModel, type ProductAgentModelConfig } from "../lib/ai/model-provider";
import { resolveProductOutputPolicy } from "../lib/ai/product-output-policy";
import { runProductAgentEvaluation } from "../lib/product/evaluation-run";

const modelSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,70}$/),
    provider: z.enum(["openai", "anthropic", "google", "openai-compatible"]),
    model: z.string().regex(/^[a-zA-Z0-9_.-]+$/),
    apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
    baseUrl: z.url().optional(),
    baseUrlEnv: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]+$/)
      .optional(),
    outputMode: z.enum(["text", "json", "json_schema"]).optional(),
  })
  .strict()
  .refine((value) => !(value.baseUrl && value.baseUrlEnv), "Specify one endpoint source");
const configSchema = z
  .object({
    models: z.array(modelSchema).min(1).max(10),
    concurrency: z.number().int().min(1).max(8).default(4),
  })
  .strict();
function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i < 0 ? undefined : process.argv[i + 1];
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function main() {
  process.umask(0o077);
  const configPath = arg("--config"),
    output = arg("--output");
  if (!configPath || !output)
    throw new Error("Use --config <private configuration.json> --output <new ignored directory>");
  const config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  if (new Set(config.models.map((m) => m.name)).size !== config.models.length)
    throw new Error("Duplicate model name");
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
  if (dirty && !process.argv.includes("--allow-dirty"))
    throw new Error(
      "Commit evaluation code before a selection batch; --allow-dirty is diagnostic only",
    );
  const envFile = arg("--env-file");
  const vars = envFile ? parseEnv(await readFile(envFile, "utf8")) : process.env;
  const required = (name: string) => {
    const value = vars[name];
    if (!value) throw new Error(`Missing configured credential variable ${name}`);
    return value;
  };
  // Validate every credential before creating a batch. Never copy this config into public artifacts.
  const models = config.models.map((m) => {
    const value: ProductAgentModelConfig = {
      provider: m.provider,
      model: m.model,
      outputMode: m.outputMode,
      providerOptions: {
        apiKey: required(m.apiKeyEnv),
        baseURL: m.baseUrlEnv ? required(m.baseUrlEnv) : m.baseUrl,
      },
    };
    const model = createProductAgentModel(value);
    return {
      name: m.name,
      model,
      policy: resolveProductOutputPolicy(value),
      id: `${m.provider}/${m.model}`,
    };
  });
  const root = resolve(output);
  // Raw outputs must remain outside version control, including accidental git add.
  execFileSync("git", ["check-ignore", "--quiet", `${root}/private.json`]);
  await mkdir(root, { recursive: false, mode: 0o700 });
  const frozen = productAgentEvalCases.map(evaluationExpectation);
  const verifier = await readFile(
    new URL("../evals/harbor/product-agent/verifier.py", import.meta.url),
  );
  const verifierPath = `${root}/verifier.py`;
  await writeFile(verifierPath, verifier, { flag: "wx", mode: 0o600 });
  const manifest = {
    run_id: randomUUID(),
    protocol_version: "model-selection-v2",
    execution: "local-production-policy",
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    diagnostic_only: Boolean(dirty),
    grading: {
      diagnostic_revision: 2,
      verifier_sha256: createHash("sha256").update(verifier).digest("hex"),
    },
    execution_monitor: SELECTION_EXECUTION_MONITOR,
    started_at: new Date().toISOString(),
    concurrency: config.concurrency,
    repetitions: 3,
    total_timeout_ms: 75000,
    max_corrections: 1,
    models: models.map((m) => ({ name: m.name, id: m.id, output_policy: m.policy })),
    tasks: frozen.map((t) => ({
      id: t.id,
      expectation_hash: t.expectation_hash,
      source_hash: hash(t.source),
      prompt_hash: t.prompt_hash,
      prompt_version: t.prompt_version,
    })),
  };
  const writeNew = (path: string, value: unknown) =>
    writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await writeNew(`${root}/manifest.json`, manifest);
  await mkdir(`${root}/expected`);
  for (const task of frozen) await writeNew(`${root}/expected/${task.id}.json`, task);
  const reports: Array<{
    model: string;
    id: string;
    repetition: number;
    report: Record<string, unknown>;
  }> = [];
  const preflights: Array<{
    model: string;
    available: boolean;
    image_correct: boolean;
    output_mode: string;
  }> = [];
  const clock = new SelectionExecutionClock(Date.now());
  const timer = setInterval(() => clock.observe(Date.now()), 1000);
  timer.unref();
  const image = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  for (const target of models) {
    await mkdir(`${root}/${target.name}`);
    let available = false,
      imageCorrect = false;
    try {
      const result = await generateText({
        model: target.model,
        instructions:
          'Return only a JSON object {"color": string, "count": integer, "available": boolean}. Report the image color, count=2 and available=true.',
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Inspect the image and return the specified JSON." },
              { type: "file", data: image, mediaType: "image/png" },
            ],
          },
        ],
        output:
          target.policy.mode === "json_schema"
            ? Output.object({
                schema: jsonSchema({
                  type: "object",
                  properties: {
                    color: { type: "string" },
                    count: { type: "integer" },
                    available: { type: "boolean" },
                  },
                  required: ["color", "count", "available"],
                  additionalProperties: false,
                }),
              })
            : target.policy.mode === "json"
              ? Output.json()
              : Output.text(),
        abortSignal: AbortSignal.timeout(75000),
      });
      const value = typeof result.output === "string" ? JSON.parse(result.output) : result.output;
      available = true;
      imageCorrect =
        value?.color?.toLowerCase() === "red" && value.count === 2 && value.available === true;
      await writeNew(`${root}/${target.name}/preflight-private.json`, {
        output: value,
        usage: result.usage,
      });
    } catch (error) {
      await writeNew(`${root}/${target.name}/preflight-private.json`, {
        error: error instanceof Error ? error.message : "Preflight failed",
      });
    }
    preflights.push({
      model: target.name,
      available,
      image_correct: imageCorrect,
      output_mode: target.policy.mode,
    });
    console.log(
      JSON.stringify({
        stage: "preflight",
        model: target.name,
        available,
        image_correct: imageCorrect,
        output_mode: target.policy.mode,
      }),
    );
  }
  await writeNew(`${root}/preflights.json`, preflights);
  const queue = frozen.flatMap((task) =>
    [1, 2, 3].flatMap((repetition) =>
      models
        .filter((m) => preflights.some((p) => p.model === m.name && p.available))
        .map((target) => ({ task, repetition, target })),
    ),
  );
  let infrastructureFailed = false;
  async function worker() {
    for (;;) {
      const next = queue.shift();
      if (!next) break;
      const { task, repetition, target } = next;
      const prefix = `${root}/${target.name}/${task.id}-${repetition}`;
      const result = await runProductAgentEvaluation({ model: target.model, source: task.source });
      await writeNew(`${prefix}-private.json`, result);
      try {
        execFileSync(
          "python3",
          [
            verifierPath,
            "--expected",
            `${root}/expected/${task.id}.json`,
            "--result",
            `${prefix}-private.json`,
            "--report",
            `${prefix}-report.json`,
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        const report = JSON.parse(await readFile(`${prefix}-report.json`, "utf8"));
        reports.push({ model: target.name, id: task.id, repetition, report });
        console.log(
          JSON.stringify({
            model: target.name,
            id: task.id,
            repetition,
            passed: report.reward === 1,
            attempts: report.attempts.length,
            completed: reports.length,
          }),
        );
      } catch {
        infrastructureFailed = true;
        console.log(
          JSON.stringify({
            model: target.name,
            id: task.id,
            repetition,
            error: "grading_infrastructure",
          }),
        );
      }
    }
  }
  await Promise.all(Array.from({ length: config.concurrency }, worker));
  clock.observe(Date.now());
  clearInterval(timer);
  const summary = summarizeSelection(manifest, preflights, reports);
  const health = clock.assess(summary.trials.map((t) => t.report.duration_ms));
  const measurementValid = health.valid && !infrastructureFailed;
  const status = measurementValid ? summary.status : "incomplete";
  await writeNew(`${root}/summary.json`, {
    ...summary,
    status,
    measurement_valid: measurementValid,
    execution_health: health,
    finished_at: new Date().toISOString(),
    infrastructure_failed: infrastructureFailed,
  });
  console.log(JSON.stringify({ output: `${root}/summary.json`, status }));
  if (!measurementValid || status === "incomplete") process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Model selection run failed; inspect configuration and private local artifacts. No credentials printed.",
  );
  process.exitCode = 1;
});
