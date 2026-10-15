// Preview only the built static artifact, including a real project-site prefix.
// No dynamic demo/vendor mounts or GitHub-specific response headers are needed.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".gz": "application/gzip" };
export function makePagesServer(directory = resolve(root, "build/site"), { basePath = "/qev/" } = {}) {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath)) throw new Error("Expected a /project/ base path.");
  return createServer(async (req, res) => {
    try {
      if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405, { Allow: "GET, HEAD" }).end(); return; }
      const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (basePath !== "/" && path === basePath.slice(0, -1)) { res.writeHead(308, { Location: basePath }).end(); return; }
      if (!path.startsWith(basePath)) { res.writeHead(404).end("Not found"); return; }
      const relative = path.slice(basePath.length) || "index.html";
      if (relative.includes("\\") || relative.includes("\0") || relative.split("/").some(p => p.startsWith("."))) { res.writeHead(403).end("Forbidden"); return; }
      const base = await realpath(directory), file = await realpath(resolve(base, relative));
      if (!file.startsWith(base + sep)) { res.writeHead(403).end("Forbidden"); return; }
      const info = await stat(file);
      if (!info.isFile()) { res.writeHead(404).end("Not found"); return; }
      res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Content-Length": info.size,
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      if (req.method === "HEAD") res.end(); else createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch { if (!res.headersSent) res.writeHead(404).end("Not found"); else res.destroy(); }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8092);
  makePagesServer().listen(port, "127.0.0.1", () => console.log(`Pages preview: http://127.0.0.1:${port}/qev/ (npm run build:pages first)`));
}
