import { localDeadline } from "./lease.mjs";

/** One local authorization attempt; ambiguous transport failures never retry an
 * external effect. The adapter must call this immediately before its final click. */
export function createPublicationAuthorizer({ run, assertActive, checkEgress, request }) {
  let pending;
  return () => {
    pending ??= (async () => {
      if (run.kind !== "publish" || !/^[a-f0-9]{64}$/.test(run.publicationDigest ?? "")) {
        throw new Error("publication_payload_missing");
      }
      assertActive();
      await checkEgress();
      assertActive();
      const result = await request("authorize-publication", {
        runId: run.id,
        leaseId: run.leaseId,
        payloadDigest: run.publicationDigest,
      });
      assertActive();
      const authorization = result.authorization;
      if (
        !authorization ||
        !/^[a-f0-9-]{36}$/i.test(authorization.authorizationId ?? "") ||
        authorization.payloadDigest !== run.publicationDigest
      )
        throw new Error("publication_authorization_invalid");
      return { ...authorization, localExpiresAt: localDeadline(result, authorization.expiresAt) };
    })();
    return pending.then((authorization) => {
      assertActive();
      if (authorization.localExpiresAt <= Date.now())
        throw new Error("publication_authorization_expired");
      return authorization;
    });
  };
}
