/** Firefox <154 can omit Cookie/Origin on proxied HTTP/2 WebSocket handshakes.
 * Keep WebSockets on HTTP/1.1 until the pinned Camoufox includes Mozilla 2037813.
 * https://bugzilla.mozilla.org/show_bug.cgi?id=2037813
 */
export function register(_app, ctx, config = {}) {
  if (config.enabled !== true) return;
  ctx.events.on("browser:launching", ({ options }) => {
    options.firefoxUserPrefs = {
      ...options.firefoxUserPrefs,
      "network.http.http2.websockets": false,
    };
  });
}
