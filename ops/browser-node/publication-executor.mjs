function checkedPreview(preview, run, upload) {
  const payload = run.publication;
  if (
    !preview ||
    preview.accountRef !== run.accountRef ||
    preview.channelRef !== run.channelRef ||
    preview.text !== payload.text ||
    preview.readyToPublish !== true
  )
    throw new Error("publication_preview_mismatch");
  if (payload.format === "text") {
    if (preview.attachmentCount !== 0) throw new Error("publication_attachment_mismatch");
  } else if (
    !upload ||
    upload.media?.sha256 !== payload.media?.sha256 ||
    preview.attachmentCount !== 1 ||
    preview.attachmentName !== upload.path.split("/").at(-1)
  ) {
    throw new Error("publication_attachment_mismatch");
  }
}
function publicationReference(value) {
  if (typeof value !== "string" || value.length > 160)
    throw new Error("publication_observation_invalid");
  const url = new URL(value);
  if (
    url.origin !== "https://www.facebook.com" ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname === "/"
  )
    throw new Error("publication_observation_invalid");
  return url.href;
}

/** Execution order shared by reviewed DOM drivers. This module supplies no
 * Facebook selectors and advertises no runtime capability on its own. Drivers
 * must prove identity, unique controls, attachment preview and a new post URL.
 */
export function createPublicationExecutor(driver) {
  return async function execute({
    run,
    signal,
    preparePublicationMedia,
    authorizePublication,
    reportPublication,
  }) {
    const active = () => {
      if (signal.aborted) throw new Error("publication_cancelled");
    };
    const payload = run.publication;
    if (
      run.kind !== "publish" ||
      !payload ||
      typeof payload.text !== "string" ||
      (payload.format !== "text" && !payload.media) ||
      !["text", "image", "video"].includes(payload.format) ||
      payload.accountRef !== run.accountRef ||
      payload.channelRef !== run.channelRef
    )
      return "failed";
    let authorization;
    let clickStarted = false;
    let session;
    try {
      active();
      session = await driver.open(run, signal);
      active();
      const identity = await driver.identity(session);
      if (identity.accountRef !== run.accountRef || identity.channelRef !== run.channelRef)
        throw new Error("publication_identity_mismatch");
      const existingRefs = new Set(await driver.existingPublicationRefs(session));
      const upload = payload.format === "text" ? null : await preparePublicationMedia();
      active();
      await driver.prepare(session, payload, upload);
      active();
      checkedPreview(await driver.inspect(session), run, upload);
      authorization = await authorizePublication();
      active();
      // Authorization can involve network/egress checks; inspect again in case
      // the composer, attachment or acting account changed while it was pending.
      checkedPreview(await driver.inspect(session), run, upload);
      active();
      if (
        !Number.isFinite(authorization.localExpiresAt) ||
        authorization.localExpiresAt <= Date.now()
      )
        throw new Error("publication_authorization_expired");
      clickStarted = true;
      await driver.publish(session);
      active();
      const observation = await driver.observe(session, payload, signal);
      if (
        observation.accountRef !== run.accountRef ||
        observation.channelRef !== run.channelRef ||
        observation.text !== payload.text
      )
        throw new Error("publication_observation_mismatch");
      const externalPublicationRef = publicationReference(observation.externalPublicationRef);
      if (existingRefs.has(externalPublicationRef))
        throw new Error("publication_reference_not_new");
      // Never turn a lost success receipt into a contradictory unknown receipt.
      try {
        await reportPublication({
          authorizationId: authorization.authorizationId,
          outcome: "published",
          externalPublicationRef,
        });
        return "completed";
      } catch {
        return "unknown";
      }
    } catch {
      if (authorization && clickStarted) {
        try {
          await reportPublication({
            authorizationId: authorization.authorizationId,
            outcome: "unknown",
            failureCode: "publication_observation_unknown",
          });
        } catch {
          /* broker retains unknown until reconciled */
        }
      }
      return clickStarted ? "unknown" : "failed";
    } finally {
      if (session) {
        try {
          await driver.close(session);
        } catch {
          /* runtime shutdown owns final cleanup */
        }
      }
    }
  };
}
