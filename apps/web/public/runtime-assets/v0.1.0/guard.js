/**
 * Vibecodr Runtime Guard v0.1.0
 * Lightweight guard script to enforce basic sandbox rules inside artifacts.
 */
(function () {
  "use strict";

  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  function disableStorage() {
    try {
      if ("localStorage" in window) {
        Object.defineProperty(window, "localStorage", {
          configurable: false,
          enumerable: false,
          get: function () {
            throw new Error("E-VIBECODR-2120 storage access is not allowed in this runtime");
          },
        });
      }
    } catch (err) {
      try {
        // Fallback if defineProperty is not allowed
        window.localStorage = undefined;
      } catch (_err) {}
    }

    try {
      if ("sessionStorage" in window) {
        Object.defineProperty(window, "sessionStorage", {
          configurable: false,
          enumerable: false,
          get: function () {
            throw new Error("E-VIBECODR-2120 storage access is not allowed in this runtime");
          },
        });
      }
    } catch (err) {
      try {
        window.sessionStorage = undefined;
      } catch (_err) {}
    }

    try {
      Object.defineProperty(document, "cookie", {
        configurable: false,
        enumerable: false,
        get: function () {
          return "";
        },
        set: function () {
          throw new Error("E-VIBECODR-2121 cookie access is not allowed in this runtime");
        },
      });
    } catch (_err) {}
  }

  function disableNavigation() {
    try {
      window.open = function () {
        throw new Error("E-VIBECODR-2122 window.open is not allowed in this runtime");
      };
    } catch (_err) {}

    document.addEventListener(
      "click",
      function (event) {
        var target = event.target;
        while (target && target.tagName !== "A") {
          target = target.parentElement;
        }
        if (target && target.tagName === "A") {
          event.preventDefault();
        }
      },
      true
    );

    document.addEventListener(
      "submit",
      function (event) {
        event.preventDefault();
      },
      true
    );
  }

  function installBasicGuards() {
    disableStorage();
    disableNavigation();
  }

  installBasicGuards();

  window.vibecodrGuard = window.vibecodrGuard || {};
  window.vibecodrGuard.installBasicGuards = installBasicGuards;
})();
