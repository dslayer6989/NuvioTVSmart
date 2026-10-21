// Serves the built app (dist/) for the browser tests.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".wasm": "application/wasm"
};

export function startStaticServer({ root, port = 8080, host = "0.0.0.0" }) {
  const server = http.createServer(async (request, response) => {
    let pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = path.join(root, pathname);
    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(body);
    } catch (_) {
      response.writeHead(404);
      response.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
