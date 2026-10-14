/**
 * note-utils.ts
 *
 * Every vault write and navigation helper lives here. All writes go through
 * Obsidian's public APIs (`vault.create`, `vault.createFolder`,
 * `vault.process`, `workspace.openFile`), and note insertion always happens in
 * the active editor so unsaved buffer content is never clobbered by a
 * `vault.modify`.
 */

import { App, MarkdownView, Notice, TFile, TFolder } from "obsidian";
import { CalendarSettings, ensureMdExtension, folderOf } from "./settings";
import {
    applyTemplate,
    defaultTemplate,
    defaultTemplateFile,
    EntryKindName,
    readTemplate,
    TemplateContext
} from "./templates";

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** Opens a vault path in the active leaf. Returns whether it succeeded. */
export function openPath(app: App, path: string, sourcePath = ""): boolean {
    const target = ensureMdExtension(path);
    if (!app.vault.getAbstractFileByPath(target)) return false;
    void app.workspace.openLinkText(target, sourcePath, false);
    return true;
}

/** Opens a note, optionally jumping to a 0-based line (used for inline tasks). */
export async function openEntry(app: App, path: string, line: number | null, sourcePath = ""): Promise<void> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
        // The note may have been renamed or moved – fall back to link
        // resolution so a stale path cannot throw.
        openPath(app, path, sourcePath);
        return;
    }
    try {
        if (line !== null && line >= 0) {
            const leaf = app.workspace.getLeaf(false);
            await leaf.openFile(file, { active: true, eState: { line } });
        } else {
            void app.workspace.openLinkText(file.path, sourcePath, false);
        }
    } catch (err) {
        console.error("Calendar Suite: could not open entry", path, err);
        new Notice("Calendar Suite: this note could not be opened.");
    }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/** Creates `folder` (and its parents) when it does not exist yet. */
export async function ensureFolder(app: App, folder: string): Promise<boolean> {
    const cleaned = folder.trim().replace(/^\/+|\/+$/g, "");
    if (!cleaned) return true;

    const existing = app.vault.getAbstractFileByPath(cleaned);
    if (existing instanceof TFolder) return true;
    if (existing) return false;

    const parts = cleaned.split("/");
    let current = "";
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        if (app.vault.getAbstractFileByPath(current)) continue;
        try {
            await app.vault.createFolder(current);
        } catch {
            // Created concurrently or invalid – re-check below.
        }
    }
    return app.vault.getAbstractFileByPath(current) instanceof TFolder;
}

