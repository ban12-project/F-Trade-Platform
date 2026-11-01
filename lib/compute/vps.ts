import { z } from "zod";

const chunkBytes = 4 * 1024 * 1024;
const maximumFileBytes = 1024 * 1024 * 1024 - 1;
export type ComputeProfile = "light" | "heavy";
class CapacityBusy extends Error {}
const commandResult = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

export function vpsComputeEnabled() {
  const provider = process.env.COMPUTE_PROVIDER ?? "vps";
  if (provider !== "vps") throw new Error("compute_provider_invalid");
  return true;
}

async function request(body: Record<string, unknown>): Promise<unknown> {
  const origin = new URL(process.env.VPS_RUNTIME_ORIGIN ?? "");
  const token = process.env.VPS_RUNTIME_TOKEN;
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !token ||
    !/^[A-Za-z0-9_-]{48,256}$/.test(token)
  )
    throw new Error("vps_runtime_configuration_invalid");
  const response = await fetch(new URL("/v1/compute", origin), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(610_000),
  });
  // Never reflect proxy responses or request payloads containing private data.
  if (response.status === 429 && body.action === "create") {
    const rejection = await response.text();
    if (rejection === '{"error":"runtime_capacity_busy"}') throw new CapacityBusy();
  }
  if (!response.ok) throw new Error("vps_runtime_request_failed");
  if (!response.body) throw new Error("vps_runtime_response_missing");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error("vps_runtime_response_limit");
    chunks.push(chunk);
  }
  const value = z
    .object({ result: z.unknown() })
    .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  return value.result;
}

/** Retry only an explicit pre-admission capacity rejection. Ambiguous creation
 * and command responses are never retried: the independent deadline owns them. */
export class VpsCompute {
  private constructor(private readonly id: string) {}

  static async create(profile: ComputeProfile = "heavy") {
    z.enum(["light", "heavy"]).parse(profile);
    vpsComputeEnabled();
    const deadline = Date.now() + 120_000;
    for (;;) {
      try {
        const value = z
          .object({ id: z.uuid() })
          .parse(await request({ action: "create", profile }));
        return new VpsCompute(value.id);
      } catch (error) {
        if (!(error instanceof CapacityBusy)) throw error;
        if (Date.now() >= deadline) throw new Error("vps_runtime_capacity_wait_expired");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  async download(url: string, hostname: string, path: string) {
    await request({ action: "download", id: this.id, url, hostname, path });
  }

  async stop() {
    await request({ action: "stop", id: this.id });
  }

  async runCommand(input: {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
  }) {
    const value = commandResult.parse(
      await request({
        action: "command",
        id: this.id,
        cmd: input.cmd,
        args: input.args,
        env: input.env ?? {},
      }),
    );
    return {
      exitCode: value.exitCode,
      stdout: async () => value.stdout,
      stderr: async () => value.stderr,
    };
  }

  private async file(op: string, path: string, extra: Record<string, unknown> = {}) {
    return request({ action: "fs", id: this.id, op, path, ...extra });
  }

  readonly fs = {
    mkdir: async (path: string, _options?: { recursive?: boolean }) => {
      await this.file("mkdir", path);
    },
    writeFile: async (path: string, data: string | Uint8Array) => {
      const bytes = Buffer.from(data);
      if (bytes.length > maximumFileBytes) throw new Error("vps_file_limit");
      for (let offset = 0; offset < Math.max(bytes.length, 1); offset += chunkBytes)
        await this.file("write", path, {
          offset,
          data: bytes.subarray(offset, offset + chunkBytes).toString("base64"),
        });
    },
    readFile: async (path: string) => {
      const chunks: Buffer[] = [];
      for (let offset = 0; offset <= maximumFileBytes; offset += chunkBytes) {
        const data = z.string().parse(await this.file("read", path, { offset }));
        const chunk = Buffer.from(data, "base64");
        if (chunk.length > chunkBytes || offset + chunk.length > maximumFileBytes)
          throw new Error("vps_file_limit");
        chunks.push(chunk);
        if (chunk.length < chunkBytes) return Buffer.concat(chunks);
      }
      throw new Error("vps_file_limit");
    },
    rm: async (path: string, _options?: { force?: boolean }) => {
      await this.file("rm", path);
    },
    copyFile: async (path: string, destination: string) => {
      await this.file("copy", path, { destination });
    },
  };
}
