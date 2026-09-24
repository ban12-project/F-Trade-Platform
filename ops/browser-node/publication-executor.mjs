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
    (payload.format === "video"
      ? preview.attachmentSha256 !== upload.media.sha256
      : preview.attachmentName !== upload.path.split("/").at(-1))
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
const diagnosticErrors = new Set([
  "browser_request_failed",
  "facebook_browser_response_invalid",
  "facebook_composer_transition_timeout",
  "facebook_evaluation_failed",
  "facebook_navigation_invalid",
  "facebook_permalink_hover_failed",
  "facebook_permalink_unresolved",
  "facebook_profile_expired",
  "publication_authorization_expired",
  "publication_lease_inactive",
]);
function diagnosticError(error) {
  return diagnosticErrors.has(error?.message) ? error.message : "unclassified";
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
    onPreclickFailure,
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
    let phase = "publish";
    let preClickStage = "open";
    try {
      active();
      session = await driver.open(run, signal);
      active();
      preClickStage = "identity";
      const identity = await driver.identity(session);
      if (identity.accountRef !== run.accountRef || identity.channelRef !== run.channelRef)
        throw new Error("publication_identity_mismatch");
      preClickStage = "baseline";
      const existingRefs = new Set(await driver.existingPublicationRefs(session));
      preClickStage = "media";
      const upload = payload.format === "text" ? null : await preparePublicationMedia();
      active();
      preClickStage = "prepare";
      await driver.prepare(session, payload, upload);
      active();
      preClickStage = "preview";
      checkedPreview(await driver.inspect(session), run, upload);
      preClickStage = "authorize";
      authorization = await authorizePublication();
      active();
      // Authorization can involve network/egress checks; inspect again in case
      // the composer, attachment or acting account changed while it was pending.
      preClickStage = "recheck";
      checkedPreview(await driver.inspect(session), run, upload);
      active();
      preClickStage = "authorization_deadline";
      if (
        !Number.isFinite(authorization.localExpiresAt) ||
        authorization.localExpiresAt <= Date.now()
      )
        throw new Error("publication_authorization_expired");
      clickStarted = true;
      await driver.publish(session, authorization);
      active();
      phase = "observe";
      const observation = await driver.observe(session, payload, signal);
      phase = "validate";
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
      const receipt = {
        authorizationId: authorization.authorizationId,
        outcome: "published",
        externalPublicationRef,
      };
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await reportPublication(receipt);
          return "completed";
        } catch {
          // Retry only the identical observation. The broker accepts exact
          // replay even after recording success and requesting browser stop.
          if (signal.aborted) break;
        }
      }
      return "unknown";
    } catch (error) {
      if (!clickStarted) {
        try {
          onPreclickFailure?.(preClickStage, diagnosticError(error));
        } catch {
          /* Diagnostics must never change the no-click outcome. */
        }
      }
      if (authorization && clickStarted) {
        try {
          await reportPublication({
            authorizationId: authorization.authorizationId,
            outcome: "unknown",
            // Only fixed phase codes leave the executor; exception messages may
            // contain private page text, URLs, or transport credentials.
            failureCode: `publication_${phase}_unknown`,
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
