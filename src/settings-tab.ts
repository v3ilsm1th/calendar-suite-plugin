/**
 * settings-tab.ts
 *
 * Settings UI. Everything is English, split into sections, and every path or
 * tag that could be misconfigured gets a visible status line so a wrong value
 * never silently breaks the plugin.
 */

import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { collectTags } from "./data";
import { installDefaultTemplates } from "./note-utils";
import {
    CalendarSettings,
    ensureMdExtension,
    eventTagSet,
    folderOf,
    normaliseTag,
    todoTagSet
} from "./settings";

export interface SettingsHost {
    readonly app: App;
    settings: CalendarSettings;
    saveSettings(): Promise<void>;
    /** Asks the data index to rebuild after a detection setting changed. */
    refreshData(): void;
    dataviewAvailable(): boolean;
}

/**
 * One-click adaptation to this vault's existing conventions
 * (`#termin` / `#aufgabe`, `datum`, `zeit`, `titel`, TaskNotes `due` /
 * `scheduled`). Offered explicitly rather than assumed, so the shipped
 * defaults stay exactly as documented.
 */
const VAULT_PRESET: Partial<CalendarSettings> = {
    eventTagAliases: "termin",
    todoTagAliases: "aufgabe, task",
    dateProp: "datum",
    datePropAliases: "due, scheduled, sitzungsdatum",
    timeProp: "zeit",
    titleProp: "titel",
    completedProp: "status",
    journalFolder: "99_Journal/Tage",
    journalTemplate: "98_Vorlagen/Tagesnotiz.md",
    todoFolder: "99_Journal/Todos",
    firstDayOfWeek: 1,
    inlineTasks: true,
    inlineExcludeTags: "checklist"
};

type TextKey =
    | "eventTag" | "eventTagAliases" | "todoTag" | "todoTagAliases"
    | "dateProp" | "datePropAliases" | "startProp" | "endProp"
    | "timeProp" | "titleProp" | "completedProp" | "inlineExcludeTags"
    | "journalTemplate" | "eventTemplate" | "todoTemplate"
    | "journalFolder" | "eventFolder" | "todoFolder";

type BoolKey = "showCompleted" | "inlineTasks" | "inlineRequireTodoTag" | "compactMode" | "showWeekNumbers" | "syncDashboard";

export class CalendarSuiteSettingsTab extends PluginSettingTab {
    private readonly host: SettingsHost;
    private saveTimer: number | null = null;
    private body: HTMLElement | null = null;

