import { NextResponse } from "next/server";

import { MockOfficialChannelServer } from "../../../../lib/testing/mock-official-channel";

const mockServer = new MockOfficialChannelServer();

function testingApiEnabled() {
  return process.env.NEXT_ENABLE_TESTING_API === "1";
}

export async function POST(request: Request) {
  if (!testingApiEnabled()) return new Response(null, { status: 404 });

  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object") {
    return NextResponse.json({ error: "invalid_test_request" }, { status: 400 });
  }
  const { action } = input as { action?: unknown };
  if (action === "reset") return NextResponse.json(mockServer.reset());
  if (action === "deliver" || action === "duplicate" || action === "fail" || action === "retry") {
    const messageId =
      action === "deliver" || action === "duplicate"
        ? "synthetic-webhook-001"
        : "synthetic-webhook-002";
    const result = await mockServer.deliver(messageId, { failDownstream: action === "fail" });
    return NextResponse.json(result, { status: result.status === "rejected" ? 502 : 200 });
  }
  return NextResponse.json({ error: "unknown_test_action" }, { status: 400 });
}
