/**
 * Vibecodr HTML Runtime v0.1.0
 * Renders HTML artifacts inside sandboxed iframes.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  function render(options) {
    options = options || {};
    var html = options.html || "";
    var mountSelector = options.mountSelector || "#root";

    try {
      if (
        window.vibecodrGuard &&
        typeof window.vibecodrGuard.installBasicGuards === "function"
      ) {
        window.vibecodrGuard.installBasicGuards();
      }

      var container =
        document.querySelector(mountSelector) ||
        document.body ||
        document.documentElement;

      container.innerHTML = html;

      if (window.vibecodrBridge && typeof window.vibecodrBridge.ready === "function") {
        window.vibecodrBridge.ready({
          capabilities: options.capabilities || {},
        });
      }
    } catch (err) {
      if (window.vibecodrBridge && typeof window.vibecodrBridge.error === "function") {
        window.vibecodrBridge.error(err, {
          code: "E-VIBECODR-2101",
          phase: "html-render",
        });
      }
    }
  }

  window.VibecodrHtmlRuntime = window.VibecodrHtmlRuntime || {};
  window.VibecodrHtmlRuntime.render = render;
})();