    constructor(app: App, plugin: Plugin, host: SettingsHost) {
        super(app, plugin);
        this.host = host;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        this.body = containerEl;

        this.section("Quick setup");
        this.note(
            "Calendar Suite ships with neutral defaults (event tag “event”, todo tag “todo”, " +
            "date property “date”). If you want it to read the notes you already have, use the preset below."
        );
        this.buttonSetting(
            "Use this vault’s conventions",
            "Fills the detection settings with the names already used here: #termin / #aufgabe, " +
            "date “datum”, time “zeit”, title “titel”, TaskNotes dates (due, scheduled, sitzungsdatum) " +
            "and the existing journal folder.",
            "Apply preset",
            () => {
                const ok = window.confirm(
                    "Apply the vault preset?\n\nThis overwrites the detection settings " +
                    "(tags, property names, journal folder and template) with this vault's current conventions."
                );
                if (!ok) return;
                Object.assign(this.host.settings, VAULT_PRESET);
                this.commit(true);
                new Notice("Calendar Suite: vault preset applied.");
            }
        );
        this.buttonSetting(
            "Create default templates",
            "Writes the event, todo and journal templates to the configured paths. " +
            "Existing files are never overwritten.",
            "Create templates",
            async () => {
                const result = await installDefaultTemplates(this.host.app, this.host.settings);
                const parts: string[] = [];
                if (result.created.length) parts.push(`created ${result.created.length}`);
                if (result.skipped.length) parts.push(`${result.skipped.length} already existed`);
                if (result.failed.length) parts.push(`${result.failed.length} failed`);
                new Notice(`Calendar Suite templates: ${parts.join(", ")}.`);
                this.commit(true);
            }
        );

        this.section("Detection");
        this.text("eventTag", "Event tag", "Primary tag that marks a note as an event, without the #. Default: event.");
        this.text("eventTagAliases", "Event tag aliases",
            "Additional tags that also count as events, comma separated. Example: termin, sitzung.");
        this.text("todoTag", "Todo tag", "Primary tag that marks a note as a todo, without the #. Default: todo.");
        this.text("todoTagAliases", "Todo tag aliases",
            "Additional tags that also count as todos, comma separated. Example: aufgabe, task.");

        this.text("dateProp", "Date property", "Frontmatter property holding the date. Default: date.");
        this.text("datePropAliases", "Additional date properties",
            "Comma separated fallbacks used when the main date property is empty. Example: due, scheduled.");
        this.text("startProp", "Start time property", "Frontmatter property holding the start time. Default: start.");
        this.text("endProp", "End time property", "Frontmatter property holding the end time. Default: end.");
        this.text("timeProp", "Single time property",
            "Optional property holding a whole time range such as 18:00-20:00, used when start and end are empty.");
        this.text("titleProp", "Title property",
            "Frontmatter property used as the display title. Falls back to the file name when empty.");
        this.text("completedProp", "Completed property",
            "Property that marks a note-level todo as completed. Default: done.");
        this.toggle("showCompleted", "Show completed todos",
            "Include todos that are already marked as completed.");
        this.note(
            "Inline tasks are read too: `- [ ] … 📅 2026-10-20` counts as a todo on that date. " +
            "This is independent of the todo tag."
        );
        this.toggle("inlineTasks", "Read inline markdown tasks",
            "Pick up dated checklist items from note bodies, not just tagged notes.");
        this.text("inlineExcludeTags", "Exclude inline tasks tagged",
            "Comma separated tags that disqualify an inline task. Default: checklist.");
        this.toggle("inlineRequireTodoTag", "Require the todo tag on inline tasks",
            "Off by default: any dated checklist item counts. Turn on to only accept tasks tagged with the todo tag.");

        this.section("Templates and folders");
        this.text("journalTemplate", "Journal template path", "Template used when creating a journal entry.");
        this.text("eventTemplate", "Event template path", "Template used when creating an event.");
        this.text("todoTemplate", "Todo template path", "Template used when creating a todo.");
        this.text("journalFolder", "Journal folder", "Folder holding daily notes, one file per date.");
        this.text("eventFolder", "Event folder", "Folder where new events are created. Created if missing.");
        this.text("todoFolder", "Todo folder", "Folder where new todos are created. Created if missing.");

        this.section("Display");
        new Setting(this.bodyElement())
            .setName("First day of week")
            .setDesc("Whether the month grid starts on Sunday or Monday.")
            .addDropdown(dropdown => {
                dropdown
                    .addOptions({ "1": "Monday", "0": "Sunday" })
                    .setValue(String(this.host.settings.firstDayOfWeek))
                    .onChange(value => {
                        this.host.settings.firstDayOfWeek = value === "0" ? 0 : 1;
                        this.commit(true);
                    });
            });
        this.toggle("compactMode", "Compact mode", "Tighter paddings and a shorter time grid.");
        this.toggle("showWeekNumbers", "Show week numbers", "Adds an ISO week number column to the month grid.");
        this.toggle("syncDashboard", "Sync with the dashboard calendar",
            "Send the selected date to the existing calendar view in 00_Dashboard/Views, so its day detail, " +
            "timeline and habits follow along.");

        this.section("Status");
        this.renderStatus();
    }

