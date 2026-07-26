import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

if (!window.location.hash) {
  window.location.hash = "#/";
}

createRoot(document.getElementById("root")!).render(<App />);

// Register the service worker (production only — during dev Vite already
// controls the page and a SW would cache the dev bundle).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        // If there's a new SW waiting, activate it right away so the user
        // gets the latest build after a hard-reload without a second refresh.
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version installed while an old one is still controlling —
              // skip waiting so the next reload lands on the new build.
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch((err) => {
        // Silent — service worker is a nice-to-have, not required.
        console.debug("SW registration skipped:", err);
      });

    // Reload once when the controlling SW changes so users land on fresh code.
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
