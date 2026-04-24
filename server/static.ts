import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Hashed assets (JS, CSS, images) — filenames change every build so it's
  // safe to cache them forever. This makes repeat visits instant.
  app.use(express.static(distPath, {
    maxAge: "1y",
    immutable: true,
    setHeaders: (res, filePath) => {
      // HTML must NEVER be cached — it references hashed bundle filenames.
      // A stale HTML file pointing at old (now-deleted) bundles = broken app.
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  }));

  // SPA fallback — serve index.html for all unknown routes.
  // Always no-store so the browser fetches fresh HTML on every navigation.
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
