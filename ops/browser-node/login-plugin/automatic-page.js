// biome-ignore lint/correctness/noUnusedVariables: Read as a fixed page program by the plugin.
function automaticLoginPage({ profile, operation, phase, values, expiresAt }) {
  let attempted = false;
  try {
    const auto = profile.automation;
    const visible = (element) =>
      element.getClientRects().length && getComputedStyle(element).visibility !== "hidden";
    const matches = (selector) => [...document.querySelectorAll(selector)].filter(visible);
    const one = (selector) => {
      const elements = matches(selector);
      if (elements.length !== 1) throw new Error("ambiguous");
      return elements[0];
    };
    if (
      location.origin !== "https://www.facebook.com" ||
      Date.now() >= expiresAt ||
      Date.now() >= Date.parse(profile.expiresAt)
    )
      return operation === "observe" ? { state: "invalid", originVerified: false } : "refused";
    const identities = matches(auto.identity.selector);
    let identityVerified = false;
    if (identities.length > 1)
      return operation === "observe" ? { state: "invalid", originVerified: true } : "refused";
    if (identities.length === 1) {
      let identity = identities[0].getAttribute(auto.identity.attribute);
      if (auto.identity.attribute === "href") {
        const target = new URL(identity, location.href);
        if (target.origin !== location.origin) identity = null;
        else
          identity =
            target.pathname === "/profile.php"
              ? target.searchParams.get("id")
              : target.pathname.replace(/^\/|\/$/g, "");
      }
      identityVerified = identity === auto.accountRef;
      if (!identityVerified)
        return operation === "observe"
          ? { state: "invalid", originVerified: true, accountMismatch: true }
          : "refused";
    }
    const states = [];
    for (const attention of ["checkpoint", "rejected"])
      if (matches(auto[attention]).length) states.push(attention);
    if (location.href === profile.url && matches(profile.form).length) states.push("password");
    for (const name of ["totp", "pin", "ready"])
      if (location.href === auto[name].url && matches(auto[name].marker).length) states.push(name);
    const state =
      states.length === 1
        ? states[0]
        : states.length
          ? "invalid"
          : matches(auto.loading).length
            ? "loading"
            : identityVerified
              ? "messenger"
              : "invalid";
    if (operation === "observe")
      return {
        state,
        originVerified: true,
        identityVerified,
        messengerRestored: state === "ready" && matches(auto.ready.marker).length === 1,
      };
    if (state !== phase || !["password", "totp", "pin"].includes(phase)) return "refused";
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    const fill = (input, value) => {
      set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const editable = (input) =>
      input instanceof HTMLInputElement && !input.disabled && !input.readOnly && !input.value;
    // Button overrides can send a checked form to a different destination/method/window.
    const overridesForm = (button) =>
      button &&
      ["formaction", "formmethod", "formtarget", "formenctype", "formnovalidate"].some(
        (attribute) => button.hasAttribute(attribute),
      );
    let submit;
    if (phase === "password") {
      const form = one(profile.form),
        user = one(profile.username),
        password = one(profile.password);
      submit = one(auto.passwordSubmit);
      if (
        !(form instanceof HTMLFormElement) ||
        form.method.toLowerCase() !== "post" ||
        (form.target && form.target !== "_self") ||
        overridesForm(submit) ||
        !(user instanceof HTMLInputElement) ||
        !["email", "text"].includes(user.type) ||
        !editable(password) ||
        password.type !== "password" ||
        user === password ||
        user.disabled ||
        user.readOnly ||
        (user.value && user.value !== values.username) ||
        user.form !== form ||
        password.form !== form ||
        submit.form !== form
      )
        return "refused";
      const target = new URL(form.action);
      if (
        target.origin !== location.origin ||
        target.username ||
        target.password ||
        !(target.pathname === "/login.php" || target.pathname.startsWith("/login/"))
      )
        return "refused";
      if (
        !(submit instanceof HTMLButtonElement || submit instanceof HTMLInputElement) ||
        submit.disabled ||
        submit.type !== "submit"
      )
        return "refused";
      attempted = true;
      fill(user, values.username);
      fill(password, values.password);
    } else {
      if (phase === "pin" && !identityVerified) return "refused";
      const input = one(auto[phase].input);
      submit = auto[phase].submit === null ? null : one(auto[phase].submit);
      if (
        overridesForm(submit) ||
        !editable(input) ||
        !["text", "tel", "number", "password"].includes(input.type) ||
        !/^[0-9]{6}$/.test(values.code) ||
        Date.now() >= values.expiresAt ||
        (submit !== null && (!(submit instanceof HTMLButtonElement) || submit.disabled))
      )
        return "refused";
      if (
        input.form &&
        ((input.form.target && input.form.target !== "_self") ||
          input.form.method.toLowerCase() !== "post" ||
          (submit !== null && submit.form !== input.form) ||
          new URL(input.form.action).origin !== location.origin)
      )
        return "refused";
      attempted = true;
      fill(input, values.code);
    }
    if (Date.now() >= expiresAt || location.origin !== "https://www.facebook.com") return "unknown";
    submit?.click();
    return "submitted";
  } catch {
    return attempted ? "unknown" : "refused";
  }
}
