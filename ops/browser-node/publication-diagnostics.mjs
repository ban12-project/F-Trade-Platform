export const publicationPreclickStages = [
  "open",
  "identity",
  "baseline",
  "media",
  "prepare",
  "preview",
  "authorize",
  "recheck",
  "authorization_deadline",
];
export const publicationPreclickCodes = [
  "browser_request_failed",
  "facebook_browser_response_invalid",
  "facebook_composer_transition_timeout",
  "facebook_identity_ready_timeout",
  "facebook_posts_ready_timeout",
  "facebook_posts_loaded_timeout",
  "facebook_evaluation_failed",
  "facebook_navigation_invalid",
  "facebook_permalink_hover_failed",
  "facebook_permalink_unresolved",
  "facebook_profile_expired",
  "publication_authorization_expired",
  "publication_lease_inactive",
  "publication_media_invalid",
  "publication_media_response_invalid",
  "publication_media_size_invalid",
  "publication_media_integrity_invalid",
  "publication_media_transport_failed",
  "publication_upload_invalid",
  "publication_container_invalid",
  "publication_container_mismatch",
  "publication_upload_transport_failed",
  "publication_preview_identity_mismatch",
  "publication_preview_text_mismatch",
  "publication_preview_not_ready",
  "publication_attachment_mismatch",
  "facebook_video_preview_unready",
  "facebook_video_preview_mismatch",
  "unclassified",
  "facebook_composer_ready_timeout",
  "facebook_audience_picker_timeout",
  "facebook_audience_selection_timeout",
  "facebook_audience_applied_timeout",
];
const prefix = "fleet_publication_not_authorized";
export function publicationPreclickFailure(stage, code) {
  return publicationPreclickStages.includes(stage) && publicationPreclickCodes.includes(code)
    ? `${prefix}:${stage}:${code}`
    : prefix;
}
export function parsePublicationPreclickFailure(value) {
  if (typeof value !== "string") return null;
  const [base, stage, code, extra] = value.split(":");
  return base === prefix &&
    extra === undefined &&
    publicationPreclickStages.includes(stage) &&
    publicationPreclickCodes.includes(code)
    ? { stage, code }
    : null;
}
export function isPublicationPreauthorizationFailure(value) {
  return value === prefix || parsePublicationPreclickFailure(value) !== null;
}
