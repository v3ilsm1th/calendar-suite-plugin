/**
 * calendar-view.ts
 *
 * Compact month calendar. Owns only the *displayed* month – the selected date
 * lives in the shared `DateStore`, which is what lets the Day Overview and the
 * Day Timeline follow along without the note ever being reloaded.
 */

import {
    buildMonthGrid,
    formatDayHeading,
    formatMonthYear,
    monthKey,
    monthKeyOf,
    todayIso,
    weekdayHeaders
} from "./date-utils";
import { ViewEnv } from "./env";
import { bind, DateStore } from "./state";
import { button, clear, el } from "./ui";

interface DrawState {
    /** `YYYY-MM` currently displayed. */
    viewMonth: string;
    unsubscribeDate: (() => void) | null;
    unsubscribeIndex: (() => void) | null;
}

export function mountMonthCalendar(container: HTMLElement, env: ViewEnv): () => void {
    const state: DrawState = {
        viewMonth: monthKeyOfDate(env.store.getDate()),
        unsubscribeDate: null,
        unsubscribeIndex: null
    };

    const draw = (): void => {
        // The selected date always owns the displayed month, unless the user
        // is only paging through months with the arrows.
        state.viewMonth = monthKeyOfDate(env.store.getDate());
        render();
    };

    const render = (): void => {
        clear(container);
        container.appendChild(buildCard(env, state.viewMonth, month => {
            state.viewMonth = month;
            render();
        }));
    };

    // Register the teardown first: it runs the *previous* binding's cleanup
    // (which empties this container) before the new DOM is built.
    const destroy = (): void => {
        state.unsubscribeDate?.();
        state.unsubscribeIndex?.();
        state.unsubscribeDate = null;
        state.unsubscribeIndex = null;
        clear(container);
    };
    bind(container, destroy);

    render();

    state.unsubscribeDate = env.store.subscribe(() => draw());
    state.unsubscribeIndex = env.index.subscribe(() => render());

    return destroy;
}

function monthKeyOfDate(iso: string): string {
    return monthKey(iso);
}

function buildCard(
    env: ViewEnv,
    viewMonth: string,
    onMonthChange: (month: string) => void
): HTMLElement {
    const settings = env.settings();
    const today = todayString();
    const selected = env.store.getDate();

    const firstDay: 0 | 1 = settings.firstDayOfWeek === 0 ? 0 : 1;
    const [year, month] = viewMonth.split("-").map(Number);
    const grid = buildMonthGrid(year, month, firstDay);

    const card = el("div", `cs-card cs-cal${settings.compactMode ? " is-compact" : ""}`);

    // --- Header: previous / month / next / today --------------------------
    const head = el("div", "cs-cal-head");
    head.appendChild(button("‹", "cs-icon-btn", () => onMonthChange(shiftMonth(viewMonth, -1)), "Previous month"));

    const title = el("div", "cs-cal-title", formatMonthYear(year, month));
    title.setAttribute("aria-live", "polite");
    head.appendChild(title);

    head.appendChild(button("›", "cs-icon-btn", () => onMonthChange(shiftMonth(viewMonth, 1)), "Next month"));
    head.appendChild(button("Today", "cs-btn cs-cal-today", () => {
        env.store.setDate(today);
        onMonthChange(monthKeyOfDate(today));
    }, "Jump to today"));
    card.appendChild(head);

    // --- Weekday header ----------------------------------------------------
    const showWeeks = settings.showWeekNumbers;
    const words = el("div", `cs-cal-weeks${showWeeks ? " has-weeks" : ""}`);
    if (showWeeks) words.appendChild(el("div", "cs-wd cs-wd--week", "Wk"));
    for (const label of weekdayHeaders(firstDay)) {
        words.appendChild(el("div", "cs-wd", label));
    }
    card.appendChild(words);

    // --- Day grid ----------------------------------------------------------
    const raster = el("div", `cs-cal-grid${showWeeks ? " has-weeks" : ""}`);
    raster.setAttribute("role", "grid");

    grid.cells.forEach((cell, index) => {
        if (showWeeks && index % 7 === 0) {
            const weekCell = el("div", "cs-week-num", String(grid.rowWeeks[index / 7]));
            weekCell.title = `Week ${grid.rowWeeks[index / 7]}`;
            raster.appendChild(weekCell);
        }

        const iso = cell.iso;
        const eventCount = env.index.eventCount(iso);
        const todoCount = env.index.openTodoCount(iso);

        const day = el("div", "cs-day");
        day.setAttribute("role", "gridcell");
        day.tabIndex = 0;
        day.dataset.date = iso;

        if (!cell.inMonth) day.classList.add("is-outside");
        if (iso === today) {
            day.classList.add("is-today");
            day.setAttribute("aria-current", "date");
        }
        if (iso === selected) {
            day.classList.add("is-selected");
            day.setAttribute("aria-selected", "true");
        }
        const weekday = new Date(
            Number(iso.slice(0, 4)),
            Number(iso.slice(5, 7)) - 1,
            Number(iso.slice(8, 10))
        ).getDay();
        if (weekday === 0 || weekday === 6) day.classList.add("is-weekend");

        day.appendChild(el("span", "cs-day-num", String(cell.day)));

        const dots = el("span", "cs-day-dots");
        if (eventCount > 0) {
            const dot = el("span", "cs-dot cs-dot--event");
            dot.title = `${eventCount} ${eventCount === 1 ? "event" : "events"}`;
            dots.appendChild(dot);
        }
        if (todoCount > 0) {
            const dot = el("span", "cs-dot cs-dot--todo");
            dot.title = `${todoCount} ${todoCount === 1 ? "todo" : "todos"}`;
            dots.appendChild(dot);
        }
        day.appendChild(dots);

        const summary: string[] = [];
        if (eventCount > 0) summary.push(`${eventCount} ${eventCount === 1 ? "event" : "events"}`);
        if (todoCount > 0) summary.push(`${todoCount} ${todoCount === 1 ? "todo" : "todos"}`);
        day.title = summary.length > 0
            ? `${formatDayHeading(iso)} · ${summary.join(", ")}`
            : formatDayHeading(iso);

        const select = (): void => {
            env.store.setDate(iso);
            // A day from a neighbouring month pulls the calendar along with it.
            if (!cell.inMonth) onMonthChange(monthKeyOfDate(iso));
        };

        day.addEventListener("click", select);
        day.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                select();
            }
        });

        raster.appendChild(day);
    });

    card.appendChild(raster);
    return card;
}

function shiftMonth(viewMonth: string, delta: number): string {
    const [year, month] = viewMonth.split("-").map(Number);
    const target = new Date(year, month - 1 + delta, 1);
    return monthKeyOf(target.getFullYear(), target.getMonth() + 1);
}

function todayString(): string {
    return todayIso();
}

/** Re-exported so other modules can depend on a single store type. */
export type { DateStore };
