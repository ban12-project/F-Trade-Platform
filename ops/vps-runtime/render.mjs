import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { prepareRenderWorkspace } from "./render-workspace.mjs";

const root = "/vercel/sandbox/work";
// Source downloads and extracted frames can exceed the container's 256 MiB
// /tmp tmpfs. Keep renderer/Chrome scratch files in this job's quota-bound
// workspace, which is removed by the broker when the job stops or expires.
await prepareRenderWorkspace(root);
const { renderMedia, selectComposition } = await import("@remotion/renderer");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") throw new Error("method");
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root + sep)) throw new Error("path");
    if ((await stat(path)).isDirectory()) path = resolve(path, "index.html");
    path = await realpath(path);
    if (!path.startsWith(root + sep)) throw new Error("path");
    const info = await stat(path);
    if (!info.isFile()) throw new Error("file");
    let start = 0,
      end = info.size - 1;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      if (!match) throw new Error("range");
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || !Number.isSafeInteger(start)) throw new Error("range");
      res.statusCode = 206;
      res.setHeader("Content-Range", `bytes ${start}-${end}/${info.size}`);
    }
    res.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
    res.setHeader("Content-Length", Math.max(0, end - start + 1));
    res.setHeader("Accept-Ranges", "bytes");
    if (req.method === "HEAD" || info.size === 0) return res.end();
    const stream = createReadStream(path, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(8765, "127.0.0.1", resolve));
try {
  const inputProps = JSON.parse(await readFile(`${root}/props.json`, "utf8"));
  const browserExecutable = (await readFile("/opt/ftrade-remotion/browser-path", "utf8")).trim();
  const serveUrl = "http://127.0.0.1:8765/bundle";
  const composition = await selectComposition({
    serveUrl,
    id: "AbcdIndustrialVertical",
    inputProps,
    browserExecutable,
    offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
    offthreadVideoThreads: 1,
  });
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    browserExecutable,
    codec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    colorSpace: "bt709",
    crf: 18,
    enforceAudioTrack: true,
    concurrency: 1,
    // Remotion's system-memory defaults can exceed this worker's 2 GiB cgroup.
    offthreadVideoCacheSizeInBytes: 128 * 1024 * 1024,
    mediaCacheSizeInBytes: 64 * 1024 * 1024,
    offthreadVideoThreads: 1,
    outputLocation: `${root}/output.mp4`,
    timeoutInMilliseconds: 480_000,
    overwrite: true,
    logLevel: "error",
  });
} finally {
  server.closeAllConnections();
  server.close();
}
