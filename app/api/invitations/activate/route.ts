import { provisionInvitedUser } from "@/lib/invitations";

function parseInput(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Invalid invitation");
  const body = value as Record<string, unknown>;
  if (typeof body.email !== "string" || typeof body.token !== "string") throw new Error("Invalid invitation");
  return { email: body.email, token: body.token };
}

export async function POST(request: Request) {
  try {
    await provisionInvitedUser(parseInput(await request.json()));
    return Response.json({ success: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to activate invitation" }, { status: 400 });
  }
}
