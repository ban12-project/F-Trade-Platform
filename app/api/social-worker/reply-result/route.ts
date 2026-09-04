import { NextResponse } from "next/server";

import { recordControlledReplyResult } from "@/lib/sales/closing-store";
import { verifyReplyWorkerResult } from "@/lib/social/reply-result-protocol";

export async function POST(request: Request) {
  try {
    const workerId = process.env.SOCIAL_WORKER_ID;
    if (!workerId) throw new Error("SOCIAL_WORKER_ID is not configured");
    const result = verifyReplyWorkerResult(await request.json(), workerId);
    const saved = await recordControlledReplyResult({ jobId: result.jobId, outcome: result.outcome, externalMessageRef: result.externalMessageRef, failureCode: result.failureCode });
    return NextResponse.json({ jobId: saved.id, status: saved.status });
  } catch {
    return NextResponse.json({ error: "invalid_reply_result" }, { status: 400 });
  }
}