/** Finds a free path such as `folder/2026-10-14 Event 2.md`. */
export function availablePath(app: App, folder: string, baseName: string): string {
    const dir = folder.trim().replace(/^\/+|\/+$/g, "");
    const first = dir ? `${dir}/${baseName}` : baseName;
    if (!app.vault.getAbstractFileByPath(`${first}.md`)) return `${first}.md`;

    for (let n = 2; n < 1000; n++) {
        const candidate = dir ? `${dir}/${baseName} ${n}` : `${baseName} ${n}`;
        if (!app.vault.getAbstractFileByPath(`${candidate}.md`)) return `${candidate}.md`;
    }
    return `${first}-${Date.now()}.md`;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateRequest {
    kind: EntryKindName;
    /** `YYYY-MM-DD` the entry belongs to. */
    date: string;
    /** Base file name, without extension. */
    baseName: string;
}

export interface CreateResult {
    file: TFile;
    created: boolean;
}

function folderFor(settings: CalendarSettings, kind: EntryKindName): string {
    if (kind === "event") return settings.eventFolder;
    if (kind === "todo") return settings.todoFolder;
    return settings.journalFolder;
}

function templateFor(settings: CalendarSettings, kind: EntryKindName): string {
    if (kind === "event") return settings.eventTemplate;
    if (kind === "todo") return settings.todoTemplate;
    return settings.journalTemplate;
}

function primaryTagFor(settings: CalendarSettings, kind: EntryKindName): string | undefined {
    if (kind === "event") return settings.eventTag || undefined;
    if (kind === "todo") return settings.todoTag || undefined;
    return undefined;
}

/**
 * Journal notes are addressed by a fixed path (`folder/YYYY-MM-DD.md`) so the
 * button can tell "new" from "open". Events and todos get a free unique name.
 */
export function journalPath(app: App, settings: CalendarSettings, date: string): string {
    const folder = settings.journalFolder.trim().replace(/^\/+|\/+$/g, "");
    return folder ? `${folder}/${date}.md` : `${date}.md`;
}

export function journalExists(app: App, settings: CalendarSettings, date: string): boolean {
    return app.vault.getAbstractFileByPath(journalPath(app, settings, date)) !== null;
}

/**
 * Creates (or reuses) a note for the given date using its template.
 *
 * When the target already exists it is reused instead of duplicated, which
 * makes the journal button idempotent and keeps quick-create safe to re-run.
 */
export async function createEntry(app: App, settings: CalendarSettings, req: CreateRequest): Promise<CreateResult> {
    const isJournal = req.kind === "journal";
    const folder = folderFor(settings, req.kind);

    if (isJournal) {
        const path = journalPath(app, settings, req.date);
        const existing = app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFile) return { file: existing, created: false };
    }

    if (folder && !(await ensureFolder(app, folder))) {
        throw new Error(`Folder "${folder}" could not be created.`);
    }

    const templatePath = templateFor(settings, req.kind);
    const rawTemplate = await readTemplate(app, templatePath);
    if (!rawTemplate && templatePath.trim()) {
        console.warn(`Calendar Suite: template "${templatePath}" not found – using the built-in fallback.`);
    }

    const ctx: TemplateContext = {
        date: req.date,
        title: req.baseName,
        tag: primaryTagFor(settings, req.kind),
        settings
    };

    const content = rawTemplate !== null
        ? applyTemplate(rawTemplate, ctx)
        : defaultTemplate(req.kind, ctx);

    const path = isJournal
        ? journalPath(app, settings, req.date)
        : availablePath(app, folder, req.baseName);

    let file: TFile;
    try {
        file = await app.vault.create(path, content);
    } catch (err) {
        console.error("Calendar Suite: creation failed", path, err);
        throw new Error(`Could not create "${path}".`);
    }

    // Make sure the views pick the note up even if a custom template skipped
    // the date property or the tag.
    await ensureDetectable(app, settings, file, req.date, ctx.tag);

    return { file, created: true };
}

/**
 * Verifies – after creation – that the note carries the configured date
 * property and primary tag. Uses `fileManager.processFrontMatter`, falling
 * back silently when the YAML contains expressions Obsidian cannot parse.
 */
async function ensureDetectable(
    app: App,
    settings: CalendarSettings,
    file: TFile,
    date: string,
    tag: string | undefined
): Promise<void> {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;

    const needsDate = !fm || resolveDaySimple(fm[settings.dateProp]) !== date;
    const needsTag = Boolean(tag) && !frontmatterHasTag(fm, tag as string);
    if (!needsDate && !needsTag) return;

    try {
        await app.fileManager.processFrontMatter(file, frontmatter => {
            if (needsDate) frontmatter[settings.dateProp] = date;
            if (needsTag && tag) addTagToProperty(frontmatter, tag);
        });
    } catch (err) {
        console.warn("Calendar Suite: could not normalise frontmatter for", file.path, err);
    }
}

function resolveDaySimple(value: unknown): string | null {
    if (typeof value === "string") {
        const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        return match ? match[1] : null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    }
    return null;
}

