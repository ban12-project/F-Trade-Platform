// biome-ignore lint/correctness/noUnusedVariables: Loaded as a fixed page source asset.
function fillLogin({ profile, username, password, expiresAt }) {
  let attempted = false;
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
      return "refused";
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
      (user.value && user.value !== username) ||
      secret.value
    )
      return "refused";
    const action = new URL(form.action);
    if (
      action.origin !== "https://www.facebook.com" ||
      action.username ||
      action.password ||
      !(action.pathname === "/login.php" || action.pathname.startsWith("/login/"))
    )
      return "refused";
    if (Date.now() >= expiresAt) return "refused";
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    attempted = true;
    set.call(user, username);
    set.call(secret, password);
    for (const element of [user, secret]) {
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
    // No submit/click/Enter, no returned credential values or DOM diagnostics.
    return user.value === username && secret.value === password ? "filled" : "unknown";
  } catch {
    return attempted ? "unknown" : "refused";
  }
}
