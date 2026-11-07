/**
 * Builds the extension into `dist/`, ready for chrome://extensions → "Load unpacked".
 * - Bundles TypeScript entrypoints with esbuild (no extension framework).
 * - Copies static files: `public/` as-is, plus HTML/CSS from `src/`.
 *
 * Usage: node scripts/build.ts [--watch]
 */
import { cp, glob, mkdir, rm } from "node:fs/promises";
import { watch } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "src");
const publicDir = join(root, "public");
const outDir = join(root, "dist");
const isWatch = process.argv.includes("--watch");

const STATIC_PATTERNS = ["**/*.html", "**/*.css"];

async function copyStatic(): Promise<void> {
  await cp(publicDir, outDir, { recursive: true });
  for (const pattern of STATIC_PATTERNS) {
    for await (const file of glob(pattern, { cwd: srcDir })) {
      const target = join(outDir, file);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(srcDir, file), target);
    }
  }
}

const options: esbuild.BuildOptions = {
  absWorkingDir: root,
  entryPoints: {
    "background/service-worker": "src/background/service-worker.ts",
    "sidepanel/main": "src/sidepanel/main.ts",
  },
  outdir: outDir,
  bundle: true,
  format: "esm",
  target: "chrome116",
  sourcemap: isWatch ? "inline" : false,
  minify: !isWatch,
  logLevel: "info",
};

await rm(outDir, { recursive: true, force: true });
await copyStatic();

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  for (const dir of [srcDir, publicDir]) {
    watch(dir, { recursive: true }, (_event, file) => {
      if (file && (dir === publicDir || /\.(html|css)$/.test(file))) {
        copyStatic()
          .then(() => console.log(`[static] copied ${relative(root, join(dir, file))}`))
          .catch((error: unknown) => console.error("[static] copy failed", error));
      }
    });
  }
  console.log("Watching for changes. Reload the extension in chrome://extensions after edits.");
} else {
  await esbuild.build(options);
}
