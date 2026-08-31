#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { ALL, NAMES } from "./checks.mjs";
import { packedFiles } from "./pack.mjs";

const C = { reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m" };

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i === -1 ? d : argv[i + 1]; };

if (has("--help") || has("-h")) {
  console.log(`salvo — npm publish'ten önce paketin söylediği şey olduğunu doğrular

  salvo [dizin]              denetle; sorun varsa 1 ile çık
  salvo --json               makine okunur çıktı
  salvo --skip <kontrol>     bir kontrolü atla (virgülle birden fazla)
  salvo --build-dir dist     derleme çıktısı dizini (varsayılan: dist,build,lib)

Kontroller: ${Object.values(NAMES).join(", ")}
`);
  process.exit(0);
}

const dir = resolve(argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--")) ?? ".");
const pkgPath = join(dir, "package.json");
if (!existsSync(pkgPath)) { console.error(`package.json yok: ${dir}`); process.exit(2); }
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const skip = new Set((val("--skip", "") || "").split(",").filter(Boolean));
const buildDirs = (val("--build-dir", "dist,build,lib")).split(",");

let packed;
try { packed = packedFiles(dir); }
catch (err) { console.error(`npm pack çalıştırılamadı: ${String(err.message).split("\n")[0]}`); process.exit(2); }

const ctx = {
  dir, pkg, files: packed.files, buildDirs,
  install: existsSync(join(dir, "bun.lock")) || existsSync(join(dir, "bun.lockb"))
    ? ["bun", "install", "--frozen-lockfile"]
    : ["npm", "ci", "--ignore-scripts", "--silent"],
};

const findings = [];
for (const [fn, name] of Object.entries(NAMES)) {
  if (skip.has(name)) continue;
  findings.push(...ALL[fn](ctx));
}

const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");

if (has("--json")) {
  console.log(JSON.stringify({ package: `${packed.name}@${packed.version}`, files: packed.files.length, findings }, null, 2));
} else {
  console.log(`\n  ${C.bold}${packed.name}@${packed.version}${C.reset}${C.dim}  ${packed.files.length} dosya, ${(packed.size / 1024).toFixed(0)} KB${C.reset}\n`);
  for (const f of [...errors, ...warns]) {
    const mark = f.level === "error" ? `${C.red}✗${C.reset}` : `${C.yellow}!${C.reset}`;
    console.log(`  ${mark} ${C.dim}${f.check}${C.reset}  ${f.message}`);
    if (f.detail) console.log(`      ${C.dim}${f.detail}${C.reset}`);
  }
  console.log(errors.length
    ? `\n  ${C.red}${C.bold}${errors.length} engel${C.reset}${warns.length ? `, ${warns.length} uyarı` : ""} — yayınlama.\n`
    : warns.length
      ? `\n  ${C.yellow}${warns.length} uyarı${C.reset}, engel yok.\n`
      : `\n  ${C.green}${C.bold}temiz${C.reset} — paket söylediği şey.\n`);
}

process.exit(errors.length ? 1 : 0);
