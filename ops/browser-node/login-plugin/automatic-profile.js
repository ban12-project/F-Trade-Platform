export function validateAutomaticProfile(value) {
  const exact = (object, keys) =>
    object && Object.keys(object).sort().join(",") === keys.sort().join(",");
  const selector = (s) =>
    typeof s === "string" && s.trim() === s && s.length > 0 && s.length <= 500 && !s.includes(",");
  const url = (s) => {
    try {
      const parsed = new URL(s);
      return (
        parsed.origin === "https://www.facebook.com" &&
        !parsed.username &&
        !parsed.password &&
        !parsed.hash &&
        parsed.href === s
      );
    } catch {
      return false;
    }
  };
  if (
    !exact(value, [
      "accountRef",
      "identity",
      "passwordSubmit",
      "totp",
      "pin",
      "ready",
      "checkpoint",
      "rejected",
      "loading",
    ]) ||
    !/^[0-9]{5,30}$/.test(value.accountRef ?? "") ||
    !exact(value.identity, ["selector", "attribute"]) ||
    !selector(value.identity.selector) ||
    !["data-account-id", "data-profile-id", "href"].includes(value.identity.attribute) ||
    !["passwordSubmit", "checkpoint", "rejected", "loading"].every((k) => selector(value[k]))
  )
    throw new Error("automatic_login_profile_invalid");
  for (const phase of ["totp", "pin"])
    if (
      !exact(value[phase], ["url", "marker", "input", "submit"]) ||
      !url(value[phase].url) ||
      !["marker", "input"].every((k) => selector(value[phase][k])) ||
      !(selector(value[phase].submit) || (phase === "pin" && value[phase].submit === null))
    )
      throw new Error("automatic_login_profile_invalid");
  if (
    !exact(value.ready, ["url", "marker"]) ||
    !url(value.ready.url) ||
    !selector(value.ready.marker)
  )
    throw new Error("automatic_login_profile_invalid");
  return structuredClone(value);
}
