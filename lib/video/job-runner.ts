import { and, eq } from "drizzle-orm";

import { type Database, getDatabase } from "@/lib/db/client";
import { aggregateRecord } from "@/lib/db/schema";
import type { VideoProject } from "./contracts";
import { videoProjectSchema } from "./contracts";
import type { VideoProviderExecutionPolicy } from "./execution";
import { submitVideoGeneration, type VideoGenerationAdapter } from "./execution";
import {
  claimConfiguredVideoJob,
  completeVideoJob,
  failVideoJob,
  type VideoJobRecord,
} from "./job-store";
import {
  type VideoModelCapability,
  type VideoProviderId,
  videoGenerationRequestSchema,
  videoProviderIdSchema,
} from "./provider-capabilities";
import {
  loadVideoExecutionConfiguration,
  resolveVideoProviderCredential,
} from "./provider-config-store";

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

export function classifyVideoJobFailure(error: unknown) {
  if (error instanceof Error && /^retryable:/i.test(error.message)) return "provider_retryable";
  if (
    error instanceof Error &&
    /未启用|未配置|尚未通过验证|不满足|不支持|预算|并发/i.test(error.message)
  )
    return "configuration_rejected";
  return "provider_submission_failed";
}

export function retryVideoJobAt(error: unknown, delayMs: number) {
  return error instanceof Error && /^retryable:/i.test(error.message)
    ? new Date(Date.now() + delayMs)
    : undefined;
}

export type LeasedVideoExecutionDependencies = {
  project: VideoProject;
  catalog: readonly VideoModelCapability[];
  policies: readonly VideoProviderExecutionPolicy[];
  adapters: readonly VideoGenerationAdapter[];
  resolveCredential: (reference: string) => Promise<string>;
};

/** Executes a pre-claimed lease without touching scheduling or publication. */
export async function executeLeasedVideoJob(
  job: VideoJobRecord,
  provider: VideoProviderId,
  dependencies: LeasedVideoExecutionDependencies,
) {
  const policies = dependencies.policies.map((policy) =>
    policy.provider === provider
      ? {
          ...policy,
          budgetCommittedCents: Math.max(0, policy.budgetCommittedCents - job.reservedCostCents),
        }
      : policy,
  );
  const generation = videoGenerationRequestSchema.parse({
    provider,
    modelId: job.modelId,
    requiredCapabilities: job.requiredCapabilities,
    aspectRatio: job.aspectRatio,
    durationSeconds: job.durationSeconds,
    resolution: job.resolution,
  });
  const result = await submitVideoGeneration(
    {
      project: dependencies.project,
      generation,
      expectedCostCents: job.expectedCostCents,
    },
    {
      catalog: dependencies.catalog,
      policies,
      adapters: dependencies.adapters,
      activeJobsByProvider: {},
      resolveCredential: dependencies.resolveCredential,
    },
  );
  return {
    result,
    maximumAttempts: policies.find((policy) => policy.provider === provider)?.maximumAttempts ?? 1,
  };
}

async function videoProjectForJob(job: VideoJobRecord, database: Database) {
  const [row] = await database
    .select({ payload: aggregateRecord.payload })
    .from(aggregateRecord)
    .where(and(eq(aggregateRecord.id, job.videoProjectId), eq(aggregateRecord.type, "video")));
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
  if (claimed.kind === "rejected")
    return { kind: "rejected", jobId: claimed.job.id, reason: claimed.reason };
  const job = claimed.job;
  let maximumAttempts = 1;
  try {
    const [configuration, project] = await Promise.all([
      loadVideoExecutionConfiguration(database),
      videoProjectForJob(job, database),
    ]);
    const execution = await executeLeasedVideoJob(job, provider, {
      project,
      catalog: configuration.catalog,
      policies: configuration.policies,
      adapters: dependencies.adapters,
      resolveCredential: (reference) => resolveVideoProviderCredential(reference, database),
    });
    maximumAttempts = execution.maximumAttempts;
    const completed = await completeVideoJob(
      job.id,
      workerId,
      execution.result.resultAssetRef,
      database,
    );
    return {
      kind: "succeeded",
      jobId: completed.id,
      resultAssetRef: execution.result.resultAssetRef,
    };
  } catch (error) {
    const code = classifyVideoJobFailure(error);
    const retry = retryVideoJobAt(error, dependencies.retryDelayMs ?? 60_000);
    const failed = await failVideoJob(job.id, workerId, code, retry, maximumAttempts, database);
    return {
      kind: "failed",
      jobId: failed.id,
      failureCode: code,
      retryScheduled: failed.status === "queued",
    };
  }
}