function frontmatterHasTag(frontmatter: Record<string, unknown> | undefined, tag: string): boolean {
    if (!frontmatter) return false;
    const raw = frontmatter["tags"] ?? frontmatter["tag"];
    const wanted = tag.replace(/^#/, "").toLowerCase();
    const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
    return list.some(item => String(item).replace(/^#/, "").toLowerCase() === wanted);
}

function addTagToProperty(frontmatter: Record<string, unknown>, tag: string): void {
    const wanted = tag.replace(/^#/, "");
    const raw = frontmatter["tags"] ?? frontmatter["tag"];
    if (Array.isArray(raw)) {
        if (!raw.some(item => String(item).replace(/^#/, "").toLowerCase() === wanted.toLowerCase())) {
            raw.push(wanted);
        }
        frontmatter["tags"] = raw;
        return;
    }
    if (typeof raw === "string" && raw.trim()) {
        const parts = raw.split(/[,\s]+/).filter(Boolean);
        if (!parts.some(item => item.replace(/^#/, "").toLowerCase() === wanted.toLowerCase())) {
            parts.push(wanted);
        }
        frontmatter["tags"] = parts;
        return;
    }
    frontmatter["tags"] = [wanted];
}

// ---------------------------------------------------------------------------
// Toggling todos
// ---------------------------------------------------------------------------

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*)(.*)$/;

/**
 * Flips a single inline task between `[ ]` and `[x]`. Resolved by line number
 * first and by text fallback second, so a note that was edited elsewhere still
 * toggles correctly instead of corrupting an unrelated line.
 */
export async function toggleInlineTask(app: App, path: string, line: number | null, completed: boolean): Promise<boolean> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;

    let changed = false;
    try {
        await app.vault.process(file, content => {
            const lines = content.split("\n");
            let index = -1;

            if (line !== null && line >= 0 && line < lines.length && TASK_LINE.test(lines[line])) {
                index = line;
            } else {
                index = -1;
            }

            if (index === -1) return content;

            const match = lines[index].match(TASK_LINE);
            if (!match) return content;

            const before = lines[index];
            const marker = completed ? "[x]" : "[ ]";
            let body = match[2];
            if (!completed) {
                // Strip the completion stamp some themes/plugins append.
                body = body.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/g, "");
            }
            lines[index] = `${match[1].replace(/\[[ xX]\]/, marker)}${body}`;
            changed = lines[index] !== before;
            return lines.join("\n");
        });
    } catch (err) {
        console.error("Calendar Suite: could not toggle task", path, err);
        return false;
    }
    return changed;
}

/** Flips the configured completed property on a note-based todo. */
export async function toggleNoteCompletion(app: App, settings: CalendarSettings, path: string, completed: boolean): Promise<boolean> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    try {
        await app.fileManager.processFrontMatter(file, frontmatter => {
            frontmatter[settings.completedProp] = completed;
        });
        return true;
    } catch (err) {
        console.error("Calendar Suite: could not update completed property", path, err);
        return false;
    }
}

// ---------------------------------------------------------------------------
// Inserting a view block into the active note
// ---------------------------------------------------------------------------

/**
 * Inserts a fenced block at the caret **without deleting anything**: when a
 * range is selected the block is placed after it, keeping the selection and
 * its content intact. Only the live editor buffer is touched, so unsaved
 * changes are preserved.
 */
export function insertBlock(app: App, lang: string): boolean {
    const view = app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
        new Notice("Calendar Suite: open a Markdown note before inserting a view.");
        return false;
    }

    const editor = view.editor;
    const anchor = editor.getCursor("to");
    const preceding = editor.getLine(anchor.line).slice(0, anchor.ch);
    const prefix = preceding.trim().length > 0 ? "\n" : "";
    const block = `${prefix}\`\`\`${lang}\n\`\`\`\n`;

    try {
        editor.replaceRange(block, anchor);
        editor.setCursor({
            line: anchor.line + (prefix ? 3 : 2),
            ch: 0
        });
    } catch (err) {
        console.error("Calendar Suite: insert failed", err);
        new Notice("Calendar Suite: could not insert the view.");
        return false;
    }
    return true;
}

/** Path of the folder that should receive new notes, for error messages. */
export function describeTarget(settings: CalendarSettings, kind: EntryKindName): string {
    const folder = folderFor(settings, kind);
    return folder || "the vault root";
}

export interface InstallResult {
    created: string[];
    skipped: string[];
    failed: string[];
}

/**
 * Writes the three shipped templates into their configured locations.
 *
 * Never overwrites an existing file: templates the user already has are
 * reported as skipped, so this is safe to run repeatedly.
 */
export async function installDefaultTemplates(app: App, settings: CalendarSettings): Promise<InstallResult> {
    const targets: Array<{ path: string; kind: EntryKindName }> = [
        { path: settings.eventTemplate, kind: "event" },
        { path: settings.todoTemplate, kind: "todo" },
        { path: settings.journalTemplate, kind: "journal" }
    ];

    const result: InstallResult = { created: [], skipped: [], failed: [] };

    for (const target of targets) {
        const path = ensureMdExtension(target.path.trim());
        if (!path) continue;

        if (app.vault.getAbstractFileByPath(path)) {
            result.skipped.push(path);
            continue;
        }

        try {
            const folder = folderOf(path);
            if (folder && !(await ensureFolder(app, folder))) {
                throw new Error(`folder "${folder}" could not be created`);
            }
            await app.vault.create(path, defaultTemplateFile(target.kind, settings));
            result.created.push(path);
        } catch (err) {
            console.error("Calendar Suite: could not install template", path, err);
            result.failed.push(path);
        }
    }

    return result;
}

export { folderOf };
