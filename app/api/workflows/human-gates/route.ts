import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";

import { auth } from "../../../../lib/auth";
import { getDatabase } from "../../../../lib/db/client";
import { approval } from "../../../../lib/db/schema";
import {
  type HumanGate,
  type HumanGateWorkflowInput,
  humanGateToken,
  waitForHumanGate,
} from "../../../../workflows/human-gate";

const gates = new Set<HumanGate>(["gate_01_truth", "gate_02_quote", "gate_03_delivery"]);

function parseInput(value: unknown): HumanGateWorkflowInput {
  if (!value || typeof value !== "object") throw new Error("Invalid request body");
  const body = value as Record<string, unknown>;
  if (
    typeof body.approvalId !== "string" ||
    typeof body.aggregateId !== "string" ||
    typeof body.gate !== "string" ||
    !gates.has(body.gate as HumanGate)
  ) {
    throw new Error("Invalid Human Gate workflow input");
  }
  return {
    approvalId: body.approvalId,
    aggregateId: body.aggregateId,
    gate: body.gate as HumanGate,
  };
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let input: HumanGateWorkflowInput;
  try {
    input = parseInput(await request.json());
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
