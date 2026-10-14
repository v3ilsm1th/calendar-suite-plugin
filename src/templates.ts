/**
 * templates.ts
 *
 * Reads the configured template for an entry and pre-fills it for the
 * selected date.
 *
 * The fill logic is deliberately line-based instead of YAML round-tripping:
 * templates in this vault contain Templater expressions such as
 * `<% await tp.system.suggester(...) %>`, which a strict YAML parser can
 * reject. Line surgery can never throw and never rewrites the rest of the
 * file, so existing template behaviour is preserved.
 */

import { App, TFile } from "obsidian";
import { CalendarSettings, ensureMdExtension, folderOf } from "./settings";

export type EntryKindName = "event" | "todo" | "journal";

export interface TemplateContext {
    /** `YYYY-MM-DD` of the selected date. */
    date: string;
    /** File basename the note will get. */
    title: string;
    /** Primary tag to guarantee is present (not used for journal notes). */
    tag?: string;
    settings: CalendarSettings;
}

const FRONTMATTER_OPEN = /^---\s*$/;

/** Built-in fallbacks, used when no template file is configured or found. */
export function defaultTemplate(kind: EntryKindName, ctx: TemplateContext): string {
    const { settings, date, title } = ctx;
    const heading = kind === "journal" ? "Daily note" : title;

    if (kind === "event") {
        return [
            "---",
            `date: ${date}`,
            `${settings.startProp}: `,
            `${settings.endProp}: `,
            "tags:",
            `  - ${settings.eventTag || "event"}`,
            "---",
            "",
            `# ${heading}`,
            "",
            "## Details",
            ""
        ].join("\n");
    }

    if (kind === "todo") {
        return [
            "---",
            `date: ${date}`,
            `${settings.completedProp || "done"}: false`,
            "tags:",
            `  - ${settings.todoTag || "todo"}`,
            "---",
            "",
            `# ${heading}`,
            "",
            "## Notes",
            ""
        ].join("\n");
    }

    return [
        "---",
        `date: ${date}`,
        "type: journal",
        "---",
        "",
        `# ${heading}`,
        ""
    ].join("\n");
}

/** Resolves the configured template path, or `null` when it is unavailable. */
export async function readTemplate(app: App, path: string): Promise<string | null> {
    const cleaned = ensureMdExtension(path.trim());
    if (!cleaned) return null;
    const file = app.vault.getAbstractFileByPath(cleaned);
    if (!(file instanceof TFile)) return null;
    try {
        return await app.vault.read(file);
    } catch (err) {
        console.error("Calendar Suite: could not read template", cleaned, err);
        return null;
    }
}

/**
 * Applies core-Templates style tokens and guarantees that the date property
 * and the primary tag end up set, so the new note is always picked up by the
 * calendar views again.
 */
export function applyTemplate(content: string, ctx: TemplateContext): string {
    const { date, title, settings } = ctx;

    let text = content
        .replace(/\{\{\s*date\s*\}\}/g, date)
        .replace(/\{\{\s*time\s*\}\}/g, new Date().toTimeString().slice(0, 5))
        .replace(/\{\{\s*title\s*\}\}/g, title);

    const lines = text.split("\n");
    const hasFrontmatter = lines.length > 1 && FRONTMATTER_OPEN.test(lines[0]);

    if (!hasFrontmatter) {
        // No frontmatter in the template – add a minimal one on top.
        const head = [`---`, `date: ${date}`];
        if (ctx.tag) head.push("tags:", `  - ${ctx.tag}`);
        head.push("---", "");
        return [...head, ...lines].join("\n");
    }

    let closeIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (FRONTMATTER_OPEN.test(lines[i])) {
            closeIndex = i;
            break;
        }
    }
    if (closeIndex === -1) {
        // Unclosed fence: treat the whole file as frontmatter-free content.
        const head = [`---`, `date: ${date}`];
        if (ctx.tag) head.push("tags:", `  - ${ctx.tag}`);
        head.push("---", "");
        return [...head, ...lines].join("\n");
    }

    const body = lines.slice(0, closeIndex + 1);
    const rest = lines.slice(closeIndex + 1);

    fillDate(body, settings.dateProp, date);
    if (ctx.tag) fillTag(body, ctx.tag);

    return [...body, ...rest].join("\n");
}

const DATE_TOKEN_LIKE = /^(?:|null|~|\d{4}-\d{2}-\d{2}.*|<%.*date.*%>|\{\{.*date.*\}\})$/i;

