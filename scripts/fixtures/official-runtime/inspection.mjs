import { syntheticPage } from "/project-fixtures/browser-inspection/data.mjs";
import { verifyInspectionContracts } from "/project-fixtures/browser-inspection/verify.mjs";

export async function verifyInspection({ context, ...scope }) {
  const route = (request) => {
    const url = new URL(request.request().url());
    return request.fulfill({
      contentType: "text/html",
      body: syntheticPage(url.searchParams.get("synthetic-inspection")),
    });
  };
  await context.route("https://www.facebook.com/**", route);
  try {
    await verifyInspectionContracts(scope);
  } finally {
    await context.unroute("https://www.facebook.com/**", route);
  }
}
