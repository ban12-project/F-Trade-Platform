import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const program = readFileSync("ops/browser-node/publication-inspection-page.js", "utf8");
const profile = {
  identityHref: "https://www.facebook.com/synthetic-owned",
  audienceText: "Only me",
  selectors: {
    identity: "#identity",
    openComposer: "#open",
    composer: "#composer",
    textbox: "#textbox",
    submit: "#submit",
    audience: "#audience",
    fileInput: "input[type=file]",
    attachmentName: ".attachment",
    composerIdentity: "#composer-identity",
  },
};
const html = `<a id="identity" href="https://www.facebook.com/synthetic-owned">SYNTHETIC owned</a><button id="open">Create</button><div id="composer"><a id="composer-identity" href="https://www.facebook.com/synthetic-owned">SYNTHETIC actor</a><div id="textbox" contenteditable="true">SYNTHETIC private caption</div><button id="submit">Post</button><button id="audience">Only me</button><input type="file" style="display:none"/><div class="attachment">SYNTHETIC filename</div></div>`;
test("publication inspection reports hidden media input without reading caption, clicking or editing", async ({
  page,
}) => {
  await page.route("https://www.facebook.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://www.facebook.com/synthetic-owned");
  const before = await page.content();
  const result = await page.evaluate(
    ({ program, profile }) => new Function(`return (${program})`)()(profile),
    { program, profile },
  );
  expect(result.identityMatched).toBe(true);
  expect(result.controls.fileInput).toBe(1);
  expect(result.composerEmpty).toBe(false);
  expect(JSON.stringify(result)).not.toContain("SYNTHETIC private caption");
  expect(JSON.stringify(result)).not.toContain("synthetic-owned");
  expect(await page.content()).toBe(before);
});
test("mismatched identity gates further inspection and Messenger pages are refused", async ({
  page,
}) => {
  await page.route("https://www.facebook.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
  await page.goto("https://www.facebook.com/");
  const result = await page.evaluate(
    ({ program, profile }) =>
      new Function(`return (${program})`)()({
        ...profile,
        identityHref: "https://www.facebook.com/other-owned",
      }),
    { program, profile },
  );
  expect(result.identityMatched).toBe(false);
  expect(result.controls.composer).toBe(0);
  await page.goto("https://www.facebook.com/messages/");
  const reason = await page.evaluate(
    ({ program, profile }) => {
      try {
        new Function(`return (${program})`)()(profile);
        return "accepted";
      } catch {
        return "refused";
      }
    },
    { program, profile },
  );
  expect(reason).toBe("refused");
});
test("inspection UI keeps expired candidates explicit and unauthenticated requests private", async ({
  page,
}) => {
  await page.goto("/testing/publication-page-inspection");
  await expect(page.getByText("候选配置已过期，需要重新审核", { exact: true })).toBeVisible();
  await expect(page.getByText("媒体输入（含隐藏控件）：1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "只读核对当前页面", exact: true }).click();
  await expect(
    page.getByText("无法核对当前发布页面。请确认当前登录、节点归属、运行中的接管及页面检查服务。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /发布|上传/ })).toHaveCount(0);
});
