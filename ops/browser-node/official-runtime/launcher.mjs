import { Camoufox, launchOptions } from "camoufox";
import { createNativeProfileRuntime, nativeProfileWindowSize } from "../native-profile.mjs";

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
}) {
  if (
    !proxy ||
    typeof proxy.server !== "string" ||
    !/^http:\/\//.test(proxy.server) ||
    !proxy.username ||
    !proxy.password
  )
    throw new Error("official_runtime_proxy_required");
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
          from_options: { ...options, user_data_dir: profile },
        }),
    },
  });
  if (!runtime) throw new Error("official_runtime_native_profile_required");

  return {
    assertAccount: runtime.assertAccount,
    contextFor: runtime.contextFor,
    ensureBrowser(timeoutMs) {
      return runtime.ensureBrowser(async () => {
        let options;
        try {
          options = await official.launchOptions({
            proxy: { ...proxy },
            geoip: true,
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
