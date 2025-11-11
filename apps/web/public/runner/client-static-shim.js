/**
 * Vibecodr Client-Static Runner Shim
 * Injected into capsules to provide postMessage bridge and capability enforcement
 * Based on research-sandbox-and-runner.md
 */

(function () {
  "use strict";

  // Performance tracking
  const bootStart = performance.now();
  let isReady = false;

  // Console proxy for logging/debugging
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };

  // Override console methods to send to parent
  ["log", "warn", "error", "info"].forEach((level) => {
    console[level] = function (...args) {
      // Call original
      originalConsole[level].apply(console, args);

      // Send to parent with sampling (1 in 10 for non-errors)
      if (level === "error" || Math.random() < 0.1) {
        sendMessage("log", {
          level,
          message: args.map((arg) => String(arg)).join(" "),
          timestamp: Date.now(),
        });
      }
    };
  });

  // Global error handler
  window.addEventListener("error", (event) => {
    sendMessage("error", {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    sendMessage("error", {
      message: `Unhandled Promise Rejection: ${event.reason}`,
    });
  });

  // PostMessage bridge
  function sendMessage(type, payload) {
    if (window.parent !== window) {
      window.parent.postMessage(
        {
          type,
          payload,
          source: "vibecodr-capsule",
        },
        "*"
      );
    }
  }

  // Listen for param updates from parent
  window.addEventListener("message", (event) => {
    // TODO: Verify origin in production
    const { type, payload } = event.data;

    switch (type) {
      case "setParams":
        if (window.vibecodr && typeof window.vibecodr.setParams === "function") {
          window.vibecodr.setParams(payload);
        }
        break;

      case "restart":
        if (window.vibecodr && typeof window.vibecodr.restart === "function") {
          window.vibecodr.restart();
        } else {
          // Default: reload page
          window.location.reload();
        }
        break;

      case "kill":
        // Stop all execution if possible
        if (window.vibecodr && typeof window.vibecodr.kill === "function") {
          window.vibecodr.kill();
        }
        sendMessage("killed", {});
        break;
    }
  });

  // Performance monitoring
  let lastFPS = 60;
  let frameCount = 0;
  let lastTime = performance.now();

  function measurePerformance() {
    const now = performance.now();
    frameCount++;

    if (now >= lastTime + 1000) {
      lastFPS = Math.round((frameCount * 1000) / (now - lastTime));
      frameCount = 0;
      lastTime = now;

      // Send stats to parent
      const memory = performance.memory
        ? performance.memory.usedJSHeapSize
        : 0;

      sendMessage("stats", {
        fps: lastFPS,
        memory,
        bootTime: isReady ? Math.round(performance.now() - bootStart) : 0,
      });
    }

    if (isReady) {
      requestAnimationFrame(measurePerformance);
    }
  }

  // Global vibecodr API
  window.vibecodr = {
    // Capsule calls this when ready
    ready: function (options = {}) {
      if (isReady) return;
      isReady = true;

      const bootTime = Math.round(performance.now() - bootStart);
      console.info(`[Vibecodr] Capsule ready in ${bootTime}ms`);

      sendMessage("ready", {
        bootTime,
        capabilities: options.capabilities || {},
      });

      // Start performance monitoring
      requestAnimationFrame(measurePerformance);
    },

    // Capsule can define param handlers
    setParams: function (params) {
      console.warn("[Vibecodr] setParams not implemented by capsule");
    },

    // Capsule can define restart handler
    restart: function () {
      console.warn("[Vibecodr] restart not implemented by capsule");
    },

    // Capsule can define kill handler
    kill: function () {
      console.warn("[Vibecodr] kill not implemented by capsule");
    },

    // Get current params (sent from parent)
    params: {},
  };

  // Auto-ready after 5 seconds if capsule doesn't call it
  setTimeout(() => {
    if (!isReady) {
      console.warn("[Vibecodr] Auto-triggering ready after 5s timeout");
      window.vibecodr.ready();
    }
  }, 5000);

  console.info("[Vibecodr] Runner shim loaded");
})();
