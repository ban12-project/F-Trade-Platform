// biome-ignore lint/correctness/noUnusedVariables: Loaded as a fixed page source asset.
function inspectLogin({ profile, username, password, phase, expiresAt }) {
  try {
    const visible = (element) =>
      element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    const one = (selector) => {
      const matches = [...document.querySelectorAll(selector)].filter(visible);
      if (matches.length !== 1) throw new Error("login_control_invalid");
      return matches[0];
    };
    if (
      Date.now() >= expiresAt ||
      Date.now() >= Date.parse(profile.expiresAt) ||
      location.href !== profile.url
    )
      return null;
    const form = one(profile.form),
      user = one(profile.username),
      secret = one(profile.password);
    if (
      !(form instanceof HTMLFormElement) ||
      form.method.toLowerCase() !== "post" ||
      !(user instanceof HTMLInputElement) ||
      !(secret instanceof HTMLInputElement) ||
      user === secret ||
      user.form !== form ||
      secret.form !== form ||
      !["text", "email"].includes(user.type) ||
      secret.type !== "password" ||
      user.disabled ||
      secret.disabled ||
      user.readOnly ||
      secret.readOnly ||
      (phase === "initial" ? user.value && user.value !== username : user.value !== username) ||
      (phase === "filled" ? secret.value !== password : secret.value)
    )
      return null;
    const action = new URL(form.action);
    const reviewedRootForm =
      profile.formActionMode === "facebook-root-implicit" &&
      location.href === "https://www.facebook.com/" &&
      !form.hasAttribute("action") &&
      action.href === location.href;
    if (
      action.origin !== "https://www.facebook.com" ||
      action.username ||
      action.password ||
      !(profile.formActionMode === "facebook-root-implicit"
        ? reviewedRootForm
        : action.pathname === "/login.php" || action.pathname.startsWith("/login/"))
    )
      return null;
    if (Date.now() >= expiresAt) return null;
    // Return only node handles to the trusted runtime, never credential values.
    return { form, user, secret };
  } catch {
    return null;
  }
}
