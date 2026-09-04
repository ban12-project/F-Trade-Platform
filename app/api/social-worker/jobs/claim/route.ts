import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { claimNextSocialWorkerJob } from "@/lib/social/job-store";

const requestSchema = z.object({ workerId: z.string().trim().min(1).max(120) }).strict();

function authorized(request: Request) {
  const expected = process.env.SOCIAL_WORKER_API_KEY;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected); const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const input = requestSchema.parse(await request.json());
    if (!process.env.SOCIAL_WORKER_ID || input.workerId !== process.env.SOCIAL_WORKER_ID) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const claimed = await claimNextSocialWorkerJob(input.workerId);
    return claimed ? NextResponse.json(claimed) : new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "job_claim_failed" }, { status: 400 });
  }
}
