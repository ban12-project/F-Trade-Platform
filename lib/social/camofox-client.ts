import { z } from "zod";

const loopbackBaseUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}, "CamoFox must be reachable only on loopback HTTP");

export const camofoxWorkerConfigSchema = z.object({
  baseUrl: loopbackBaseUrl,
  accessKey: z.string().trim().min(32).max(512),
  userId: z.string().trim().min(1).max(120),
  sessionKey: z.string().trim().min(1).max(120),
}).strict();
export type CamofoxWorkerConfig = z.infer<typeof camofoxWorkerConfigSchema>;

type FetchLike = typeof fetch;

/**
 * Narrow CamoFox client for the isolated worker. It intentionally exposes no
 * cookie import, screenshot/trace, proxy, eval, selector fallback, or generic
 * HTTP method. Browser state never crosses this process boundary.
 */
export class CamofoxWorkerClient {
  private readonly config: CamofoxWorkerConfig;
  constructor(config: CamofoxWorkerConfig, private readonly request: FetchLike = fetch) {
    this.config = camofoxWorkerConfigSchema.parse(config);
  }
  private async call(path: string, body?: Record<string, unknown>) {
    const response = await this.request(new URL(path, this.config.baseUrl), {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${this.config.accessKey}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`CamoFox request failed: ${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async healthcheck() {
    const health = await this.call("/health");
    if (health.ok !== true || health.browserConnected !== true) throw new Error("CamoFox is not healthy and browser-connected");
    return { activeTabs: Number(health.activeTabs ?? 0), activeSessions: Number(health.activeSessions ?? 0) };
  }
  async createFacebookTab() {
    const created = await this.call("/tabs", { userId: this.config.userId, sessionKey: this.config.sessionKey, trace: false, url: "https://www.facebook.com/" });
    if (typeof created.tabId !== "string" || !created.tabId) throw new Error("CamoFox did not return a tab ID");
    return created.tabId;
  }
  async snapshot(tabId: string) {
    const value = await this.call(`/tabs/${encodeURIComponent(tabId)}/snapshot?userId=${encodeURIComponent(this.config.userId)}&format=json&includeScreenshot=false`);
    if (typeof value.snapshot !== "string") throw new Error("CamoFox did not return an accessibility snapshot");
    return { snapshot: value.snapshot, refsCount: Number(value.refsCount ?? 0) };
  }
}
