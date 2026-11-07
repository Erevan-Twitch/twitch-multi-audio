/**
 * Serves `test/fixtures/` over HTTP (content scripts only run on http/https pages).
 * Reachable as both http://localhost:<port> and http://127.0.0.1:<port>, which
 * Chrome treats as two different sites.
 *
 * Usage: node scripts/serve-fixtures.ts [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");
const port = Number(process.argv[2] ?? 5310);
const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = normalize(join(fixturesDir, path === "/" ? "media-page.html" : path));
  if (!file.startsWith(fixturesDir)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Fixtures: http://localhost:${port}/media-page.html  (same page on another site: http://127.0.0.1:${port}/media-page.html)`);
});
