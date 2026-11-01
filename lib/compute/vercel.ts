import { FileSystem, Sandbox, type Session } from "@vercel/sandbox";
import { z } from "zod";
import type { ComputeProfile } from "./vps";

const maximumFileBytes = 1024 * 1024 * 1024 - 1;
const maximumSourceBytes = 3 * 1024 * 1024 * 1024 - 1;

export function computeSandboxOptions(profile: ComputeProfile) {
  z.enum(["light", "heavy"]).parse(profile);
  const image = process.env.COMPUTE_SANDBOX_IMAGE;
  if (!image || !/^[a-zA-Z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("compute_sandbox_image_invalid");
  return {
    image,
    persistent: false,
    timeout: 600_000,
    resources: { vcpus: profile === "light" ? 1 : 4 },
    networkPolicy: "deny-all" as const,
    tags: { workload: "f-trade-runtime" },
  };
}

export function validateComputeSource(url: string, hostname: string, destination: string) {
  const source = new URL(url);
  if (
    source.protocol !== "https:" ||
    source.username ||
    source.password ||
    source.port ||
    source.hash ||
    source.hostname !== hostname ||
    !/^[a-z0-9-]+\.private\.blob\.vercel-storage\.com$/.test(hostname) ||
    !/^\/vercel\/sandbox\/work\/[a-zA-Z0-9_.-]+$/.test(destination)
  )
    throw new Error("compute_source_invalid");
  return source;
}

// The trusted downloader never follows redirects or prints signed URLs. The
// VM firewall only opens this exact Blob host during download, then closes it.
const downloadScript = `
import os, sys, urllib.request
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None
try:
    limit = int(os.environ['SOURCE_LIMIT'])
    size = 0
    with urllib.request.build_opener(NoRedirect).open(os.environ['SOURCE_URL'], timeout=60) as response:
        if response.status != 200: raise ValueError('status')
        if int(response.headers.get('Content-Length', '0')) > limit: raise ValueError('size')
        with open(os.environ['SOURCE_PATH'], 'xb') as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk: break
                size += len(chunk)
                if size > limit: raise ValueError('size')
                output.write(chunk)
    print(size)
except Exception:
    print('compute_source_download_failed', file=sys.stderr)
    sys.exit(1)
`;

export class VercelCompute {
  private downloadedBytes = 0;
  private readonly session: Session;
  private readonly files: FileSystem;
  private constructor(private readonly sandbox: Sandbox) {
    // Session operations fail when stopped instead of auto-resuming a new VM.
    this.session = sandbox.currentSession();
    this.files = new FileSystem(this.session);
  }

  static async create(profile: ComputeProfile = "heavy") {
    const sandbox = await Sandbox.create(computeSandboxOptions(profile));
    try {
      const runtime = new VercelCompute(sandbox);
      await runtime.fs.mkdir("/vercel/sandbox/work", { recursive: true });
      return runtime;
    } catch (error) {
      await sandbox.delete({ deleteOrphanSnapshots: true }).catch(() => undefined);
      throw error;
    }
  }

  readonly fs = {
    mkdir: (path: string, options?: { recursive?: boolean }) => this.files.mkdir(path, options),
    writeFile: async (path: string, data: string | Uint8Array) => {
      if (Buffer.byteLength(data) > maximumFileBytes) throw new Error("compute_file_limit");
      await this.files.writeFile(path, data);
    },
    readFile: async (path: string) => {
      const info = await this.files.stat(path);
      if (!info.isFile() || info.size > maximumFileBytes) throw new Error("compute_file_limit");
      return this.files.readFile(path);
    },
    rm: (path: string, options?: { force?: boolean }) => this.files.rm(path, options),
    copyFile: (path: string, destination: string) => this.files.copyFile(path, destination),
  };

  runCommand(input: { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> }) {
    return this.session.runCommand(input);
  }

  async download(url: string, hostname: string, destination: string) {
    validateComputeSource(url, hostname, destination);
    const limit = Math.min(maximumFileBytes, maximumSourceBytes - this.downloadedBytes);
    if (limit <= 0) throw new Error("compute_source_limit");
    await this.session.update({ networkPolicy: { allow: [hostname] } });
    try {
      const result = await this.session.runCommand({
        cmd: "python3",
        args: ["-c", downloadScript],
        env: { SOURCE_URL: url, SOURCE_PATH: destination, SOURCE_LIMIT: String(limit) },
      });
      if (result.exitCode !== 0) throw new Error("compute_source_download_failed");
      const size = z
        .number()
        .int()
        .min(0)
        .max(limit)
        .parse(Number((await result.stdout()).trim()));
      this.downloadedBytes += size;
    } finally {
      // A failure here aborts the caller, whose finally deletes the VM.
      await this.session.update({ networkPolicy: "deny-all" });
    }
  }

  async stop() {
    await this.sandbox.delete({ deleteOrphanSnapshots: true });
  }
}
