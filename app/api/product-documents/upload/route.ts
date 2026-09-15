import { issueSignedToken } from "@vercel/blob";
import { type HandleUploadPresignedBody, handleUploadPresigned } from "@vercel/blob/client";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import {
  documentUploadPath,
  documentUploadPayloadSchema,
} from "@/lib/product/document-upload-contracts";
import { issueDocumentUploadReceipt } from "@/lib/product/document-upload-receipts";

/** Third-party Blob signing protocol; file bytes never traverse this request. */
export async function POST(request: Request) {
  const origins = new Set([new URL(request.url).origin]);
  if (process.env.BETTER_AUTH_URL) origins.add(new URL(process.env.BETTER_AUTH_URL).origin);
  if (!origins.has(request.headers.get("origin") ?? ""))
    return Response.json({ error: "请求来源无效。" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !hasPermission(session.user.role, "product:write"))
    return Response.json({ error: "无权上传产品资料。" }, { status: 403 });
  try {
    const body = (await request.json()) as HandleUploadPresignedBody;
    const response = await handleUploadPresigned({
      request,
      body,
      getSignedToken: async (pathname, clientPayload) => {
        const payload = documentUploadPayloadSchema.parse(JSON.parse(clientPayload ?? "null"));
        if (pathname !== documentUploadPath(payload)) throw new Error("上传路径无效。");
        const receipt = await issueDocumentUploadReceipt(payload, session.user.id);
        const constraints = {
          validUntil: receipt.expiresAt.getTime(),
          allowedContentTypes: [receipt.contentType],
          maximumSizeInBytes: receipt.sizeBytes,
        };
        return {
          token: await issueSignedToken({
            pathname: receipt.blobPath,
            operations: ["put"],
            ...constraints,
          }),
          urlOptions: {
            ...constraints,
            allowOverwrite: false,
            addRandomSuffix: false,
            cacheControlMaxAge: 60,
          },
        };
      },
    });
    return Response.json(response);
  } catch {
    return Response.json({ error: "无法授权上传，请检查文件和项目权限后重试。" }, { status: 400 });
  }
}
