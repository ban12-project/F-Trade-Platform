import assert from "node:assert/strict";
import {
  createMarketingVideoFromInternetSchema,
  createMarketingVideoUiFormSchema,
} from "../lib/video/edit-contracts";
import {
  type InternetMediaFetcher,
  internetMediaImportInputSchema,
  resolveInternetVideoMediaFiles,
  searchInternetVideoMedia,
} from "../lib/video/internet-media-search";

const page = {
  pageid: 42,
  title: "File:Clutch assembly.jpg",
  imageinfo: [
    {
      url: "https://upload.wikimedia.org/example-original.jpg",
      descriptionurl: "https://commons.wikimedia.org/wiki/File:Clutch_assembly.jpg",
      thumburl: "https://thumb.wikimedia.org/example.jpg",
      thumbmime: "image/jpeg",
      mime: "image/jpeg",
      width: 1_920,
      height: 1_080,
      thumbwidth: 1_920,
      thumbheight: 1_080,
      extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } },
    },
  ],
};

function jsonResponse(overrides: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ query: { pages: [{ ...page, ...overrides }] } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetcherForMedia(
  mediaResponse: () => Response,
  pageOverrides: Record<string, unknown> = {},
) {
  const calls: URL[] = [];
  const fetcher = (async (input: URL | RequestInfo) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );
    calls.push(url);
    return url.hostname === "commons.wikimedia.org" ? jsonResponse(pageOverrides) : mediaResponse();
  }) as InternetMediaFetcher;
  return { calls, fetcher };
}

const commonCreation = {
  projectId: "00000000-0000-4000-8000-000000000244",
  productId: "00000000-0000-4000-8000-000000000245",
  factPath: "product.oe_numbers",
  objective: "Create a private product preview",
  targetAudience: "Distributors",
  platform: "facebook" as const,
};

void (async () => {
  const search = fetcherForMedia(() => new Response());
  const results = await searchInternetVideoMedia("clutch assembly", search.fetcher);
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], {
    id: "wikimedia:42",
    title: "Clutch assembly.jpg",
    thumbnailUrl: "https://thumb.wikimedia.org/example.jpg",
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Clutch_assembly.jpg",
    width: 1_920,
    height: 1_080,
    mimeType: "image/jpeg",
    license: "CC BY-SA 4.0",
    provider: "Wikimedia Commons",
  });
  assert.equal(search.calls[0]?.searchParams.get("generator"), "search");
  assert.equal(search.calls[0]?.searchParams.get("gsrnamespace"), "6");
  assert.equal(search.calls[0]?.searchParams.get("gsrsearch"), 'intitle:"clutch assembly"');

  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  const importFetch = fetcherForMedia(
    () =>
      new Response(jpeg, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(jpeg.byteLength) },
      }),
  );
  const imported = await resolveInternetVideoMediaFiles(["wikimedia:42"], importFetch.fetcher);
  assert.equal(imported.files[0]?.type, "image/jpeg");
  assert.equal(imported.files[0]?.name, "internet-wikimedia-42.jpg");
  assert.equal(importFetch.calls[0]?.searchParams.get("pageids"), "42");
  assert.equal(importFetch.calls[1]?.hostname, "thumb.wikimedia.org");

  const redirectFetch = fetcherForMedia(
    () =>
      new Response(null, { status: 302, headers: { location: "https://example.com/file.jpg" } }),
  );
  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42"], redirectFetch.fetcher),
    /未经允许的跳转/,
  );

  const wrongMimeFetch = fetcherForMedia(
    () => new Response(jpeg, { status: 200, headers: { "content-type": "image/png" } }),
  );
  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42"], wrongMimeFetch.fetcher),
    /类型与检索记录不一致/,
  );

  const oversizedFetch = fetcherForMedia(
    () =>
      new Response(jpeg, {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": String(20 * 1024 * 1024 + 1) },
      }),
  );
  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42"], oversizedFetch.fetcher),
    /不能超过 20MB/,
  );

  const oversizedStreamFetch = fetcherForMedia(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(Uint8Array.from([0xff, 0xd8, 0xff]));
            controller.enqueue(new Uint8Array(20 * 1024 * 1024));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "image/jpeg" } },
      ),
  );
  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42"], oversizedStreamFetch.fetcher),
    /不能超过 20MB/,
  );

  const badSignatureFetch = fetcherForMedia(
    () =>
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
  );
  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42"], badSignatureFetch.fetcher),
    /声明格式不一致/,
  );

  const hostilePage = fetcherForMedia(() => new Response(), {
    imageinfo: [{ ...page.imageinfo[0], thumburl: "https://example.com/hostile.jpg" }],
  });
  assert.deepEqual(await searchInternetVideoMedia("clutch assembly", hostilePage.fetcher), []);
  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42"], hostilePage.fetcher),
    /已不可用/,
  );

  await assert.rejects(
    resolveInternetVideoMediaFiles(["wikimedia:42", "wikimedia:42"], importFetch.fetcher),
    /不能重复/,
  );
  assert.throws(
    () =>
      internetMediaImportInputSchema.parse({
        ...commonCreation,
        query: "clutch",
        resultIds: ["https://example.com/file.jpg"],
      }),
    /互联网素材标识无效/,
  );
  assert.equal(
    createMarketingVideoFromInternetSchema.parse({
      ...commonCreation,
      sourceMode: "internet_search",
      internetSearchQuery: "clutch assembly",
      internetMediaIds: ["wikimedia:42"],
      rightsEvidenceRef: "",
    }).sourceMode,
    "internet_search",
  );
  assert.equal(
    createMarketingVideoUiFormSchema.parse({
      ...commonCreation,
      sourceMode: "internet_search",
      productMediaIds: [],
      rightsEvidenceRef: "",
      internetSearchQuery: "clutch assembly",
      internetMediaIds: ["wikimedia:42"],
    }).sourceMode,
    "internet_search",
  );
  assert.throws(
    () =>
      createMarketingVideoUiFormSchema.parse({
        ...commonCreation,
        sourceMode: "internet_search",
        productMediaIds: [],
        rightsEvidenceRef: "evidence-fake-rights",
        internetSearchQuery: "clutch assembly",
        internetMediaIds: ["wikimedia:42"],
      }),
    /自动记录来源/,
  );

  console.log("PASS internet video media search, opaque re-resolution, and bounded import policy");
})();
