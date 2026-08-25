import { issueInvitation } from "@/lib/invitations";
import { getAuth } from "@/lib/auth";

function parseEmail(value: unknown) {
  if (!value || typeof value !== "object" || typeof (value as Record<string, unknown>).email !== "string") {
    throw new Error("A valid email is required");
  }
  return (value as Record<string, string>).email;
}

export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session || session.user.role !== "admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  try {
    const invitation = await issueInvitation({ email: parseEmail(await request.json()), invitedBy: session.user.id });
    return Response.json({ invitation }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create invitation" }, { status: 400 });
  }
}
