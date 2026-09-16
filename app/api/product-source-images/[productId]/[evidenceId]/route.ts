import { auth } from "@/lib/auth";
import { readProductSourceImage } from "@/lib/product/source-image-preview";

/** Native image viewing needs an authenticated binary GET, not an Action payload. */
export async function GET(
  request: Request,
  context: { params: Promise<{ productId: string; evidenceId: string }> },
) {
  const privateHeaders = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Forbidden", { status: 403, headers: privateHeaders });
  try {
    const { productId, evidenceId } = await context.params;
    const image = await readProductSourceImage(productId, evidenceId, session.user.id);
    if (!image) return new Response("Not found", { status: 404, headers: privateHeaders });
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        ...privateHeaders,
        "Content-Type": image.contentType,
        "Content-Length": String(image.bytes.length),
        "Content-Disposition": "inline",
      },
    });
  } catch {
    return new Response("Image unavailable", { status: 404, headers: privateHeaders });
  }
}
