// Test runner: bundles tests/suite.ts (with the `obsidian` module aliased to a
// stub) and executes it in Node. Usage: npm test
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const root = dirname(new URL(import.meta.url).pathname);
const outDir = await mkdtemp(join(process.env.RUNTIME_DIR || tmpdir(), "cs-tests-"));
const outFile = join(outDir, "suite.mjs");

try {
    await build({
        entryPoints: [join(root, "suite.ts")],
        bundle: true,
        format: "esm",
        platform: "node",
        target: "node18",
        outfile: outFile,
        alias: { obsidian: join(root, "obsidian-stub.mjs") },
        logLevel: "warning"
    });

    // Run in a child process so the suite's process.exitCode is honored.
    const child = spawn(process.execPath, [outFile], { stdio: "inherit" });
    child.on("exit", (code) => {
        rm(outDir, { recursive: true, force: true });
        process.exitCode = code ?? 1;
    });
} catch (error) {
    await rm(outDir, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
}
