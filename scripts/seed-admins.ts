import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { closeDatabase, getDatabase } from "../lib/db/client";
import { auditEvent, user } from "../lib/db/schema";

const SEED_ACTOR_ID = "bootstrap-admin-seed";

export interface AdminSeedArgs {
  emails: string[];
  confirm: boolean;
}

function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid administrator email: ${value}`);
  }
  return email;
}

export function parseAdminSeedArgs(argv = process.argv): AdminSeedArgs {
  const emailsOptionIndex = argv.indexOf("--emails");
  const emailsValue = emailsOptionIndex === -1 ? undefined : argv[emailsOptionIndex + 1];
  if (!emailsValue) throw new Error("Pass --emails admin1@example.com,admin2@example.com");
  const emails = [...new Set(emailsValue.split(",").filter(Boolean).map(normalizeEmail))];
  if (emails.length === 0) throw new Error("Pass at least one administrator email");
  return { emails, confirm: argv.includes("--confirm") };
}

export async function seedAdministrators({ emails, confirm }: AdminSeedArgs) {
  if (!confirm) throw new Error("Refusing to change roles without --confirm");
  const database = getDatabase();
  const created: string[] = [];
  const promoted: string[] = [];
  const unchanged: string[] = [];

  await database.transaction(async (tx) => {
    for (const email of emails) {
      const [existing] = await tx.select().from(user).where(eq(user.email, email)).limit(1);
      if (!existing) {
        const id = randomUUID();
        await tx.insert(user).values({
          id,
          name: email.split("@")[0] || "Administrator",
          email,
          emailVerified: false,
          role: "admin",
          banned: false,
          banReason: null,
        });
        await tx.insert(auditEvent).values({
          id: randomUUID(),
          action: "administrator_seeded",
          actorType: "system",
          actorId: SEED_ACTOR_ID,
          subjectType: "user",
          subjectId: id,
          metadata: { email },
          occurredAt: new Date(),
        });
        created.push(email);
        continue;
      }
      if (existing.role === "admin" && !existing.banned) {
        unchanged.push(email);
        continue;
      }
      await tx
        .update(user)
        .set({ role: "admin", banned: false, banReason: null, banExpires: null })
        .where(eq(user.id, existing.id));
      await tx.insert(auditEvent).values({
        id: randomUUID(),
        action: "administrator_seeded",
        actorType: "system",
        actorId: SEED_ACTOR_ID,
        subjectType: "user",
        subjectId: existing.id,
        metadata: { email, previous_role: existing.role, was_banned: existing.banned },
        occurredAt: new Date(),
      });
      promoted.push(email);
    }
  });
  return { created, promoted, unchanged };
}

async function main() {
  const result = await seedAdministrators(parseAdminSeedArgs());
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("seed-admins.ts")) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Unable to seed administrators");
      process.exitCode = 1;
    })
    .finally(closeDatabase);
}
