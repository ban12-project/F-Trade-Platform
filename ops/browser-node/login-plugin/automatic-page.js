// biome-ignore lint/correctness/noUnusedVariables: Read as a fixed page program by the plugin.
async function automaticLoginPage({
  profile,
  operation,
  phase,
  values,
  expiresAt,
  sessionIdentity,
  captchaVisible,
}) {
  let attempted = false;
  try {
    const auto = profile.automation;
    if (operation === "submit" && auto.mode === "observe-only") return "refused";
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
    let identityVerified = false;
    if (auto.identity.attribute === "facebook-current-user") {
      if (sessionIdentity?.mismatch)
        return operation === "observe"
          ? { state: "invalid", originVerified: true, accountMismatch: true }
          : "refused";
      let visited = 0,
        bytes = 0;
      const records = [];
      const walk = (value, depth = 0) => {
        if (++visited > 200000 || depth > 80) throw new Error("identity_limit");
        if (Array.isArray(value)) {
          if (value[0] === "CurrentUserInitialData") {
            const data = value[2];
            if (!data || typeof data !== "object") throw new Error("identity_invalid");
            if (data.USER_ID !== "0" || data.ACCOUNT_ID !== "0") records.push(data);
          }
          for (const item of value) walk(item, depth + 1);
        } else if (value && typeof value === "object") {
          for (const item of Object.values(value)) walk(item, depth + 1);
        }
      };
      const scripts = document.querySelectorAll(auto.identity.selector);
      if (scripts.length > 256) throw new Error("identity_limit");
      for (const script of scripts) {
        bytes += script.textContent.length;
        if (bytes > 4000000) throw new Error("identity_limit");
        if (script.textContent.includes("CurrentUserInitialData"))
          walk(JSON.parse(script.textContent));
      }
      if (
        records.some(
          (data) => data.USER_ID !== auto.accountRef || data.ACCOUNT_ID !== auto.accountRef,
        )
      )
        return operation === "observe"
          ? { state: "invalid", originVerified: true, accountMismatch: true }
          : "refused";
      identityVerified = records.length > 0 && sessionIdentity?.verified === true;
    } else {
      const identities = matches(auto.identity.selector);
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
    }
    const authenticatorUrl = (path, flow) => {
      const current = new URL(location.href);
      const keys = [];
      current.searchParams.forEach((_value, key) => {
        keys.push(key);
      });
      return (
        auto.totp.mode === "facebook-authenticator" &&
        auto.totp.url === "https://www.facebook.com/two_step_verification/two_factor/" &&
        current.pathname === path &&
        !current.hash &&
        keys.every((key) => ["encrypted_context", "flow", "next"].includes(key)) &&
        new Set(keys).size === keys.length &&
        (current.searchParams.get("encrypted_context")?.length ?? 0) > 0 &&
        current.searchParams.get("encrypted_context").length <= 4096 &&
        current.searchParams.get("flow") === flow &&
        [null, "", "/", "/messages/"].includes(current.searchParams.get("next"))
      );
    };
    const authenticatorPage = () =>
      authenticatorUrl("/two_step_verification/two_factor/", "two_factor_login") &&
      matches(auto.totp.marker).filter(
        (element) => element.textContent.trim() === "Go to your authentication app",
      ).length === 1;
    const states = [];
    if (
      captchaVisible === true &&
      authenticatorUrl("/two_step_verification/authentication/", "pre_authentication")
    )
      states.push("checkpoint");
    for (const attention of ["checkpoint", "rejected"])
      if (matches(auto[attention]).length) states.push(attention);
    if (location.href === profile.url && matches(profile.form).length) states.push("password");
    for (const name of ["totp", "pin"])
      if (
        name === "totp" && auto.totp.mode === "facebook-authenticator"
          ? authenticatorPage()
          : location.href === auto[name].url && matches(auto[name].marker).length
      )
        states.push(name);
    const readyRoots = location.href === auto.ready.url ? matches(auto.ready.marker) : [];
    let restored = false;
    if (readyRoots.length === 1 && !matches('[role="dialog"]').length) {
      const root = readyRoots[0];
      const empties = [...root.querySelectorAll(auto.ready.empty)].filter(
        (element) => visible(element) && element.textContent.trim() === auto.ready.emptyText,
      );
      const threads = [...root.querySelectorAll(auto.ready.thread)].filter(visible);
      restored =
        (empties.length === 1 &&
          threads.length === 0 &&
          empties[0].textContent.trim() === auto.ready.emptyText) ||
        (empties.length === 0 && threads.length > 0);
    }
    if (restored) states.push("ready");
    const state =
      states.length === 1
        ? states[0]
        : states.length
          ? "invalid"
          : readyRoots.length > 0 ||
              matches(auto.loading).length ||
              authenticatorUrl("/two_step_verification/authentication/", "pre_authentication") ||
              authenticatorUrl("/two_step_verification/two_factor/", "two_factor_login")
            ? "loading"
            : identityVerified
              ? "messenger"
              : "invalid";
    if (operation === "observe")
      return {
        state,
        originVerified: true,
        identityVerified,
        atReadyUrl: location.href === auto.ready.url,
        messengerRestored: state === "ready" && restored,
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
    const ariaButton = (element) =>
      element instanceof HTMLElement &&
      ["DIV", "SPAN"].includes(element.tagName) &&
      element.getAttribute("role") === "button" &&
      element.getAttribute("tabindex") === "0" &&
      element.getAttribute("aria-disabled") !== "true";
    const belongsTo = (element, form) =>
      ariaButton(element) ? element.closest("form") === form : element.form === form;
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
        !belongsTo(submit, form)
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
        !ariaButton(submit) &&
        (!(submit instanceof HTMLButtonElement || submit instanceof HTMLInputElement) ||
          submit.disabled ||
          submit.type !== "submit")
      )
        return "refused";
      attempted = true;
      fill(user, values.username);
      fill(password, values.password);
    } else {
      if (phase === "pin" && !identityVerified) return "refused";
      const authenticator = phase === "totp" && auto.totp.mode === "facebook-authenticator";
      const continueButton = () => {
        const buttons = matches(auto.totp.submit).filter(
          (element) => element.textContent.trim() === "Continue",
        );
        if (buttons.length !== 1) throw new Error("ambiguous");
        return buttons[0];
      };
      const input = one(auto[phase].input);
      submit = authenticator
        ? continueButton()
        : auto[phase].submit === null
          ? null
          : one(auto[phase].submit);
      if (
        overridesForm(submit) ||
        !editable(input) ||
        !["text", "tel", "number", "password"].includes(input.type) ||
        !/^[0-9]{6}$/.test(values.code) ||
        Date.now() >= values.expiresAt ||
        (!authenticator &&
          submit !== null &&
          !ariaButton(submit) &&
          (!(submit instanceof HTMLButtonElement) || submit.disabled))
      )
        return "refused";
      if (
        authenticator &&
        (!authenticatorPage() ||
          input.name ||
          !input.form ||
          input.form.method.toLowerCase() !== "get" ||
          input.form.action !== location.href ||
          (input.form.target && input.form.target !== "_self") ||
          submit.tagName !== "DIV" ||
          submit.getAttribute("role") !== "button" ||
          !["-1", "0"].includes(submit.getAttribute("tabindex")))
      )
        return "refused";
      if (
        !authenticator &&
        input.form &&
        ((input.form.target && input.form.target !== "_self") ||
          input.form.method.toLowerCase() !== "post" ||
          (submit !== null && !belongsTo(submit, input.form)) ||
          new URL(input.form.action).origin !== location.origin)
      )
        return "refused";
      attempted = true;
      fill(input, values.code);
      if (authenticator) {
        const currentUrl = location.href;
        for (let wait = 0; wait < 30 && !ariaButton(submit); wait++) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          submit = continueButton();
          if (
            Date.now() >= Math.min(expiresAt, values.expiresAt) ||
            location.href !== currentUrl ||
            !authenticatorPage() ||
            one(auto.totp.input) !== input ||
            input.value !== values.code ||
            overridesForm(submit)
          )
            return "unknown";
        }
        if (!ariaButton(submit)) return "unknown";
      }
    }
    if (Date.now() >= expiresAt || location.origin !== "https://www.facebook.com") return "unknown";
    submit?.click();
    return "submitted";
  } catch {
    return attempted ? "unknown" : "refused";
  }
}
