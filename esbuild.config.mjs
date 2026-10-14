// esbuild.config.mjs – bundles src/main.ts into the plugin's main.js
import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

/**
 * Everything Obsidian (or the host app) already provides must stay external,
 * otherwise the bundle would ship a second copy of the editor and break at
 * runtime.
 */
const external = [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "node:fs",
    "node:path",
    "node:os",
    "node:crypto",
    "node:child_process",
    "node:events",
    "node:util",
    "node:stream",
    "node:buffer",
    "node:url",
    "node:process",
    "fs",
    "path",
    "os",
    "crypto",
    "child_process",
    "events",
    "util",
    "stream",
    "buffer",
    "url",
    "process",
    "assert",
    "zlib",
    "http",
    "https",
    "net",
    "tls",
    "dns"
];

const banner = `/*
 * Calendar Suite – Obsidian plugin
 * Version 1.0.0 · author veilsmith
 * Month Calendar · Day Overview · Day Timeline, sharing one selected date.
 */`;

const context = await esbuild.context({
    banner: { js: banner },
    entryPoints: ["src/main.ts"],
    bundle: true,
    external,
    format: "cjs",
    target: "es2020",
    logLevel: "info",
    treeShaking: true,
    minify: prod,
    sourcemap: prod ? false : "inline",
    outfile: "main.js",
    legalComments: "none"
});

if (prod) {
    await context.rebuild();
    await context.dispose();
} else {
    await context.watch();
    console.log("Calendar Suite: watching src/ …");
}