    hide(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
            void this.host.saveSettings();
        }
        super.hide();
    }

    // -- building blocks ----------------------------------------------------

    private bodyElement(): HTMLElement {
        return this.body ?? this.containerEl;
    }

    private section(title: string): void {
        this.bodyElement().createEl("h3", { text: title, cls: "cs-setting-section" });
    }

    private note(text: string): void {
        this.bodyElement().createEl("div", { text, cls: "cs-note" });
    }

    private text(key: TextKey, name: string, desc: string): void {
        new Setting(this.bodyElement())
            .setName(name)
            .setDesc(desc)
            .addText(text => {
                text
                    .setPlaceholder("")
                    .setValue(String(this.host.settings[key] ?? ""))
                    .onChange(value => {
                        this.host.settings[key] = value;
                        this.queueSave();
                    });
            });
    }

    private toggle(key: BoolKey, name: string, desc: string): void {
        new Setting(this.bodyElement())
            .setName(name)
            .setDesc(desc)
            .addToggle(toggle => {
                toggle
                    .setValue(Boolean(this.host.settings[key]))
                    .onChange(value => {
                        (this.host.settings[key] as boolean) = value;
                        this.commit(true);
                    });
            });
    }

    private buttonSetting(name: string, desc: string, label: string, action: () => void | Promise<void>): void {
        new Setting(this.bodyElement())
            .setName(name)
            .setDesc(desc)
            .addButton(button => {
                button
                    .setButtonText(label)
                    .setCta()
                    .onClick(async () => {
                        button.setDisabled(true);
                        try {
                            await action();
                        } catch (err) {
                            console.error("Calendar Suite: settings action failed", err);
                            new Notice(`Calendar Suite: ${err instanceof Error ? err.message : String(err)}`);
                        } finally {
                            button.setDisabled(false);
                            this.renderStatus();
                        }
                    });
            });
    }

    // -- status -------------------------------------------------------------

    private renderStatus(): void {
        const body = this.bodyElement();
        body.querySelectorAll(".cs-note--status").forEach(node => node.remove());

        const add = (kind: "ok" | "warn" | "info", text: string): void => {
            body.createEl("div", { text, cls: `cs-note cs-note--status cs-note--${kind}` });
        };

        const settings = this.host.settings;

        // --- template paths -------------------------------------------------
        for (const [label, path] of [
            ["Event template", settings.eventTemplate],
            ["Todo template", settings.todoTemplate],
            ["Journal template", settings.journalTemplate]
        ] as Array<[string, string]>) {
            const cleaned = ensureMdExtension(path.trim());
            if (!cleaned) {
                add("warn", `${label}: no path set. A built-in fallback is used, so quick create still works.`);
                continue;
            }
            const file = this.host.app.vault.getAbstractFileByPath(cleaned);
            if (file instanceof TFile) add("ok", `${label}: found at ${cleaned}.`);
            else add("warn", `${label}: “${cleaned}” does not exist. Use “Create default templates” or fix the path.`);
        }

        // --- folders --------------------------------------------------------
        for (const [label, path] of [
            ["Journal folder", settings.journalFolder],
            ["Event folder", settings.eventFolder],
            ["Todo folder", settings.todoFolder]
        ] as Array<[string, string]>) {
            const cleaned = path.trim().replace(/^\/+|\/+$/g, "");
            if (!cleaned) {
                add("info", `${label}: vault root. New notes are created without a folder.`);
                continue;
            }
            const existing = this.host.app.vault.getAbstractFileByPath(cleaned);
            if (existing && existing instanceof TFile === false) {
                add("ok", `${label}: exists.`);
            } else {
                add("info", `${label}: “${cleaned}” does not exist yet and will be created on first use.`);
            }
        }

        // --- tags -----------------------------------------------------------
        const eventTags = eventTagSet(settings);
        const todoTags = todoTagSet(settings);

        if (eventTags.size === 0) {
            add("warn", "No event tag configured – no events will ever be shown.");
        } else if (this.countNotesWithTag(eventTags) === 0) {
            add("warn",
                `No note carries any of the configured event tags (${[...eventTags].join(", ")}). ` +
                "The calendar will show no events until the tags match your notes.");
        }

        if (todoTags.size === 0 && !settings.inlineTasks) {
            add("warn", "No todo tag configured and inline tasks are disabled – no todos will ever be shown.");
        } else if (todoTags.size > 0 && this.countNotesWithTag(todoTags) === 0 && !settings.inlineTasks) {
            add("warn",
                `No note carries any of the configured todo tags (${[...todoTags].join(", ")}), ` +
                "and inline tasks are disabled.");
        }

        // --- Dataview -------------------------------------------------------
        if (this.host.dataviewAvailable()) {
            add("ok", "Dataview is enabled – the views in 00_Dashboard/Views/ are available.");
        } else {
            add("info",
                "Dataview is not enabled. The DataviewJS launcher files will not run; " +
                "insert views with the Command Palette commands or call window.CalendarSuite from your own script. " +
                "All three views work without Dataview.");
        }
    }

    /** Cheap frontmatter-only tag count – no file content is read. */
    private countNotesWithTag(wanted: Set<string>): number {
        let count = 0;
        for (const file of this.host.app.vault.getMarkdownFiles()) {
            const tags = collectTags(this.host.app.metadataCache.getFileCache(file));
            for (const tag of wanted) {
                if (tags.has(normaliseTag(tag))) {
                    count += 1;
                    break;
                }
            }
        }
        return count;
    }

    // -- saving -------------------------------------------------------------

    private queueSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = null;
            void this.host.saveSettings();
        }, 300);
    }

    private commit(rebuildIndex: boolean): void {
        this.queueSave();
        if (rebuildIndex) this.host.refreshData();
        window.setTimeout(() => this.renderStatus(), 0);
    }
}

export { folderOf };
