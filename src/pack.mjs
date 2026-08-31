/**
 * `npm pack --dry-run --json` paketin gerçekten neyi göndereceğini söyleyen
 * tek kaynak. `files` alanını elle yorumlamak .npmignore, iç içe gitignore ve
 * npm'in kendi zorunlu/dışlanan listeleriyle er ya da geç ayrışır.
 */
import { execFileSync } from "node:child_process";

export function packedFiles(dir) {
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20,
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  });
  const parsed = JSON.parse(out);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  return {
    files: (entry.files ?? []).map((f) => f.path),
    size: entry.size,
    unpackedSize: entry.unpackedSize,
    name: entry.name,
    version: entry.version,
  };
}
