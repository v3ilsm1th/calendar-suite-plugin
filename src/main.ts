/**
 * main.ts
 *
 * Calendar Suite – three independently insertable views (Month Calendar,
 * Day Overview, Day Timeline) that share one selected date.
 *
 * Integration is available on three levels, in order of independence:
 *   1. fenced code blocks  – `calendar-suite-*`, inserted by the commands,
 *                            rendered natively and working without Dataview;
 *   2. DataviewJS launchers – the small files in `00_Dashboard/Views/`, which
 *                            call the public JavaScript API;
 *   3. `window.CalendarSuite` – for any other script.
 */

import { MarkdownRenderChild, Notice, Plugin } from "obsidian";
import { createApi, installApi, uninstallApi } from "./api";
import { DataIndex, watchVault } from "./data";
import { mountDashboard } from "./dashboard-view";
import { mountMonthCalendar } from "./calendar-view";
import { mountDayOverview } from "./day-overview";
import { mountTimeline } from "./timeline-view";
import { createEnv, ViewEnv } from "./env";
import { todayIso } from "./date-utils";
import { installDefaultTemplates, insertBlock } from "./note-utils";
import { CalendarSettings, DEFAULT_SETTINGS } from "./settings";
import { CalendarSuiteSettingsTab } from "./settings-tab";
import { DateStore, destroyAllBindings } from "./state";
import { ViewKind } from "./types";

const BLOCK_LANGUAGES: Record<string, ViewKind> = {
    "calendar-suite-month": "month",
    "calendar-suite-day": "day",
    "calendar-suite-timeline": "timeline",
    "calendar-suite-dashboard": "dashboard"
};

/** Keeps the existing dashboard views (`00_Dashboard/Views`) in step. */
const DASHBOARD_HOOKS = [
    "__ndKalenderZeichnen",
    "__ndZeitleisteZeichnen",
    "__ndGewohnheitenZeichnen"
] as const;

export default class CalendarSuitePlugin extends Plugin {
    /** Narrowed from the base `Plugin.settings` hint – assigned in `onload`. */
    declare settings: CalendarSettings;
    store!: DateStore;
    index!: DataIndex;
    private stopWatching: (() => void) | null = null;

    async onload(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as CalendarSettings;

        this.store = new DateStore(todayIso(), iso => this.bridgeToDashboard(iso));
        this.index = new DataIndex(this.app, () => this.settings);

        this.stopWatching = watchVault(this.app, this.index);
        void this.index.ensureLoaded();

        this.addSettingTab(new CalendarSuiteSettingsTab(this.app, this, this));

        this.registerBlocks();
        this.registerCommands();
        this.registerInsertCommands();

        installApi(createApi({
            app: this.app,
            store: this.store,
            index: this.index,
            settings: () => this.settings
        }));

        if (this.settings.templatesInstalled !== true) void this.installTemplatesOnce();
    }

    onunload(): void {
        uninstallApi();
        destroyAllBindings();
        this.stopWatching?.();
        this.stopWatching = null;
        this.index?.dispose();
        this.store?.clear();
    }

    // -- SettingsHost -------------------------------------------------------

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    refreshData(): void {
        this.index?.invalidate();
    }

    dataviewAvailable(): boolean {
        const plugins = (this.app as unknown as {
            plugins?: { enabledPlugins?: Set<string> };
        }).plugins;
        return Boolean(plugins?.enabledPlugins?.has("dataview"));
    }

    // -- Setup ---------------------------------------------------------------

    /**
     * Writes the three shipped templates on very first launch, into a dedicated
     * subfolder so no existing template is touched. Running again afterwards
     * is a no-op, and the files can always be recreated from settings.
     */
    private async installTemplatesOnce(): Promise<void> {
        this.settings.templatesInstalled = true;

        try {
            const result = await installDefaultTemplates(this.app, this.settings);
            if (result.created.length > 0) {
                const folder = result.created[0].split("/").slice(0, -1).join("/");
                new Notice(`Calendar Suite: created ${result.created.length} template(s) in "${folder}".`);
            }
            await this.saveSettings();
        } catch (err) {
            console.error("Calendar Suite: initial template install failed", err);
        }
    }

    // -- Code blocks ---------------------------------------------------------

    private registerBlocks(): void {
        for (const [language, kind] of Object.entries(BLOCK_LANGUAGES)) {
            this.registerMarkdownCodeBlockProcessor(language, async (_source, el, ctx) => {
                await this.index.ensureLoaded();
                if (!el.isConnected) return;

                const env = this.createBlockEnv(ctx.sourcePath);
                const destroy = mountInto(el, kind, env);

                // Ties the teardown to the rendered section: Obsidian unloads
                // it as soon as the block is removed or re-rendered.
                const child = new BlockChild(el, destroy);
                ctx.addChild(child);
                child.load();
            });
        }
    }

