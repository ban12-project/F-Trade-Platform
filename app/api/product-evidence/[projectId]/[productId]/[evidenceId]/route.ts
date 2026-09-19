import { z } from "zod";
import { auth } from "@/lib/auth";
import { readProductEvidence } from "@/lib/product/evidence-preview";

/** Native file viewing/download requires an authenticated binary GET. */
export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string; productId: string; evidenceId: string }> },
) {
  const privateHeaders = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Forbidden", { status: 403, headers: privateHeaders });
  try {
    const { projectId, productId, evidenceId } = z
      .object({ projectId: z.uuid(), productId: z.uuid(), evidenceId: z.string().min(1).max(200) })
      .parse(await context.params);
    const file = await readProductEvidence(projectId, productId, evidenceId, session.user.id);
    if (!file) return new Response("Not found", { status: 404, headers: privateHeaders });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type":
          file.contentType === "text/csv" ? "text/plain; charset=utf-8" : file.contentType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `${file.inline ? "inline" : "attachment"}; filename="${file.filename}"`,
      },
    });
  } catch {
    return new Response("Source unavailable", { status: 404, headers: privateHeaders });
  }
}
