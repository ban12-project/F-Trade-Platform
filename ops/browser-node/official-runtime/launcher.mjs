import { Camoufox, launchOptions } from "camoufox";
import { createNativeProfileRuntime, nativeProfileWindowSize } from "../native-profile.mjs";
import { needsUpdate } from "./node_modules/camoufox/dist/geolocation.js";

// This adapter is not selected by the production image. The surrounding service
// must supply a fixed proxy and an owned display before admitting any task.
export function createOfficialLauncher({
  environment = process.env,
  root,
  leaseDeadline,
  proxy,
  display,
  executablePath,
  official = { Camoufox, launchOptions },
  checkAssets = async () => {
    if (await needsUpdate()) throw new Error("official_runtime_assets_stale");
  },
}) {
  if (
    !proxy ||
    typeof proxy.server !== "string" ||
    !/^http:\/\//.test(proxy.server) ||
    ![proxy.username, proxy.password].every(
      (value) => typeof value === "string" && value.length <= 4096 && !value.includes("\0"),
    )
  )
    throw new Error("official_runtime_proxy_required");
  const proxyUrl = new URL(proxy.server);
  if (
    proxyUrl.username ||
    proxyUrl.password ||
    proxyUrl.search ||
    proxyUrl.hash ||
    proxyUrl.pathname !== "/" ||
    !/^[A-Za-z0-9.-]{1,253}$/.test(proxyUrl.hostname) ||
    !proxyUrl.port
  )
    throw new Error("official_runtime_proxy_invalid");
  if (typeof display !== "string" || !/^:\d+(?:\.\d+)?$/.test(display))
    throw new Error("official_runtime_display_required");
  if (typeof executablePath !== "string" || !executablePath.startsWith("/"))
    throw new Error("official_runtime_executable_required");

  const runtime = createNativeProfileRuntime({
    environment,
    root,
    leaseDeadline,
    firefox: {
      launchPersistentContext: (profile, options) =>
        official.Camoufox({
          persistent_context: true,
          from_options: {
            ...options,
            user_data_dir: profile,
            // The service owns shutdown ordering and flushes the native context
            // before closing its display. Avoid Playwright's competing handlers.
            handleSIGTERM: false,
            handleSIGINT: false,
            handleSIGHUP: false,
          },
        }),
    },
  });
  if (!runtime) throw new Error("official_runtime_native_profile_required");

  return {
    assertAccount: runtime.assertAccount,
    contextFor: runtime.contextFor,
    ensureBrowser(timeoutMs) {
      return runtime.ensureBrowser(async () => {
        // Fail before official GeoIP can attempt a runtime database download.
        // Refresh assets by rebuilding the immutable image, never by fallback.
        await checkAssets();
        let options;
        try {
          options = await official.launchOptions({
            proxy: { ...proxy },
            geoip: true,
            // Preserve the current Linux runtime, cache and add-on policy.
            // The account profile owns persistence; no runtime asset downloads.
            os: "linux",
            humanize: true,
            enable_cache: true,
            exclude_addons: ["UBO"],
            headless: false,
            virtual_display: display,
            executable_path: executablePath,
            window: nativeProfileWindowSize(environment),
          });
        } catch {
          // Launcher errors may contain proxy credentials. Never retry without
          // GeoIP, and never put the original exception in shared logs.
          throw new Error("official_runtime_launch_options_failed");
        }
        return runtime.launch(options);
      }, timeoutMs);
    },
  };
}
