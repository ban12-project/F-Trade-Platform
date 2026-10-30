import assert from "node:assert/strict";
import { test } from "node:test";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin, emailOTP } from "better-auth/plugins";

// Real library routes and cookies; synthetic storage and captured delivery only.
// Drizzle mappings and real application authorization are covered separately.
async function fixture() {
  const messages = [];
  const database = { user: [], session: [], account: [], verification: [], passkey: [] };
  const auth = betterAuth({
    secret: "synthetic-auth-compatibility-secret-20261030",
    baseURL: "http://localhost:3198",
    database: memoryAdapter(database),
    logger: { disabled: true },
    emailAndPassword: { enabled: false },
    plugins: [
      admin(),
      emailOTP({
        disableSignUp: true,
        expiresIn: 600,
        allowedAttempts: 5,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async (message) => {
          messages.push(message);
        },
      }),
      passkey({
        rpID: "localhost",
        rpName: "Synthetic compatibility",
        origin: "http://localhost:3198",
      }),
    ],
  });
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser({
    email: "invited@example.invalid",
    name: "Synthetic invited user",
    emailVerified: true,
  });
  const request = (path, body, cookie) =>
    auth.handler(
      new Request(`http://localhost:3198/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3198",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { auth, database, messages, request, user };
}

test("existing user's OTP creates a cookie session; replay and signed-out cookie are rejected", async () => {
  const { request, messages, user } = await fixture();
  const sent = await request("/email-otp/send-verification-otp", {
    email: user.email,
    type: "sign-in",
  });
  assert.equal(sent.status, 200);
  assert.equal(messages.length, 1);
  const otp = messages[0].otp;
  const wrong = otp === "000000" ? "111111" : "000000";
  const rejected = await request("/sign-in/email-otp", { email: user.email, otp: wrong });
  assert.equal(rejected.status, 400);
  const signedIn = await request("/sign-in/email-otp", { email: user.email, otp });
  assert.equal(signedIn.status, 200);
  assert.equal((await signedIn.json()).user.id, user.id);
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie.includes("session_token="));
  const session = await request("/get-session", undefined, cookie);
  assert.equal((await session.json()).user.id, user.id);
  const replay = await request("/sign-in/email-otp", { email: user.email, otp });
  assert.equal(replay.status, 400);
  assert.equal((await request("/sign-out", {}, cookie)).status, 200);
  assert.equal(await (await request("/get-session", undefined, cookie)).json(), null);
});

test("unknown users receive no OTP or account; public password signup stays disabled", async () => {
  const { request, messages, database } = await fixture();
  const email = "unknown@example.invalid";
  const sent = await request("/email-otp/send-verification-otp", { email, type: "sign-in" });
  assert.equal(sent.status, 200); // Deliberately avoids account enumeration.
  assert.equal(messages.length, 0);
  assert.equal((await request("/sign-in/email-otp", { email, otp: "123456" })).status, 400);
  const signup = await request("/sign-up/email", {
    email,
    name: "Synthetic unknown",
    password: "synthetic-password",
  });
  assert.equal(signup.status, 400);
  assert.equal((await signup.json()).code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
  assert.equal(database.user.length, 1);
  assert.equal(database.session.length, 0);
});
