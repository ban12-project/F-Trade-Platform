import { passkey } from "@better-auth/passkey";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, emailOTP } from "better-auth/plugins";
import { sendEmailOtp } from "./auth-email";
import { getDatabase } from "./db/client";
import { authSchema } from "./db/schema";
import { activateInvitationAfterEmailProof } from "./invitations";

function invitationActivationPlugin(): BetterAuthPlugin {
  return {
    id: "invitation-activation",
    init() {
      return {
        options: {
          databaseHooks: {
            session: {
              create: {
                async before(session) {
                  await activateInvitationAfterEmailProof(session.userId);
                },
              },
            },
          },
        },
      };
    },
  };
}

function requireAuthSecret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  }
  return value;
}

export const auth = betterAuth({
  appName: "F-Trade Platform",
  secret: requireAuthSecret(),
  baseURL: process.env.BETTER_AUTH_URL,
  database: drizzleAdapter(getDatabase(), {
    provider: "pg",
    schema: authSchema,
  }),
  emailAndPassword: { enabled: false },
  plugins: [
    invitationActivationPlugin(),
    admin(),
    emailOTP({
      disableSignUp: true,
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
  trustedOrigins: ["https://*.vercel.app"],
});
