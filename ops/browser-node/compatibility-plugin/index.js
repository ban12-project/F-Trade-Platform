export function register(_app, ctx, config = {}) {
  if (config.enabled !== true) return;
  ctx.events.on("browser:launching", ({ options }) => {
    options.firefoxUserPrefs = {
      ...options.firefoxUserPrefs,
      // MVP1 only uses text Messenger; disable WebRTC's direct UDP paths.
      "media.peerconnection.enabled": false,
    };
  });
}
