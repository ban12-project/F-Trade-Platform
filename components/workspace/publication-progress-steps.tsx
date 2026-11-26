"use client";

import { AlertTriangle, CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import type {
  PublicationStepProgress,
  PublicationStepStatus,
} from "@/lib/social/publication-presentation";
import { cn } from "@/lib/utils";

const stepStatusText: Record<PublicationStepStatus, string> = {
  completed: "已完成",
  active: "进行中",
  failed: "已中止",
  warning: "待核对",
  pending: "未开始",
};

const trackIndicatorTone: Record<PublicationStepProgress["tone"], string> = {
  progressing: "",
  complete:
    "[&_[data-slot=progress-indicator]]:bg-emerald-600 dark:[&_[data-slot=progress-indicator]]:bg-emerald-500",
  failed: "[&_[data-slot=progress-indicator]]:bg-destructive",
  warning:
    "[&_[data-slot=progress-indicator]]:bg-amber-600 dark:[&_[data-slot=progress-indicator]]:bg-amber-500",
};

function StepIcon({ status }: { status: PublicationStepStatus }) {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
        />
      );
    case "active":
      return (
        <Loader2
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 animate-spin text-primary motion-reduce:animate-none"
        />
      );
    case "failed":
      return <XCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />;
    case "warning":
      return (
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        />
      );
    case "pending":
      return <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
  }
}

export function PublicationProgressSteps({ progress }: { progress: PublicationStepProgress }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
      <Progress
        value={progress.completedSteps}
        min={0}
        max={progress.totalSteps}
        className={cn("[&_[data-slot=progress-track]]:h-2", trackIndicatorTone[progress.tone])}
        getValueLabel={(value, details) =>
          `${progress.currentLabel}，已完成 ${value ?? 0} / ${details.max} 步（${details.percent ?? 0}%）`
        }
      >
        <ProgressLabel>{progress.currentLabel}</ProgressLabel>
        <ProgressValue>
          {() => `${progress.completedSteps} / ${progress.totalSteps} 步`}
        </ProgressValue>
      </Progress>
      <ol aria-label="发布步骤详情" className="grid gap-1.5 text-sm">
        {progress.steps.map((step, index) => (
          <li
            key={step.id}
            data-step-status={step.status}
            className={cn(
              "flex items-start justify-between gap-3 rounded-md px-2 py-1",
              step.status === "active" && "bg-background font-medium",
              step.status === "failed" && "bg-destructive/10 text-destructive",
              step.status === "warning" && "bg-amber-500/10 text-amber-900 dark:text-amber-200",
              step.status === "pending" && "text-muted-foreground",
            )}
          >
            <div className="flex min-w-0 items-start gap-2">
              <StepIcon status={step.status} />
              <div className="min-w-0">
                <p>
                  {index + 1}. {step.label}
                </p>
                {step.detail ? (
                  <p
                    className={cn(
                      "text-xs",
                      step.status === "failed"
                        ? "text-destructive"
                        : step.status === "warning"
                          ? "text-amber-800 dark:text-amber-300"
                          : "text-muted-foreground",
                    )}
                  >
                    {step.detail}
                  </p>
                ) : null}
              </div>
            </div>
            <span className="shrink-0 text-xs tabular-nums">{stepStatusText[step.status]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
