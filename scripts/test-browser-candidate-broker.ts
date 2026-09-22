import assert from "node:assert/strict";
import { createCandidateBroker } from "./candidate-gateway-broker";

async function main() {
  const broker = await createCandidateBroker("https://127.0.0.1:9443");
  try {
    await broker.ready();
    await broker.assertOwnerGuards();
    const admit = async (token: string) => {
      try {
        await broker.nodeCall("admit", { ticket: token });
        return 200;
      } catch (error) {
        assert.match(String(error), /ticket_invalid/);
        return 403;
      }
    };
    await broker.assertExpiredAdmissions(admit);
    const first = await broker.issue();
    assert.equal(await admit(first), 200);
    await broker.assertReplay(first, admit);
    const second = await broker.issue();
    assert.notEqual(first, second);
    assert.equal(await admit(second), 200);
    await broker.assertReplay(second, admit);
    console.log(
      JSON.stringify({
        scope: "Actual PostgreSQL broker only; no browser or gateway HTTP claim",
        checks: broker.checks,
      }),
    );
  } finally {
    await broker.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
