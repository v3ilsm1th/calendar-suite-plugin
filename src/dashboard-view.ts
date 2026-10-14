/**
 * dashboard-view.ts
 *
 * Composition of all three views behind the `Insert Full Calendar Dashboard`
 * command: month calendar and day overview side by side, timeline below on
 * narrow screens and beside them once there is room for a third column.
 *
 * The three views are still separate mounts with their own teardown, so this
 * is a layout wrapper and nothing more.
 */

import { ViewEnv } from "./env";
import { mountMonthCalendar } from "./calendar-view";
import { mountDayOverview } from "./day-overview";
import { mountTimeline } from "./timeline-view";
import { bind } from "./state";
import { clear, el } from "./ui";

export function mountDashboard(container: HTMLElement, env: ViewEnv): () => void {
    const children: Array<() => void> = [];

    // Register the teardown first – it also runs the previous binding for this
    // container, which empties it before the new DOM is created.
    const destroy = (): void => {
        for (const child of children.splice(0)) {
            try {
                child();
            } catch (err) {
                console.error("Calendar Suite: child teardown failed", err);
            }
        }
        clear(container);
    };
    bind(container, destroy);

    const root = el("div", "cs-dash");
    const calendarSlot = el("div", "cs-dash-cal");
    const daySlot = el("div", "cs-dash-day");
    const timelineSlot = el("div", "cs-dash-tl");

    root.append(calendarSlot, daySlot, timelineSlot);
    container.appendChild(root);

    children.push(mountMonthCalendar(calendarSlot, env));
    children.push(mountDayOverview(daySlot, env));
    children.push(mountTimeline(timelineSlot, env));

    return destroy;
}
