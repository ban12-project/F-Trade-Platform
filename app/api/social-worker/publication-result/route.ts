import { NextResponse } from "next/server";

import { recordControlledPublicationResult } from "@/lib/social/publication-store";
import { verifyPublicationWorkerResult } from "@/lib/social/publication-result-protocol";

export async function POST(request: Request) {
  try {
    const workerId = process.env.SOCIAL_WORKER_ID;
    if (!workerId) throw new Error("SOCIAL_WORKER_ID is not configured");
    const result = verifyPublicationWorkerResult(await request.json(), workerId);
    const saved = await recordControlledPublicationResult({ jobId: result.jobId, outcome: result.outcome, externalPublicationRef: result.externalPublicationRef, failureCode: result.failureCode });
    return NextResponse.json({ publicationId: saved.id, status: saved.status });
  } catch {
    return NextResponse.json(
      { error: "invalid_publication_result" },
      { status: 400 },
    );
  }
}
