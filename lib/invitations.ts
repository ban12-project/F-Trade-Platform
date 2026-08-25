import { createHash, randomBytes, randomUUID } from "node:crypto";

import { and, eq, gt } from "drizzle-orm";

import { sendInvitationEmail } from "./auth-email";
import { getDatabase } from "./db/client";
import { invitation, user } from "./db/schema";

const PENDING_INVITATION_BAN_REASON = "Invitation pending email verification";
const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("A valid email is required");
  return email;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function inviteUrl(token: string) {
  const baseUrl = process.env.BETTER_AUTH_URL;
  if (!baseUrl) throw new Error("BETTER_AUTH_URL is required to create invitation links");
  return new URL(`/auth?invite=${encodeURIComponent(token)}`, baseUrl).toString();
}

export async function issueInvitation(input: { email: string; invitedBy: string }) {
  const email = normalizeEmail(input.email);
  const database = getDatabase();
  const [existing] = await database.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (existing) throw new Error("This email already has an account");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_LIFETIME_MS);
  const id = randomUUID();
  await database.insert(invitation).values({
    id,
    email,
    role: "user",
    tokenHash: hashToken(token),
    status: "pending",
    invitedBy: input.invitedBy,
    expiresAt,
  });

  try {
    await sendInvitationEmail({ email, inviteUrl: inviteUrl(token), expiresAt });
  } catch (error) {
    await database.update(invitation).set({ status: "revoked", revokedAt: new Date() }).where(eq(invitation.id, id));
    throw error;
  }

  return { id, email, expiresAt };
}

export async function provisionInvitedUser(input: { email: string; token: string }) {
  const email = normalizeEmail(input.email);
  if (!input.token || input.token.length < 32) throw new Error("Invalid invitation");
  const database = getDatabase();
  const now = new Date();

  await database.transaction(async (tx) => {
    const [matched] = await tx
      .select()
      .from(invitation)
      .where(and(eq(invitation.email, email), eq(invitation.tokenHash, hashToken(input.token)), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
      .limit(1);
    if (!matched) throw new Error("Invitation is invalid, expired, or already used");

    const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (existing) throw new Error("Invitation has already been activated");

    await tx.insert(user).values({
      id: randomUUID(),
      name: email.split("@")[0] || "F-Trade User",
      email,
      emailVerified: false,
      role: matched.role,
      banned: true,
      banReason: PENDING_INVITATION_BAN_REASON,
    });
    await tx.update(invitation).set({ tokenHash: hashToken(randomBytes(32).toString("base64url")) }).where(eq(invitation.id, matched.id));
  });
}

export async function activateInvitationAfterEmailProof(userId: string) {
  const database = getDatabase();
  const now = new Date();
  await database.transaction(async (tx) => {
    const [invitedUser] = await tx.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!invitedUser || !invitedUser.emailVerified || invitedUser.banReason !== PENDING_INVITATION_BAN_REASON) return;
    const [matched] = await tx
      .select({ id: invitation.id })
      .from(invitation)
      .where(and(eq(invitation.email, invitedUser.email), eq(invitation.status, "pending"), gt(invitation.expiresAt, now)))
      .limit(1);
    if (!matched) return;
    await tx.update(user).set({ banned: false, banReason: null }).where(eq(user.id, invitedUser.id));
    await tx.update(invitation).set({ status: "accepted", acceptedBy: invitedUser.id, acceptedAt: now }).where(eq(invitation.id, matched.id));
  });
}