function fillDate(lines: string[], dateProp: string, date: string): void {
    const prop = escapeRegExp(dateProp.trim() || "date");
    const pattern = new RegExp(`^(\\s*)${prop}\\s*:(.*)$`, "i");

    for (let i = 1; i < lines.length - 1; i++) {
        const match = lines[i].match(pattern);
        if (!match) continue;
        if (DATE_TOKEN_LIKE.test(match[2].trim())) {
            lines[i] = `${match[1]}${dateProp}: ${date}`;
        }
        return; // property exists – never touch a non-date value
    }

    lines.splice(1, 0, `${dateProp}: ${date}`);
}

function fillTag(lines: string[], tag: string): void {
    const wanted = tag.trim().replace(/^#/, "");
    if (!wanted) return;

    const tagsIndex = lines.findIndex((line, i) => i > 0 && /^\s*tags\s*:/.test(line));
    if (tagsIndex === -1) {
        lines.splice(1, 0, "tags:", `  - ${wanted}`);
        return;
    }

    const match = lines[tagsIndex].match(/^(\s*)tags\s*:\s*(.*)$/);
    if (!match) return;
    const indent = match[1];
    const inline = match[2].trim();

    if (inline === "") {
        const items = collectListItems(lines, tagsIndex);
        if (items.some(item => item.replace(/^#/, "").toLowerCase() === wanted.toLowerCase())) return;
        if (items.length > 0) {
            lines.splice(tagsIndex + 1, 0, `${indent}  - ${wanted}`);
        } else {
            lines[tagsIndex] = `${indent}tags:`;
            lines.splice(tagsIndex + 1, 0, `${indent}  - ${wanted}`);
        }
        return;
    }

    const existing = inline
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(item => item.trim().replace(/^#/, "").replace(/^["']|["']$/g, ""))
        .filter(Boolean);

    if (existing.some(item => item.toLowerCase() === wanted.toLowerCase())) return;

    if (inline.startsWith("[") && inline.endsWith("]")) {
        lines[tagsIndex] = `${indent}tags: [${existing.join(", ")}, ${wanted}]`;
    } else {
        lines[tagsIndex] = `${indent}tags:`;
        lines.splice(tagsIndex + 1, 0, `${indent}  - ${existing[0]}`, `${indent}  - ${wanted}`);
    }
}

function collectListItems(lines: string[], startIndex: number): string[] {
    const items: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i++) {
        const item = lines[i].match(/^\s*-\s+(.*)$/);
        if (!item) break;
        items.push(item[1].trim().replace(/^#/, "").replace(/^["']|["']$/g, ""));
    }
    return items;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Folder that holds the shipped default templates. */
export function defaultTemplateFolder(settings: CalendarSettings): string {
    return folderOf(settings.eventTemplate) || folderOf(settings.journalTemplate) || "98_Vorlagen";
}

/**
 * On-disk content for the three shipped templates.
 *
 * The frontmatter mirrors the documented defaults (`date` / `start` / `end` /
 * `done` / `type: journal`) but every property name comes from settings, so a
 * template installed into a differently configured vault still round-trips.
 * `{{date}}` is filled by {@link applyTemplate} at creation time.
 */
export function defaultTemplateFile(kind: EntryKindName, settings: CalendarSettings): string {
    const date = "{{date}}";
    const title = "{{title}}";

    if (kind === "event") {
        return [
            "---",
            `${settings.dateProp}: ${date}`,
            `${settings.startProp}: `,
            `${settings.endProp}: `,
            "tags:",
            `  - ${settings.eventTag}`,
            "---",
            "",
            `# ${title}`,
            "",
            "## Details",
            "",
            "## Link / Location",
            "",
            "## Notes",
            ""
        ].join("\n");
    }

    if (kind === "todo") {
        return [
            "---",
            `${settings.dateProp}: ${date}`,
            `${settings.completedProp}: false`,
            "tags:",
            `  - ${settings.todoTag}`,
            "---",
            "",
            `# ${title}`,
            "",
            "## Details",
            "",
            "## Notes",
            ""
        ].join("\n");
    }

    return [
        "---",
        `${settings.dateProp}: ${date}`,
        "type: journal",
        "---",
        "",
        `# ${title}`,
        "",
        "## Focus",
        "",
        "## Notes",
        ""
    ].join("\n");
}
