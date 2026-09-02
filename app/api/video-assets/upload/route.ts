import { head, issueSignedToken } from "@vercel/blob";
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/authz";
import { completeVideoUploadReceipt, issueVideoUploadReceipt } from "@/lib/video/upload-receipts";
import { completedVideoUploadTokenSchema, videoPresignedUploadPayloadSchema, videoUploadBlobPath } from "@/lib/video/upload-contracts";

export async function POST(request: Request) {
  let body: HandleUploadPresignedBody;
  try {
    body = await request.json() as HandleUploadPresignedBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const response = await handleUploadPresigned({
      request,
      body,
      getSignedToken: async (pathname, clientPayload) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session || !hasPermission(session.user.role, "video:write")) throw new Error("无权上传营销视频素材。");
        const payload = videoPresignedUploadPayloadSchema.parse(JSON.parse(clientPayload ?? "null"));
        const expectedPath = videoUploadBlobPath(payload);
        if (pathname !== expectedPath) throw new Error("上传路径不符合授权范围。");
        const receipt = await issueVideoUploadReceipt(payload, session.user.id);
        const tokenPayload = completedVideoUploadTokenSchema.parse({ ...payload, actorId: session.user.id, blobPath: receipt.blobPath });
        const token = await issueSignedToken({
          pathname: receipt.blobPath,
          operations: ["put"],
          validUntil: receipt.expiresAt.getTime(),
          allowedContentTypes: [payload.contentType],
          maximumSizeInBytes: payload.sizeBytes,
        });
        return {
          token,
          urlOptions: {
            validUntil: receipt.expiresAt.getTime(),
            allowedContentTypes: [payload.contentType],
            maximumSizeInBytes: payload.sizeBytes,
            allowOverwrite: false,
            addRandomSuffix: false,
            cacheControlMaxAge: 60,
            tokenPayload: JSON.stringify(tokenPayload),
          },
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const metadata = await head(blob.pathname);
        await completeVideoUploadReceipt(JSON.parse(tokenPayload ?? "null"), { pathname: blob.pathname, contentType: blob.contentType, size: metadata.size });
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to authorize upload" }, { status: 400 });
  }
}
