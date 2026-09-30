import { salesStateLabels } from "@/lib/sales/journey";
export function SubmissionFeedback({ status, message }: { status: string; message: string }) {
  return message ? (
    <p
      className={status === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
      aria-live="polite"
    >
      {message}
    </p>
  ) : null;
}
export function salesRecordStateLabel(state: string) {
  return salesStateLabels[state] ?? "查看记录";
}