    private createBlockEnv(sourcePath: string): ViewEnv {
        return createEnv({
            app: this.app,
            getSettings: () => this.settings,
            store: this.store,
            index: this.index,
            sourcePath
        });
    }

    // -- Commands ------------------------------------------------------------

    private registerInsertCommands(): void {
        const insertions: Array<[string, string]> = [
            ["calendar-suite-month", "Calendar Suite: Insert Month Calendar"],
            ["calendar-suite-day", "Calendar Suite: Insert Day Overview"],
            ["calendar-suite-timeline", "Calendar Suite: Insert Day Timeline"],
            ["calendar-suite-dashboard", "Calendar Suite: Insert Full Calendar Dashboard"]
        ];

        for (const [language, name] of insertions) {
            this.addCommand({
                id: `insert-${language}`,
                name,
                callback: () => {
                    insertBlock(this.app, language);
                }
            });
        }
    }

    private registerCommands(): void {
        const env = (): ViewEnv =>
            this.createBlockEnv(this.app.workspace.getActiveFile()?.path ?? "");

        this.addCommand({
            id: "create-event",
            name: "Calendar Suite: Create Event for Selected Date",
            callback: () => void env().createFor("event", this.store.getDate())
        });

        this.addCommand({
            id: "create-todo",
            name: "Calendar Suite: Create Todo for Selected Date",
            callback: () => void env().createFor("todo", this.store.getDate())
        });

        this.addCommand({
            id: "create-journal",
            name: "Calendar Suite: Create Journal Entry for Selected Date",
            callback: () => void env().createFor("journal", this.store.getDate())
        });

        this.addCommand({
            id: "go-to-today",
            name: "Calendar Suite: Go to Today",
            callback: () => {
                this.store.setDate(todayIso());
            }
        });

        this.addCommand({
            id: "install-templates",
            name: "Calendar Suite: Install Default Templates",
            callback: async () => {
                const result = await installDefaultTemplates(this.app, this.settings);
                const parts: string[] = [];
                if (result.created.length) parts.push(`created: ${result.created.join(", ")}`);
                if (result.skipped.length) parts.push(`already existed: ${result.skipped.join(", ")}`);
                if (result.failed.length) parts.push(`failed: ${result.failed.join(", ")}`);
                new Notice(`Calendar Suite templates – ${parts.join(" | ") || "nothing to do."}`);
            }
        });

        this.addCommand({
            id: "open-settings",
            name: "Calendar Suite: Open Settings",
            callback: () => {
                const settings = (this.app as unknown as {
                    setting?: { open: () => void; openTabId?: (id: string) => void };
                }).setting;
                if (!settings) return;
                settings.open();
                settings.openTabId?.("calendar-suite");
            }
        });
    }

    // -- Bridge to the existing dashboard ------------------------------------

    /**
     * One-way: moving the date in Calendar Suite also drives the existing
     * DataviewJS views in `00_Dashboard/Views/`. The bridge is fully guarded,
     * so a missing or detached dashboard can never break the plugin.
     */
    private bridgeToDashboard(iso: string): void {
        if (!this.settings.syncDashboard) return;

        const global = window as unknown as Record<string, unknown>;
        try {
            global["__ndAusgewaehlterTag"] = iso;

            const kalender = global["__ndKalender"];
            if (kalender && typeof kalender === "object") {
                const state = kalender as { tag?: string; monat?: string };
                state.tag = iso;
                state.monat = iso.slice(0, 7);
            }

            const zeitleiste = global["__ndZeitleiste"];
            if (zeitleiste && typeof zeitleiste === "object") {
                (zeitleiste as { tag?: string }).tag = iso;
            }

            for (const hook of DASHBOARD_HOOKS) {
                const fn = global[hook];
                if (typeof fn === "function") (fn as () => void)();
            }
        } catch (err) {
            console.warn("Calendar Suite: dashboard sync skipped", err);
        }
    }
}

function mountInto(container: HTMLElement, kind: ViewKind, env: ViewEnv): () => void {
    if (kind === "month") return mountMonthCalendar(container, env);
    if (kind === "day") return mountDayOverview(container, env);
    if (kind === "timeline") return mountTimeline(container, env);
    return mountDashboard(container, env);
}

/** Ties a rendered block to Obsidian's section lifecycle. */
class BlockChild extends MarkdownRenderChild {
    constructor(containerEl: HTMLElement, private readonly teardown: () => void) {
        super(containerEl);
    }

    onunload(): void {
        this.teardown();
    }
}
