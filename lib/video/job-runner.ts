import { and, eq } from "drizzle-orm";

import { getDatabase, type Database } from "@/lib/db/client";
import { aggregateRecord } from "@/lib/db/schema";

import { completeVideoJob, claimConfiguredVideoJob, failVideoJob, type VideoJobRecord } from "./job-store";
import { submitVideoGeneration, type VideoGenerationAdapter } from "./execution";
import { loadVideoExecutionConfiguration, resolveVideoProviderCredential } from "./provider-config-store";
import { videoProjectSchema } from "./contracts";
import { videoGenerationRequestSchema, videoProviderIdSchema, type VideoProviderId } from "./provider-capabilities";

export type RunVideoJobResult =
  | { kind: "idle" }
  | { kind: "rejected"; jobId: string; reason: "budget_limit" | "concurrency_limit" }
  | { kind: "succeeded"; jobId: string; resultAssetRef: string }
  | { kind: "failed"; jobId: string; failureCode: string; retryScheduled: boolean };

export type VideoJobRunnerDependencies = {
  adapters: readonly VideoGenerationAdapter[];
  database?: Database;
  retryDelayMs?: number;
};

function failureCode(error: unknown) {
  if (error instanceof Error && /^retryable:/i.test(error.message)) return "provider_retryable";
  if (error instanceof Error && /未启用|未配置|尚未通过验证|不满足|不支持|预算|并发/i.test(error.message)) return "configuration_rejected";
  return "provider_submission_failed";
}

function retryAt(error: unknown, delayMs: number) {
  return error instanceof Error && /^retryable:/i.test(error.message)
    ? new Date(Date.now() + delayMs)
    : undefined;
}

async function videoProjectForJob(job: VideoJobRecord, database: Database) {
  const [row] = await database.select({ payload: aggregateRecord.payload }).from(aggregateRecord).where(and(
    eq(aggregateRecord.id, job.videoProjectId),
    eq(aggregateRecord.type, "video"),
  ));
  if (!row) throw new Error("video project not found");
  return videoProjectSchema.parse(row.payload);
}

/**
 * Performs one leased job for a specific provider. Scheduler invocation is
 * deliberately external: this module is safe for a cron worker, Workflow, or
 * queue consumer, and cannot publish to social platforms.
 */
export async function runNextConfiguredVideoJob(
  workerId: string,
  providerInput: VideoProviderId,
  dependencies: VideoJobRunnerDependencies,
): Promise<RunVideoJobResult> {
  const provider = videoProviderIdSchema.parse(providerInput);
  const database = dependencies.database ?? getDatabase();
  const claimed = await claimConfiguredVideoJob(workerId, provider, undefined, database);
  if (!claimed) return { kind: "idle" };
  if (claimed.kind === "rejected") return { kind: "rejected", jobId: claimed.job.id, reason: claimed.reason };
  const job = claimed.job;
  let maximumAttempts = 1;
  try {
    const [configuration, project] = await Promise.all([
      loadVideoExecutionConfiguration(database),
      videoProjectForJob(job, database),
    ]);
    // The job's reservation is already included in committed budget. Subtract
    // just that reservation for the pure execution policy's pre-submit check.
    const policies = configuration.policies.map((policy) => policy.provider === provider
      ? { ...policy, budgetCommittedCents: Math.max(0, policy.budgetCommittedCents - job.reservedCostCents) }
      : policy);
    maximumAttempts = policies.find((policy) => policy.provider === provider)?.maximumAttempts ?? 1;
    const generation = videoGenerationRequestSchema.parse({
      provider,
      modelId: job.modelId,
      requiredCapabilities: job.requiredCapabilities,
      aspectRatio: job.aspectRatio,
      durationSeconds: job.durationSeconds,
      resolution: job.resolution,
    });
    const result = await submitVideoGeneration({
      project,
      generation,
      expectedCostCents: job.expectedCostCents,
    }, {
      catalog: configuration.catalog,
      policies,
      adapters: dependencies.adapters,
      // claimConfiguredVideoJob holds the provider concurrency boundary.
      activeJobsByProvider: {},
      resolveCredential: (reference) => resolveVideoProviderCredential(reference, database),
    });
    const completed = await completeVideoJob(job.id, workerId, result.resultAssetRef, database);
    return { kind: "succeeded", jobId: completed.id, resultAssetRef: result.resultAssetRef };
  } catch (error) {
    const code = failureCode(error);
    const retry = retryAt(error, dependencies.retryDelayMs ?? 60_000);
    const failed = await failVideoJob(job.id, workerId, code, retry, maximumAttempts, database);
    return { kind: "failed", jobId: failed.id, failureCode: code, retryScheduled: failed.status === "queued" };
  }
}
