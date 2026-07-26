import express from 'express';
import type { Express } from 'express';
import fs from "node:fs";
import path from "node:path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    express.static(distPath, {
      // Cache-control per file type. Vite hashes assets under /assets/ so
      // those are safe to cache aggressively; the SW and manifest must be
      // re-checked on every load so users always get the newest build.
      setHeaders(res, filePath) {
        const rel = path.relative(distPath, filePath).replace(/\\/g, "/");

        if (rel === "sw.js" || rel === "manifest.webmanifest") {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          if (rel === "sw.js") {
            // Broaden the SW scope even if it lives in /public/ root.
            res.setHeader("Service-Worker-Allowed", "/");
            res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          } else {
            res.setHeader(
              "Content-Type",
              "application/manifest+json; charset=utf-8"
            );
          }
          return;
        }

        if (rel.startsWith("assets/")) {
          // Hashed, immutable build outputs.
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable"
          );
          return;
        }

        if (rel === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }

        // Icons, splash images, favicons — refresh daily at most.
        res.setHeader("Cache-Control", "public, max-age=86400");
      },
    })
  );

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
