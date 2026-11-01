import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { openFacebookPublicationPreview } from "@/lib/social/facebook-media-store";

// Native image/video elements require an authenticated HTTP stream, not an Action.
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !hasPermission(session.user.role, "workspace:view"))
    return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const source = await openFacebookPublicationPreview(
      Object.fromEntries(new URL(request.url).searchParams),
      session.user.id,
    );
    return new Response(source.stream, {
      headers: {
        "Content-Type": source.contentType,
        "Content-Length": String(source.sizeBytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": "inline",
        "Cross-Origin-Resource-Policy": "same-origin",
        Vary: "Cookie",
      },
    });
  } catch {
    return new Response("Preview unavailable", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
