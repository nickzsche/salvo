#!/usr/bin/env node
/** Tanıtım sayfası. Tek dosya, bağımlılık yok. */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "site", "index.html"));
const port = Number(process.argv[2] ?? 3500);

createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok\n"); return; }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, () => console.log(`salvo sitesi: http://localhost:${port}`));
