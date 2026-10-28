import assert from "node:assert/strict";
import { checkedBrowserResponse } from "/project/browser-node/browser-response.mjs";
import { createFacebookDriver } from "/project/browser-node/facebook-driver.mjs";
import {
  profile as selectorsProfile,
  syntheticPage,
} from "/project-fixtures/browser-inspection/data.mjs";

export async function verifyPublicationContracts({ context, accountId, runId, accessKey }) {
  const before = new Set(context.pages());
  const url = "https://www.facebook.com/";
  const route = (r) =>
    r.fulfill({
      contentType: "text/html",
      body:
        syntheticPage("closed") +
        `<div id="feed"></div><script>
    document.querySelector('[aria-label="Post"]').onclick=()=>{
      document.documentElement.dataset.submitCount=String(Number(document.documentElement.dataset.submitCount||0)+1);
      const text=document.querySelector('[role="textbox"]').innerText;
      const article=document.createElement('article');
      article.innerHTML='<a class="author" href="${selectorsProfile.identityHref}">SYNTHETIC</a><p class="copy"></p><a class="permalink" href="https://www.facebook.com/synthetic/posts/1">Synthetic receipt</a>';
      article.querySelector('.copy').textContent=text;
      document.querySelector('#feed').append(article);
      document.querySelector('#synthetic-composer').hidden=true;
    };
  </script>`,
    });
  await context.route(url, route);
  const request = async (path, body) =>
    checkedBrowserResponse(
      await fetch(`http://127.0.0.1:9377${path}`, {
        method: body ? "POST" : "GET",
        headers: { authorization: `Bearer ${accessKey}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(35000),
      }),
      path,
      body,
    );
  try {
    const profile = {
      ...selectorsProfile,
      version: 1,
      accountRef: "synthetic-account",
      channelRef: "synthetic-channel",
      reviewRef: "evidence-official-publication",
      reviewedAt: new Date(Date.now() - 1000).toISOString(),
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      url,
      selectors: {
        ...selectorsProfile.selectors,
        postsReady: "#feed",
        post: "article",
        postAuthor: ".author",
        postText: ".copy",
        postLink: ".permalink",
      },
    };
    const driver = createFacebookDriver(profile, request);
    const signal = new AbortController().signal;
    const session = await driver.open(
      { id: runId, accountId, accountRef: profile.accountRef, channelRef: profile.channelRef },
      signal,
    );
    await driver.identity(session);
    const payload = { format: "text", text: "SYNTHETIC approved text 中文🙂" };
    await driver.prepare(session, payload);
    const preview = await driver.inspect(session);
    assert.equal(preview.text, payload.text);
    assert.equal(preview.attachmentCount, 0);
    await driver.publish(session, { localExpiresAt: Date.now() + 10000 });
    await assert.rejects(
      driver.publish(session, { localExpiresAt: Date.now() + 10000 }),
      /already_attempted/,
    );
    const receipt = await driver.observe(session, payload, signal);
    assert.equal(receipt.externalPublicationRef, "https://www.facebook.com/synthetic/posts/1");
    const response = await request(`/tabs/${session.tabId}/evaluate`, {
      userId: accountId,
      expression: "Number(document.documentElement.dataset.submitCount)",
    });
    assert.equal((await response.json()).result, 1);
    console.log(
      "PASS official service publication prepare/preview/one-shot submit/receipt with synthetic DOM only; no external publication",
    );
  } finally {
    await context.unroute(url, route);
    for (const page of context.pages()) if (!before.has(page)) await page.close();
  }
}
