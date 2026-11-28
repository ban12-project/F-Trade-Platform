import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { z } from "zod";

import { auth } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db/client";
import { approval } from "../../../../lib/db/schema";
import { humanGates } from "../../../../lib/workflow/vocabulary";
import {
  type HumanGateWorkflowInput,
  humanGateToken,
  waitForHumanGate,
} from "../../../../workflows/human-gate";

const workflowInput = z.object({
  approvalId: z.string(),
  aggregateId: z.string(),
  gate: z.enum(humanGates),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (session?.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let input: HumanGateWorkflowInput;
  try {
    input = workflowInput.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const [pending] = await getDatabase()
    .select({ id: approval.id })
    .from(approval)
    .where(
      and(
        eq(approval.id, input.approvalId),
        eq(approval.aggregateId, input.aggregateId),
        eq(approval.gate, input.gate),
        eq(approval.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending) {
    return Response.json({ error: "Pending approval not found" }, { status: 404 });
  }

  const run = await start(waitForHumanGate, [input]);
  return Response.json(
    {
      runId: run.runId,
      hookToken: humanGateToken(input.approvalId),
    },
    { status: 202 },
  );
}
