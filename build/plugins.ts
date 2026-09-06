import { type BunPlugin } from "bun";
import { minifyHTML, minifyCSS, minifySVG, isProduction } from "./utils";
import { resolve } from "node:path";

/**
 * Bun plugin to import HTML, CSS, and SVG files as strings
 * Applies minification in production builds
 *
 * Uses onResolve to resolve full paths and mark files for custom loading,
 * then onLoad to process them. This ensures Bun doesn't use its default file loader.
 */
export const textFileLoaderPlugin: BunPlugin = {
  name: "text-file-loader",
  setup(build) {
    const projectRoot = resolve(".");

    // Resolve path, handling @/ alias
    const resolvePath = (importPath: string, resolveDir: string): string => {
      if (importPath.startsWith("@/")) {
        // @/ alias points to project root
        return resolve(projectRoot, importPath.slice(2));
      }
      return resolve(resolveDir, importPath);
    };

    // Resolve CSS imports to our custom namespace with full path
    build.onResolve({ filter: /\.css$/ }, (args) => {
      if (args.namespace === "text-file") return;
      // Skip node_modules
      if (args.resolveDir.includes("node_modules")) return;
      const resolvedPath = resolvePath(args.path, args.resolveDir);
      return {
        path: resolvedPath,
        namespace: "text-file",
      };
    });

    // Resolve HTML imports to our custom namespace with full path
    build.onResolve({ filter: /\.html$/ }, (args) => {
      if (args.namespace === "text-file") return;
      const resolvedPath = resolvePath(args.path, args.resolveDir);
      return {
        path: resolvedPath,
        namespace: "text-file",
      };
    });

    // Resolve SVG imports to our custom namespace with full path
    build.onResolve({ filter: /\.svg$/ }, (args) => {
      if (args.namespace === "text-file") return;
      // Skip node_modules
      if (args.resolveDir.includes("node_modules")) return;
      const resolvedPath = resolvePath(args.path, args.resolveDir);
      return {
        path: resolvedPath,
        namespace: "text-file",
      };
    });

    // Load files as text from the text-file namespace
    build.onLoad({ filter: /.*/, namespace: "text-file" }, async (args) => {
      try {
        const content = await Bun.file(args.path).text();
        const ext = args.path.slice(args.path.lastIndexOf("."));
        const minify = isProduction
          ? ext === ".css"
            ? minifyCSS
            : ext === ".svg"
              ? minifySVG
              : minifyHTML
          : (s: string) => s;
        const processed = minify(content);
        return {
          contents: `export default ${JSON.stringify(processed)};`,
          loader: "js",
        };
      } catch (err) {
        console.error(`[text-file-loader] Failed to load: ${args.path}`, err);
        throw err;
      }
    });
  },
};

/**
 * Bun plugin to replace restricted Node modules with Blockbench-compatible versions
 * Uses Blockbench's supported native-module permission API.
 */
export const blockbenchCompatPlugin: BunPlugin = {
  name: "blockbench-compat",
  setup(build) {
    // Bun's Node/CommonJS resolver prefers jsonc-parser's UMD `main` entry.
    // That wrapper delegates its relative imports to the runtime `require`,
    // leaving ./impl/* files outside the single-file Blockbench bundle. Resolve
    // the package to its ESM implementation so Bun can statically include every
    // parser module in the distributable.
    build.onResolve({ filter: /^jsonc-parser$/ }, () => {
      return {
        path: resolve("node_modules/jsonc-parser/lib/esm/main.js"),
      };
    });

    const nativeImports = /^(?:node:)?(?:fs(?:\/promises)?|path|process)$/;
    build.onResolve({ filter: nativeImports }, ({ path }) => ({ path, namespace: "blockbench-compat" }));
    build.onLoad({ filter: nativeImports, namespace: "blockbench-compat" }, ({ path }) => {
      const id = path.replace(/^node:/, "");
      const name = JSON.stringify(id === "fs/promises" ? "fs" : id);
      return {
        contents: "const native = typeof requireNativeModule !== 'undefined' ? requireNativeModule(" + name + ") : require(" + name + "); module.exports = native" + (id === "fs/promises" ? ".promises" : "") + ";",
        loader: "js",
      };
    });
  },
};
