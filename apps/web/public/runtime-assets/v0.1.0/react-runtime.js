/**
 * Vibecodr React Runtime v0.1.0
 * Bootstraps React-based artifacts inside sandboxed iframes.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  function bootstrap(options) {
    options = options || {};
    var mountSelector = options.mountSelector || "#root";
    var Component = options.Component || options.component || null;

    if (!Component) {
      if (window.vibecodrBridge && typeof window.vibecodrBridge.error === "function") {
        window.vibecodrBridge.error(
          "E-VIBECODR-2101 artifact runtime missing Component",
          { code: "E-VIBECODR-2101", phase: "bootstrap" }
        );
      }
      return;
    }

    if (!window.React || !window.ReactDOM) {
      if (window.vibecodrBridge && typeof window.vibecodrBridge.error === "function") {
        window.vibecodrBridge.error(
          "E-VIBECODR-2101 artifact runtime React globals not found",
          { code: "E-VIBECODR-2101", phase: "bootstrap" }
        );
      }
      return;
    }

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

      var element = window.React.createElement(Component, {
        bridge: window.vibecodrBridge || null,
      });

      if (window.ReactDOM.createRoot) {
        var root = window.ReactDOM.createRoot(container);
        root.render(element);
      } else if (typeof window.ReactDOM.render === "function") {
        window.ReactDOM.render(element, container);
      }

      if (window.vibecodrBridge && typeof window.vibecodrBridge.ready === "function") {
        window.vibecodrBridge.ready({
          capabilities: options.capabilities || {},
        });
      }
    } catch (err) {
      if (window.vibecodrBridge && typeof window.vibecodrBridge.error === "function") {
        window.vibecodrBridge.error(err, {
          code: "E-VIBECODR-2101",
          phase: "render",
        });
      }
    }
  }

  window.VibecodrReactRuntime = window.VibecodrReactRuntime || {};
  window.VibecodrReactRuntime.bootstrap = bootstrap;
})();
