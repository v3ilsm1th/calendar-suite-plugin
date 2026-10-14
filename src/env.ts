/**
 * env.ts
 *
 * The shared environment every view renders against: settings access, the
 * selected-date store, the data index and the quick-create actions.
 *
 * Views only ever talk to `ViewEnv`, so they stay free of vault writes and can
 * be mounted in a code block, a DataviewJS view or through the JS API without
 * any changes.
 */

import { App, Notice, TFile } from "obsidian";
import { DataIndex } from "./data";
import { createEntry, openEntry, journalExists } from "./note-utils";
import { CalendarSettings } from "./settings";
import { DateStore } from "./state";
import { EntryKindName } from "./templates";

export type QuickCreateKind = Exclude<EntryKindName, never>;

export interface ViewEnv {
    readonly app: App;
    readonly store: DateStore;
    readonly index: DataIndex;
    readonly sourcePath: string;
    settings(): CalendarSettings;
    selectedDate(): string;
    /** Creates (or reuses) a note for `iso`, opens it and refreshes the index. */
    createFor(kind: EntryKindName, iso: string): Promise<string | null>;
    /** Opens the journal note for `iso`, creating it when missing. */
    openJournal(iso: string): Promise<string | null>;
    /** Whether the journal note for `iso` already exists. */
    hasJournal(iso: string): boolean;
    /** Opens an entry, jumping to the line for inline tasks. */
    open(path: string, line: number | null): Promise<void>;
    /** Moves the shared selected date. */
    goto(iso: string): void;
    /** Selects today. */
    goToday(): void;
}

export interface EnvParts {
    app: App;
    getSettings: () => CalendarSettings;
    store: DateStore;
    index: DataIndex;
    sourcePath: string;
}

function baseNameFor(kind: EntryKindName, iso: string): string {
    if (kind === "journal") return iso;
    if (kind === "event") return `${iso} Event`;
    return `${iso} Todo`;
}

export function createEnv(parts: EnvParts): ViewEnv {
    const { app, getSettings, store, index, sourcePath } = parts;

    const createFor = async (kind: EntryKindName, iso: string): Promise<string | null> => {
        try {
            const result = await createEntry(app, getSettings(), {
                kind,
                date: iso,
                baseName: baseNameFor(kind, iso)
            });
            await openFile(app, result.file);
            index.invalidate();
            if (result.created && kind !== "journal") {
                new Notice(`Calendar Suite: created ${result.file.path}`);
            }
            return result.file.path;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            new Notice(`Calendar Suite: ${message}`);
            console.error("Calendar Suite: quick create failed", err);
            return null;
        }
    };

    return {
        app,
        store,
        index,
        sourcePath,
        settings: getSettings,
        selectedDate: () => store.getDate(),
        createFor,
        openJournal: iso => createFor("journal", iso),
        hasJournal: iso => journalExists(app, getSettings(), iso),
        open: (path, line) => openEntry(app, path, line, sourcePath),
        goto: iso => {
            store.setDate(iso);
        },
        goToday: () => {
            const now = new Date();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
            store.setDate(today);
        }
    };
}

async function openFile(app: App, file: TFile): Promise<void> {
    try {
        const leaf = app.workspace.getLeaf(false);
        await leaf.openFile(file, { active: true });
    } catch (err) {
        console.error("Calendar Suite: could not open new note", file.path, err);
        void app.workspace.openLinkText(file.path, "", false);
    }
}
