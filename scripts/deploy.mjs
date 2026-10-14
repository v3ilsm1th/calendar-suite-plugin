// scripts/deploy.mjs – copies the built plugin into the vault
//
// Layout produced in the vault:
//   .obsidian/plugins/calendar-suite/manifest.json
//   .obsidian/plugins/calendar-suite/main.js
//   .obsidian/plugins/calendar-suite/styles.css
import { cpSync, existsSync, mkdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vault = "/home/d4cs/Zentraler Vault";
const target = join(vault, ".obsidian", "plugins", "calendar-suite");

if (!existsSync(vault)) {
    console.error(`Vault not found: ${vault}`);
    process.exit(1);
}

mkdirSync(target, { recursive: true });

const files = [
    [join(root, "main.js"), join(target, "main.js")],
    [join(root, "manifest.json"), join(target, "manifest.json")],
    [join(root, "src", "styles.css"), join(target, "styles.css")]
];

for (const [from, to] of files) {
    if (!existsSync(from)) {
        console.error(`Missing build artefact: ${from}`);
        process.exit(1);
    }
    cpSync(from, to);
    console.log(`deployed ${to.replace(vault + "/", "")} (${statSync(to).size} bytes)`);
}

console.log(`\nCalendar Suite installed in ${target.replace(vault + "/", "")}`);
