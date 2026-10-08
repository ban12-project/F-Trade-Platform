import assert from "node:assert/strict";
import { mock } from "node:test";
import {
  ProductDocumentAccessError,
  ProductUploadError,
  productIntakeErrorMessage,
} from "../lib/product/intake-errors";

const projectId = "11111111-1111-4111-8111-111111111111",
  receiptId = "22222222-2222-4222-8222-222222222222";
const identity = { actorId: "SYNTHETIC actor", sessionId: "SYNTHETIC session", projectId };
const privateDetail = "SYNTHETIC private credential / storage URL / provider response";
let authenticated = true,
  authFailure: unknown,
  claimFailure: unknown,
  cacheFailure = false;
let issueFailure: unknown,
  signFailure: unknown,
  accessFailure: unknown,
  claims = 0,
  reservations = 0,
  guards = 0;
const authSession = async () => {
  if (authFailure) throw authFailure;
  return authenticated
    ? { user: { id: identity.actorId, role: "user" }, session: { id: identity.sessionId } }
    : null;
};
mock.module(new URL("../lib/action-boundary.ts", import.meta.url).href, {
  exports: {
    authorizedActionSession: authSession,
    refreshWorkspace: () => {
      if (cacheFailure) throw Error(privateDetail);
    },
  },
});
mock.module(new URL("../lib/auth.ts", import.meta.url).href, {
  exports: { auth: { api: { getSession: authSession } } },
});
mock.module(new URL("../lib/product/document-upload-receipts.ts", import.meta.url).href, {
  exports: {
    claimDocumentUpload: async (_input: unknown, current: unknown) => {
      claims++;
      assert.deepEqual(current, identity);
      if (claimFailure) throw claimFailure;
      return { evidenceId: "SYNTHETIC evidence", bytes: Buffer.from(privateDetail) };
    },
    issueDocumentUploadReceipt: async (input: Record<string, unknown>, current: unknown) => {
      reservations++;
      assert.deepEqual(current, identity);
      if (issueFailure) throw issueFailure;
      return {
        ...input,
        ownerId: identity.actorId,
        blobPath: `product-documents/${projectId}/${receiptId}.csv`,
        expiresAt: new Date(Date.now() + 60_000),
      };
    },
    assertDocumentUploadReceiptAccess: async (_receipt: unknown, current: unknown) => {
      guards++;
      assert.deepEqual(current, identity);
      if (accessFailure) throw accessFailure;
    },
  },
});
mock.module("@vercel/blob", {
  exports: {
    issueSignedToken: async () => {
      if (signFailure) throw signFailure;
      return "SYNTHETIC bearer";
    },
  },
});
mock.module("@vercel/blob/client", {
  exports: {
    handleUploadPresigned: async ({
      body,
      getSignedToken,
    }: {
      body: { payload: { pathname: string; clientPayload: string } };
      getSignedToken: (path: string, payload: string) => Promise<unknown>;
    }) => {
      return {
        type: "blob.generate-presigned-url",
        presignedUrlPayload: await getSignedToken(
          body.payload.pathname,
          body.payload.clientPayload,
        ),
      };
    },
  },
});
const { uploadProductEvidenceAction: action } = await import("../lib/actions/product-evidence");
const { POST: route } = await import("../app/api/product-documents/upload/route");
const form = new FormData();
form.set("projectId", projectId);
form.set("receiptId", receiptId);
form.set("actorId", "FORGED");
form.set("sessionId", "FORGED");
const run = (fd = form) => action({ status: "idle", message: "" }, fd);
const payload = {
  receiptId,
  projectId,
  purpose: "evidence",
  originalFilename: "synthetic.csv",
  contentType: "text/csv",
  sizeBytes: 12,
};
const sign = (
  changes: Record<string, unknown> = {},
  origin = "http://127.0.0.1:3141",
  pathname = `product-documents/${projectId}/${receiptId}.csv`,
) =>
  route(
    new Request("http://127.0.0.1:3141/api/product-documents/upload", {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        type: "blob.generate-presigned-url",
        payload: { pathname, clientPayload: JSON.stringify({ ...payload, ...changes }) },
      }),
    }),
  );
async function rejected(response: Response, status = 400) {
  assert.equal(response.status, status);
  const result = await response.json();
  assert.deepEqual(Object.keys(result), ["error"]);
  assert(!JSON.stringify(result).includes(privateDetail));
  assert(!JSON.stringify(result).includes("bearer"));
}
let count = 0;
for (const error of [
  Error(privateDetail),
  { code: "upload_access_changed", message: privateDetail },
  { code: "upload_unavailable", message: privateDetail },
]) {
  claimFailure = error;
  assert.deepEqual(await run(), {
    status: "error",
    message: "无法上传产品证据，请检查项目权限及上传回执。",
  });
  count++;
}
for (const error of [new ProductDocumentAccessError(), new ProductUploadError("upload_changed")]) {
  claimFailure = error;
  Object.assign(error, { message: privateDetail, cause: Error(privateDetail) });
  assert.deepEqual(await run(), {
    status: "error",
    message: productIntakeErrorMessage(error.code),
  });
  count++;
}
claimFailure = undefined;
cacheFailure = true;
assert.deepEqual(await run(), {
  status: "success",
  message: "证据已持久化并加入当前项目，可在字段选择器中使用。",
});
count++;
cacheFailure = false;
for (const malformed of [
  new FormData(),
  (() => {
    const fd = new FormData();
    fd.set("projectId", privateDetail);
    return fd;
  })(),
]) {
  const before = claims;
  assert.equal((await run(malformed)).status, "error");
  assert.equal(claims, before);
  count++;
}
authenticated = false;
assert.deepEqual(await run(), { status: "error", message: "无权上传产品证据。" });
count++;
await rejected(await sign(), 403);
count++;
authenticated = true;
authFailure = Error(privateDetail);
assert.deepEqual(await run(), {
  status: "error",
  message: "无法上传产品证据，请检查项目权限及上传回执。",
});
count++;
await rejected(await sign());
count++;
authFailure = undefined;
const before = reservations;
await rejected(await sign({}, "https://example.invalid"), 403);
count++;
for (const changes of [
  { actorId: "FORGED", sessionId: "FORGED" },
  { purpose: "invalid" },
  { sizeBytes: 0 },
  { projectId: "invalid" },
]) {
  await rejected(await sign(changes));
  count++;
}
await rejected(await sign({}, undefined, "wrong-path"));
count++;
assert.equal(reservations, before);
for (const failure of ["issue", "sign", "access"]) {
  if (failure === "issue") issueFailure = Error(privateDetail);
  if (failure === "sign") signFailure = Error(privateDetail);
  if (failure === "access") accessFailure = new ProductDocumentAccessError();
  await rejected(await sign());
  count++;
  issueFailure = signFailure = accessFailure = undefined;
}
const previousGuards = guards;
const successful = await sign();
assert.equal(successful.status, 200);
assert.equal(guards, previousGuards + 2);
count++;
console.log(
  `PASS ${count} actual upload Action/signer boundary identity, validation, error privacy and committed success cases`,
);
