import assert from "node:assert/strict";
import type { Database } from "../lib/db/client";
import { readFacebookAccountStatus } from "../lib/social/facebook-account-store";

const keys = [
  "SOCIAL_FACEBOOK_WORKER_ENABLED",
  "SOCIAL_WORKER_ID",
  "SOCIAL_WORKER_CHANNEL_REF",
  "SOCIAL_WORKER_ACCOUNT_REF",
] as const;
const saved = keys.map((key) => process.env[key]);
let reads = 0;
const database = {
  select() {
    reads++;
    return {
      from() {
        return {
          async where() {
            return [];
          },
        };
      },
    };
  },
} as unknown as Database;
async function main() {
  try {
    for (const key of keys) delete process.env[key];
    assert.equal(await readFacebookAccountStatus(database), null);
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "1";
    process.env.SOCIAL_WORKER_ID = "synthetic-worker";
    assert.equal(await readFacebookAccountStatus(database), null);
    process.env.SOCIAL_WORKER_CHANNEL_REF = "synthetic-channel";
    process.env.SOCIAL_WORKER_ACCOUNT_REF = " ";
    assert.equal(await readFacebookAccountStatus(database), null);
    assert.equal(reads, 0, "unconfigured status must not query account records");
    process.env.SOCIAL_WORKER_ACCOUNT_REF = "synthetic-account";
    assert.equal((await readFacebookAccountStatus(database))?.authState, "disconnected");
    assert.equal(reads, 2);
    process.env.SOCIAL_FACEBOOK_WORKER_ENABLED = "0";
    assert.equal(await readFacebookAccountStatus(database), null);
    assert.equal(reads, 2);
    console.log(
      "PASS optional legacy Facebook status: absent, partial, invalid, valid and disabled",
    );
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}
void main();
