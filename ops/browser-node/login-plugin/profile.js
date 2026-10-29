import { validateAutomaticProfile } from "./automatic-profile.js";

export function validateLoginProfile(profile, now = Date.now()) {
  if (profile?.version === 2) {
    const { automation, ...legacy } = profile;
    validateLoginProfile({ ...legacy, version: 1 }, now);
    return { ...structuredClone(profile), automation: validateAutomaticProfile(automation) };
  }
  if (
    !profile ||
    Object.keys(profile).sort().join(",") !==
      (profile.formActionMode === "facebook-root-implicit"
        ? "expiresAt,form,formActionMode,password,reviewRef,reviewedAt,url,username,version"
        : "expiresAt,form,password,reviewRef,reviewedAt,url,username,version") ||
    profile.version !== 1 ||
    !/^evidence-[a-z0-9_-]{3,120}$/i.test(profile.reviewRef ?? "")
  )
    throw new Error("login_profile_invalid");
  const reviewed = Date.parse(profile.reviewedAt),
    expires = Date.parse(profile.expiresAt);
  if (
    !Number.isFinite(reviewed) ||
    reviewed > now ||
    !Number.isFinite(expires) ||
    expires <= now ||
    expires <= reviewed ||
    expires - reviewed > 30 * 86400000
  )
    throw new Error("login_profile_invalid");
  const url = new URL(profile.url);
  if (
    url.origin !== "https://www.facebook.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["/", "/login", "/login/", "/login.php"].includes(url.pathname) ||
    url.href !== profile.url
  )
    throw new Error("login_profile_invalid");
  for (const key of ["form", "username", "password"])
    if (
      typeof profile[key] !== "string" ||
      !profile[key].trim() ||
      profile[key].length > 500 ||
      profile[key].includes(",")
    )
      throw new Error("login_profile_invalid");
  if (
    profile.formActionMode === "facebook-root-implicit" &&
    (profile.url !== "https://www.facebook.com/" ||
      profile.form !== "#login_form" ||
      profile.username !== '#login_form input[name="email"]' ||
      profile.password !== '#login_form input[name="pass"]')
  )
    throw new Error("login_profile_invalid");
  return structuredClone(profile);
}
