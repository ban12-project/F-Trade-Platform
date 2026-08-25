import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

import { getDatabase } from "./db/client";
import { authSchema } from "./db/schema";
import { sendEmailOtp } from "./auth-email";

function requireAuthSecret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  return value;
}

export function createAuth() {
  return betterAuth({
    appName: "F-Trade Platform",
    secret: requireAuthSecret(),
    baseURL: process.env.BETTER_AUTH_URL,
    database: drizzleAdapter(getDatabase(), {
      provider: "pg",
      schema: authSchema,
    }),
    emailAndPassword: { enabled: false },
    plugins: [
      admin(),
      emailOTP({
        disableSignUp: false,
        expiresIn: 600,
        allowedAttempts: 5,
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: sendEmailOtp,
      }),
      passkey({
        rpID: process.env.BETTER_AUTH_PASSKEY_RP_ID,
        rpName: "F-Trade Platform",
        origin: process.env.BETTER_AUTH_URL,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let auth: Auth | undefined;

export function getAuth(): Auth {
  auth ??= createAuth();
  return auth;
}
