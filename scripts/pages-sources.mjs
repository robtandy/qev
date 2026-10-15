// Corresponding-source downloads for the GPL engine and gamecode published in
// the Pages artifact. Generated archives/caches stay in ignored build/, never Git.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { ENGINE_INPUTS } from "./engine-inputs.mjs";

export const PAGE_SOURCES = Object.freeze([
  { name: "librequake-code", url: "https://github.com/lavenderdotpet/LibreQuake.git", revision: "d1515ca9bc01e590f2d54dc496f55c9a4ed72369",
    paths: ["qcsrc", "docs", "README.md", "build.py", "build_components.json", "build_releases.json"] },
  { name: "pop-generator", url: "https://github.com/MissLavender-LQ/pop.lmp_generator.git", revision: "4d36d3cde335e539b73b9b60bab62e2c0b835f35",
    paths: ["LICENSE", "README.md", "common.c", "getpop.c", "gnu.txt"] },
]);
function git(directory, args, options = {}) {
  return execFileSync("git", ["-C", directory, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}
async function sourceArchive(root, spec, output) {
  const cache = resolve(root, "build/pages-sources", `${spec.name}.git`);
  if (!existsSync(cache)) {
    await mkdir(dirname(cache), { recursive: true });
    execFileSync("git", ["init", "--bare", cache], { stdio: "ignore" });
    git(cache, ["remote", "add", "origin", spec.url]);
    git(cache, ["config", "remote.origin.promisor", "true"]);
    git(cache, ["config", "remote.origin.partialclonefilter", "blob:none"]);
  }
  if (git(cache, ["config", "--get", "remote.origin.url"]).trim() !== spec.url) throw new Error(`Unexpected ${spec.name} source cache; refusing to publish it.`);
  try { git(cache, ["cat-file", "-e", `${spec.revision}^{commit}`], { stdio: "ignore" }); }
  catch { git(cache, ["fetch", "--depth=1", "--filter=blob:none", "origin", spec.revision], { stdio: "inherit" }); }
  if (git(cache, ["rev-parse", `${spec.revision}^{commit}`]).trim() !== spec.revision) throw new Error("Unpinned source revision.");
  const bytes = git(cache, ["archive", "--format=tar", `--prefix=${spec.name}/`, spec.revision, ...spec.paths], { encoding: null });
  await writeFile(resolve(output, `${spec.name}.tar.gz`), gzipSync(bytes));
}

export async function buildPageSources(root, site, build) {
  const output = resolve(site, "sources"); await mkdir(output, { recursive: true });
  for (const spec of PAGE_SOURCES) await sourceArchive(root, spec, output);
  const stage = await mkdtemp(resolve(root, "build/engine-source-"));
  try {
    const sourceRoot = resolve(stage, "qev-engine-source"), upstream = resolve(root, "build/qwasm");
    if (git(upstream, ["rev-parse", "HEAD"]).trim() !== build.qwasm) throw new Error("Engine source checkout does not match the build.");
    const engineDir = resolve(sourceRoot, "upstream/WinQuake"); await mkdir(engineDir, { recursive: true });
    // The web build uses these top-level C/header files. Do NOT redistribute
    // upstream's unrelated kit/EXEs, proprietary SDK libraries, or QuakeWorld binaries.
    for (const entry of await readdir(resolve(upstream, "WinQuake"), { withFileTypes: true })) {
      if (entry.isFile() && (/\.(c|h)$/.test(entry.name) || ["Makefile.emscripten", "Makefile.qev"].includes(entry.name)))
        await cp(resolve(upstream, "WinQuake", entry.name), resolve(engineDir, entry.name));
    }
    await cp(resolve(upstream, "gnu.txt"), resolve(sourceRoot, "upstream/COPYING"));
    for (const name of [...ENGINE_INPUTS, "engine/COPYING", "engine/README.md"]) {
      const dest = resolve(sourceRoot, "qev", name); await mkdir(dirname(dest), { recursive: true });
      await cp(resolve(root, name), dest);
    }
    await writeFile(resolve(sourceRoot, "build.json"), JSON.stringify(build, null, 2) + "\n");
    const emscripten = resolve(root, "build/tools/emsdk/upstream/emscripten");
    const sdl = resolve(emscripten, "cache/ports/sdl2/SDL-release-2.30.9");
    if (!existsSync(resolve(sdl, "LICENSE.txt"))) throw new Error("SDL2 corresponding source is missing; rebuild the engine before publishing.");
    await cp(sdl, resolve(sourceRoot, "SDL2-2.30.9"), { recursive: true });
    await cp(resolve(emscripten, "LICENSE"), resolve(sourceRoot, "EMSCRIPTEN-LICENSE.txt"));
    await writeFile(resolve(sourceRoot, "README.txt"), `qev web-engine corresponding source\n\nThe modified C/header sources actually used by the web build are in upstream/WinQuake.\nThe integration sources, patch, input manifest and reproduction scripts are in qev/.\nSDL 2.30.9 source and license are included. No proprietary game data is included.\n\nUpstream Qwasm: https://github.com/GMH-Code/Qwasm/tree/${build.qwasm}\nToolchain: Emscripten ${build.emscripten}, installed by the pinned setup-toolchain.sh.\nIntegration SHA-256: ${build.sourceDigest}\n\nTo reproduce with Node.js 22+, Git, Python 3 and make:\n  cd qev\n  bash scripts/setup-toolchain.sh\n  node scripts/build-engine.mjs\nThese scripts fetch the pinned upstream/toolchain and apply the supplied patch/modules.\nThe already-modified upstream sources and generated Makefile.qev are also provided for inspection and offline rebuilding with that toolchain.\n\nPublic project and build instructions: https://github.com/robtandy/qev\nThe engine/integration is GPL-2.0-or-later; see upstream/COPYING and qev/engine/COPYING.\nSDL is zlib-licensed; see SDL2-2.30.9/LICENSE.txt. Emscripten uses MIT/UIUC licenses; see EMSCRIPTEN-LICENSE.txt.\n`);
    execFileSync("tar", ["-czf", resolve(output, "qev-engine.tar.gz"), "-C", stage, "qev-engine-source"], { stdio: "inherit" });
    await mkdir(resolve(site, "licenses"), { recursive: true });
    await cp(resolve(sdl, "LICENSE.txt"), resolve(site, "licenses/SDL2.txt"));
    await cp(resolve(emscripten, "LICENSE"), resolve(site, "licenses/EMSCRIPTEN.txt"));
  } finally { await rm(stage, { recursive: true, force: true }); }
  await writeFile(resolve(output, "manifest.json"), JSON.stringify({ engine: build, repositories: PAGE_SOURCES }, null, 2) + "\n");
}
