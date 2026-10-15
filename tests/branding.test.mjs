import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brand = "qev";
test("all tracked project-name references use the canonical lowercase spelling", () => {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const invalid = [];
  for (const file of files) {
    const path = resolve(root, file);
    if (!existsSync(path)) continue; // Unstaged deletions may still be in the Git index.
    const bytes = readFileSync(path);
    if (bytes.includes(0)) continue;
    for (const match of bytes.toString("utf8").matchAll(new RegExp(brand, "gi"))) if (match[0] !== brand) invalid.push(`${file}:${match.index}`);
  }
  assert.deepEqual(invalid, [], "Noncanonical project-name spellings must not return in code, docs, URLs, symbols or branding metadata.");
});
test("package, repository links and Pages defaults share the lowercase project name", () => {
  assert.equal(JSON.parse(readFileSync(resolve(root, "package.json"))).name, brand);
  const index = readFileSync(resolve(root, "public/index.html"), "utf8");
  assert.ok(index.includes(`https://github.com/robtandy/${brand}`));
  assert.ok(index.includes(`alt="${brand}"`));
  const readme = readFileSync(resolve(root, "README.md"), "utf8");
  assert.ok(readme.startsWith(`# ${brand}\n`));
  assert.ok(readme.includes(`https://robtandy.github.io/${brand}/`));
});
