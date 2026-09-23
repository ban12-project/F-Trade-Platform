import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { initializeNativeProfile } from "/app/ftrade-native-profile.mjs";

const accountId = "22222222-2222-4222-8222-222222222222";
const nodeId = "11111111-1111-4111-8111-111111111111";
const hash = createHash("sha256").update(accountId).digest("hex").slice(0, 32);
const directory = `/data/profiles/${hash}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(
  `${directory}/storage-state.json`,
  JSON.stringify({
    cookies: [
      {
        name: "synthetic-session",
        value: "preserved",
        domain: "storage.test",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ],
    origins: [
      {
        origin: "https://storage.test",
        localStorage: [{ name: "synthetic-migration", value: "preserved" }],
      },
    ],
  }),
  { mode: 0o600, flag: "wx" },
);
await initializeNativeProfile({ accountId, nodeId, source: "legacy-json" });
