/**
 * Vibecodr Runtime Bridge v0.1.0
 * Shared postMessage and telemetry helper for iframe runtimes.
 * Designed to be safe to include in sandboxed iframes.
 */
(function () {
  "use strict";

  if (typeof window === "undefined") {
    return;
  }

  var BOOT_START =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  var SOURCE = "vibecodr-artifact-runtime";

  function postToParent(type, payload) {
    if (!type) {
      return;
    }
    if (!window.parent || window.parent === window) {
      return;
    }

    try {
      window.parent.postMessage(
        {
          type: type,
          payload: payload || {},
          source: SOURCE,
        },
        "*"
      );
    } catch (err) {
      // PostMessage failures are contained inside the sandbox.
    }
  }

  function ready(extra) {
    if (window.vibecodrBridge && window.vibecodrBridge._readyFlag) {
      return;
    }

    var now =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    var bootTime = now - BOOT_START;

    if (!extra || typeof extra !== "object") {
      extra = {};
    }

    window.vibecodrBridge = window.vibecodrBridge || {};
    window.vibecodrBridge._readyFlag = true;

    postToParent("ready", {
      bootTime: Math.round(bootTime),
      capabilities: extra.capabilities || {},
    });
  }

  function log(level, message, extra) {
    var text = String(message != null ? message : "");
    var payload = {
      level: level || "log",
      message: text,
      timestamp: Date.now(),
    };

    if (extra && typeof extra === "object") {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) {
          payload[key] = extra[key];
        }
      }
    }

    postToParent("log", payload);
  }

  function error(err, extra) {
    var payload = {
      message: "",
      code: undefined,
    };

    if (err instanceof Error) {
      payload.message = err.message;
    } else if (typeof err === "string") {
      payload.message = err;
    } else {
      payload.message = "Unknown runtime error";
    }

    if (extra && typeof extra === "object") {
      for (var key in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, key)) {
          payload[key] = extra[key];
        }
      }
    }

    postToParent("error", payload);
  }

  function stats(data) {
    if (!data || typeof data !== "object") {
      return;
    }
    postToParent("stats", data);
  }

  function listen(handlers) {
    if (!handlers || typeof handlers !== "object") {
      return function () {};
    }

    function onMessage(event) {
      var data = event.data || {};
      var type = data.type;

      if (!type) {
        return;
      }

      var handler = handlers[type];
      if (typeof handler === "function") {
        try {
          handler(data.payload);
        } catch (err) {
          error(err, { code: "E-VIBECODR-2102", phase: "handler:" + type });
        }
      }
    }

    window.addEventListener("message", onMessage);
    return function () {
      window.removeEventListener("message", onMessage);
    };
  }

  window.vibecodrBridge = window.vibecodrBridge || {};
  window.vibecodrBridge.ready = ready;
  window.vibecodrBridge.log = log;
  window.vibecodrBridge.error = error;
  window.vibecodrBridge.stats = stats;
  window.vibecodrBridge.listen = listen;
  window.vibecodrBridge.send = postToParent;
})();
