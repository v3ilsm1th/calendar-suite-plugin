/**
 * api.ts
 *
 * The public JavaScript surface of the plugin, published as
 * `window.CalendarSuite`.
 *
 * This is what the small launcher files under `00_Dashboard/Views/` call, so
 * `await dv.view("Views/calendar-suite-month", {})` works exactly like the
 * vault's existing DataviewJS views. The same entry point is used by any
 * other script, which is why every failure path prints a clear English
 * message instead of throwing an opaque stack trace.
 */

import { App, Notice } from "obsidian";
import { DataIndex } from "./data";
import { createEnv, ViewEnv } from "./env";
import { mountDashboard } from "./dashboard-view";
import { mountMonthCalendar } from "./calendar-view";
import { mountDayOverview } from "./day-overview";
import { mountTimeline } from "./timeline-view";
import { isValidIsoDay, todayIso } from "./date-utils";
import { CalendarSettings } from "./settings";
import { DateStore } from "./state";
import { clear, el } from "./ui";
import { RenderOptions, ViewKind } from "./types";

export const API_VERSION = "1.0.0";

export interface ApiHost {
    readonly app: App;
    readonly store: DateStore;
    readonly index: DataIndex;
    settings(): CalendarSettings;
}

export interface CalendarSuiteApi {
    readonly version: string;
    /**
     * Renders one view into `container`. Resolves once the view is mounted.
     * Errors are drawn into the container as readable English text.
     */
    render(container: HTMLElement, kind: ViewKind | string, options?: RenderOptions): Promise<void>;
    /** Builds the environment a custom script would need to mount a view itself. */
    env(sourcePath?: string): ViewEnv;
    getSelectedDate(): string;
    setSelectedDate(iso: string): boolean;
    goToday(): void;
    createEvent(iso?: string): Promise<string | null>;
    createTodo(iso?: string): Promise<string | null>;
    createJournal(iso?: string): Promise<string | null>;
    refresh(): void;
    /** Whether the Dataview community plugin is currently enabled. */
    dataviewAvailable(): boolean;
}

const KNOWN_KINDS: ViewKind[] = ["month", "day", "timeline", "dashboard"];

const VIEW_UNAVAILABLE =
    "Calendar Suite: the plugin is not loaded. Enable it in Settings -> Community plugins, " +
    "then reload the note.";

export function createApi(host: ApiHost): CalendarSuiteApi {
    const buildEnv = (sourcePath: string): ViewEnv =>
        createEnv({
            app: host.app,
            getSettings: () => host.settings(),
            store: host.store,
            index: host.index,
            sourcePath
        });

    const api: CalendarSuiteApi = {
        version: API_VERSION,

        async render(container, kind, options = {}) {
            if (!container) return;

            if (KNOWN_KINDS.indexOf(kind as ViewKind) === -1) {
                const message =
                    `Calendar Suite: unknown view "${String(kind)}". ` +
                    `Use one of: ${KNOWN_KINDS.join(", ")}.`;
                showFatal(container, message);
                return;
            }

            try {
                await host.index.ensureLoaded();
            } catch (err) {
                console.error("Calendar Suite: index load failed", err);
            }

            if (!container.isConnected) return;

            if (options.initialDate !== undefined) {
                if (isValidIsoDay(options.initialDate)) {
                    host.store.setDate(options.initialDate);
                } else {
                    console.warn(
                        `Calendar Suite: ignoring initialDate "${String(options.initialDate)}" – ` +
                        "expected YYYY-MM-DD."
                    );
                }
            }

            const env = buildEnv(options.sourcePath ?? "");
            const view = kind as ViewKind;
            try {
                if (view === "month") mountMonthCalendar(container, env);
                else if (view === "day") mountDayOverview(container, env);
                else if (view === "timeline") mountTimeline(container, env);
                else mountDashboard(container, env);
            } catch (err) {
                const message = `Calendar Suite: could not render the "${view}" view. ` +
                    (err instanceof Error ? err.message : String(err));
                console.error(message, err);
                showFatal(container, message);
            }
        },

        env: buildEnv,

        getSelectedDate: () => host.store.getDate(),

        setSelectedDate(iso) {
            if (!isValidIsoDay(iso)) {
                new Notice(`Calendar Suite: "${String(iso)}" is not a valid date (expected YYYY-MM-DD).`);
                return false;
            }
            return host.store.setDate(iso);
        },

        goToday: () => {
            host.store.setDate(todayIso());
        },

        createEvent: iso => buildEnv("").createFor("event", iso ?? host.store.getDate()),
        createTodo: iso => buildEnv("").createFor("todo", iso ?? host.store.getDate()),
        createJournal: iso => buildEnv("").createFor("journal", iso ?? host.store.getDate()),

        refresh: () => host.index.invalidate(),

        dataviewAvailable: () => dataviewEnabled(host.app)
    };

    return api;
}

/** Publishes (or withdraws) the global entry point used by DataviewJS. */
export function installApi(api: CalendarSuiteApi): void {
    (window as unknown as Record<string, unknown>)["CalendarSuite"] = api;
}

export function uninstallApi(): void {
    delete (window as unknown as Record<string, unknown>)["CalendarSuite"];
}

/** Message used by the DataviewJS launcher files when the plugin is off. */
export const PLUGIN_NOT_LOADED_MESSAGE = VIEW_UNAVAILABLE;

function showFatal(container: HTMLElement, message: string): void {
    clear(container);
    container.appendChild(el("div", "cs-error", message));
}

function dataviewEnabled(app: App): boolean {
    const plugins = (app as unknown as {
        plugins?: { enabledPlugins?: Set<string>; plugins?: Record<string, unknown> };
    }).plugins;
    if (!plugins) return false;
    if (plugins.enabledPlugins instanceof Set) return plugins.enabledPlugins.has("dataview");
    return Boolean(plugins.plugins && plugins.plugins["dataview"]);
}
