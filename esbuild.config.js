const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watchMode = process.argv.includes("--watch");
const pluginsDir = path.join(__dirname, "plugins");
const distDir = path.join(__dirname, "dist");

// Find all plugins (directories with manifest.json)
const plugins = fs
  .readdirSync(pluginsDir, { withFileTypes: true })
  .filter((dirent) => dirent.isDirectory())
  .filter((dirent) =>
    fs.existsSync(path.join(pluginsDir, dirent.name, "manifest.json")),
  )
  .map((dirent) => dirent.name);

if (plugins.length === 0) {
  console.log("No plugins found in plugins/ directory");
  process.exit(0);
}

console.log(`Found ${plugins.length} plugin(s): ${plugins.join(", ")}`);

// Build each plugin
async function build() {
  for (const plugin of plugins) {
    const pluginDir = path.join(pluginsDir, plugin);
    const outDir = path.join(distDir, plugin);

    // Ensure output directory exists
    fs.mkdirSync(outDir, { recursive: true });

    // Copy manifest.json
    fs.copyFileSync(
      path.join(pluginDir, "manifest.json"),
      path.join(outDir, "manifest.json"),
    );

    // Build TypeScript to main.js
    const ctx = await esbuild.context({
      entryPoints: [path.join(pluginDir, "src", "index.ts")],
      bundle: true,
      format: "iife",
      globalName: "plugin",
      target: "es2020",
      platform: "neutral",
      outfile: path.join(outDir, "main.js"),
      logLevel: "info",
    });

    if (watchMode) {
      await ctx.watch();
      console.log(`Watching ${plugin}...`);
    } else {
      await ctx.rebuild();
      await ctx.dispose();
      console.log(`Built ${plugin}`);
    }
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
