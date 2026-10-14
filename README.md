# Calendar Suite

A self-contained Obsidian plugin that gives you three calendar views — **Month Calendar**, **Day Overview** and **Day Timeline** — that always share one selected date. It is styled after the Notion-style dashboard in this vault (all colors come from Obsidian theme variables), and it integrates with your existing dashboard without replacing it.

<img width="1694" height="728" alt="image" src="https://github.com/user-attachments/assets/f0de628b-4a36-4807-8094-66f86f9ab633" />


The plugin is intentionally generic. Every tag, property name, folder and template it uses is configurable in **Settings → Calendar Suite**, and every visible label is English.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Command Palette](#command-palette)
- [Inserting the views](#inserting-the-views)
  - [A. Native code blocks](#a-native-code-blocks)
  - [B. DataviewJS launcher files](#b-dataviewjs-launcher-files)
  - [C. The `window.CalendarSuite` JS API](#c-the-windowcalendarsuite-js-api)
- [Shared date & dashboard sync](#shared-date--dashboard-sync)
- [Settings](#settings)
- [Data conventions](#data-conventions)
- [Default templates](#default-templates)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Test checklist](#test-checklist)

---

## Features

- **Month Calendar** — month grid with event and todo dots, week numbers, prev/next/today buttons, weekday headers honoring the first day of week.
- **Day Overview** — todos and events for the selected day, each with a checkbox and a link to the note, plus a button to create a journal entry.
- **Day Timeline** — the selected day's events as blocks on a 24-hour ruler; events without a time get their own "No time" lane, events spanning midnight are clamped.
- **One selected date** — clicking a day in any view (or your existing `kalender.js`/`zeitleiste.js` dashboard views) updates all of them.
- **Dashboard sync (one-way)** — the plugin drives your existing `window.__ndKalender` / `__ndZeitleiste` / `__ndGewohnheiten` dashboard globals so the whole dashboard follows the plugin's date. Your dashboard files are never modified; a bridge listens for their redraw functions and re-renders them on date change. You can turn this off in settings.
- **Create from the current date** — event notes, todo notes and journal entries from commands, buttons or the JS API.
- **Graceful degradation** — everything works without Dataview. If a *DataviewJS launcher* file is used while Dataview is missing, it shows a clear English error and does nothing else. (Native code blocks and the JS API never need Dataview.)
- **No hardcoded colors** — everything is built from Obsidian theme variables (`--background-primary`, `--text-faint`, `--interactive-accent`, …), so it follows light/dark mode and your theme automatically.

---

## Installation

1. Build or copy the plugin into your vault:

   ```
   <vault>/.obsidian/plugins/calendar-suite/
   ├── manifest.json
   ├── main.js
   └── styles.css
   ```

   In this repo:

   ```bash
   npm install
   npm run build             # produces main.js
   npm run install-to-vault  # copies manifest.json, main.js and (if present) styles.css
   ```

2. In Obsidian open **Settings → Community plugins** and make sure *Restricted mode* is off.
3. Find **Calendar Suite** in the list and toggle it **on**.
4. Open **Settings → Calendar Suite** and review the options (see [Settings](#settings)). If you use the German conventions already present in this vault, press the **"Use this vault's conventions"** preset button (adds `termin`/`aufgabe` as tag aliases, sets `datum`/`zeit`/`titel`/`status`, the TaskNotes date aliases, and the journal location/template) and then **Apply preset** — or leave the generic English defaults if you prefer.
5. On first load the plugin installs its default templates into `98_Vorlagen/Calendar Suite/` (never overwriting anything). You can also press **"Create default templates"** in settings at any time.

To **disable** the plugin: **Settings → Community plugins → Calendar Suite → toggle off**. Nothing in your vault is changed by disabling or uninstalling; the plugin only writes its own template folder and the notes you explicitly create.

---

## Command Palette

Open the Command Palette (`Ctrl/Cmd+P`). All commands are prefixed with **Calendar Suite**:

| Command | What it does |
| --- | --- |
| **Calendar Suite: Insert Month Calendar** | Inserts a month calendar code block at the cursor. |
| **Calendar Suite: Insert Day Overview** | Inserts a day overview code block at the cursor. |
| **Calendar Suite: Insert Day Timeline** | Inserts a day timeline code block at the cursor. |
| **Calendar Suite: Insert Full Calendar Dashboard** | Inserts all three views as one dashboard code block. |
| **Calendar Suite: Create Event for Selected Date** | Creates an event note for the selected date and opens it. |
| **Calendar Suite: Create Todo for Selected Date** | Creates a todo note for the selected date and opens it. |
| **Calendar Suite: Create Journal Entry for Selected Date** | Creates (or opens) the journal note for the selected date. |
| **Calendar Suite: Go to Today** | Sets the shared selected date back to today. |
| **Calendar Suite: Install Default Templates** | Re-runs the one-time template install (never overwrites). Reports created/skipped/failed. |
| **Calendar Suite: Open Settings** | Opens Settings directly on the Calendar Suite tab. |

> The three "Insert …" commands work in **editing mode** (they insert text at the cursor). The "Create …" commands work anywhere.

---

## Inserting the views

There are three independent ways to use the views. Use whichever fits the note you are editing — they all share the same selected date.

### A. Native code blocks

The simplest and most robust way. No Dataview required.

````markdown
```calendar-month
```
````

````markdown
```calendar-day
```
````

````markdown
```calendar-timeline
```
````

````markdown
```calendar-dashboard
```
````

Use the commands **Insert Month Calendar / Day Overview / Day Timeline / Full Calendar Dashboard** to insert them at the cursor. The three views are independent — put any of them anywhere; they all follow the shared selected date.

### B. DataviewJS launcher files

This vault already has a dashboard that calls DataviewJS views from `00_Dashboard/Views/`, so Calendar Suite ships matching launcher files:

- `00_Dashboard/Views/calendar-suite-month.js`
- `00_Dashboard/Views/calendar-suite-day.js`
- `00_Dashboard/Views/calendar-suite-timeline.js`
- `00_Dashboard/Views/calendar-suite-dashboard.js`

Use them from any note with a DataviewJS block, exactly like the existing dashboard uses `kalender.js`:

```js
await dv.view("Views/calendar-suite-month", {})     // relative to the current note's folder
```

or, from anywhere in the vault, with an absolute path:

```js
await dv.view("00_Dashboard/Views/calendar-suite-day", {})
```

Pass an initial date if you want (defaults to the shared selected date, else today):

```js
await dv.view("Views/calendar-suite-timeline", { initialDate: "2026-10-14" })
```

> **Dataview missing?** These launcher files detect that Dataview is absent and show *"Dataview is not installed or enabled…"* — they never throw or render partial output. The native code blocks in [A](#a-native-code-blocks) and the JS API in [C](#c-the-windowcalendarsuite-js-api) keep working without Dataview.

> If you keep the launchers in `00_Dashboard/Views/`, you may want to add `00_Dashboard/Views/calendar-suite-*.js` to Dataview's **Settings → Dataview → Javascript queries → Enable JS queries** allowance if you use folder-based restrictions.

### C. The `window.CalendarSuite` JS API

For maximum control from any DataviewJS block, console, or other plugin:

```js
const cs = window.CalendarSuite;

// render any view into any element
const div = dv.container;                          // or document.createElement("div")
await cs.render(div, "month");                     // Month Calendar
await cs.render(div, "day");                       // Day Overview
await cs.render(div, "timeline");                  // Day Timeline
await cs.render(div, "dashboard");                 // all three views in one container
await cs.render(div, "month", { initialDate: "2026-10-14", sourcePath: dv.file.path });

// the shared date
cs.getSelectedDate();                              // "2026-10-13"
cs.setSelectedDate("2026-10-14");                  // true on success; updates every view
cs.goToday();

// create notes for a date (defaults to the selected date);
// each resolves to the new note's path, or null on failure
await cs.createEvent();                            // await cs.createEvent("2026-10-14")
await cs.createTodo();
await cs.createJournal();

// misc
cs.refresh();                                      // re-index the vault and re-render views
cs.dataviewAvailable();                            // is the Dataview plugin enabled?
console.log(cs.getSettings());                     // read-only snapshot of active settings
console.log(cs.version);                           // "1.0.0"
```

`render()` never throws: an unknown view name or a mount failure is drawn into the container as readable English text (`cs.render(div, "nope")` → *"unknown view "nope". Use one of: month, day, timeline, dashboard."*).

For advanced use, `cs.env(sourcePath)` returns the same environment object the views themselves use (with `.createFor("event" | "todo" | "journal", iso)` and the selected-date store), so a custom script can mount a view into its own container.

---

## Shared date & dashboard sync

- All Calendar Suite views share one selected date. Clicking a day (in the month grid, a todo/event row, or the timeline header) changes it for every view.
- Setting the date via `CalendarSuite.setSelectedDate()` or **Go to Today** does the same.
- **Dashboard sync** (setting *Sync existing dashboard views*, on by default): when the plugin's date changes, it also updates the existing dashboard views by setting their globals (`__ndKalenderDatum`, …) and calling their redraw functions (`__ndKalenderZeichnen()`, `__ndZeitleisteZeichnen()`, `__ndGewohnheitenZeichnen()`). A bridge listens for those functions being defined/redefined, so it works no matter when your dashboard note loads. The reverse direction (your dashboard's date buttons changing the plugin's views) also works.
- **No polling**: everything is event-driven. Vault changes re-index with a short debounce; there are no intervals left running when a view is closed.

---

## Settings

**Settings → Calendar Suite**:

| Setting | Default | Purpose |
| --- | --- | --- |
| Event tag(s) | `event` | Comma-separated. Notes with any of these tags are events. |
| Todo tag(s) | `todo` | Comma-separated. Notes with any of these tags are todos. |
| Event / Todo tag aliases | *(empty)* | Extra tags recognized as events / todos (e.g. `termin`, `aufgabe`). |
| Date property (events) | `date` | Where an event's or todo's date lives. |
| Extra date property names | *(empty)* | e.g. `due, scheduled` — treated as date properties everywhere. |
| Start / end property | `start` / `end` | Event times. |
| Single time property | `time` | Used when an event has no start/end (e.g. `18:00-20:00`). |
| Title property | `title` | Property used as an event's title. |
| Todo completed property | `done` | Checkbox property that marks a todo as finished. |
| Show completed todos | off | Off = completed todos are hidden from the Day Overview. |
| Read inline tasks | on | Also picks up `- [ ] something 📅 2026-10-14` from note bodies. |
| Inline task excluded tags | `checklist` | Inline tasks carrying one of these tags are ignored. |
| Require todo tag on inline tasks | off | On = only tagged notes' inline tasks count. |
| Event / Todo / Journal template | `98_Vorlagen/Calendar Suite/…` | Templates used when creating notes. |
| Event / Todo folder | `01_Inbox` | Where new event and todo notes are created. |
| Journal folder | `99_Journal/Tage` | Where journal notes are created. |
| First day of week | Monday | Weekday column order in the month calendar. |
| Compact mode | off | Tighter spacing everywhere. |
| Show week numbers | off | Week numbers in the month calendar. |
| Sync existing dashboard views | on | One-way sync to `__ndKalender`/`__ndZeitleiste`/`__ndGewohnheiten`. |

Invalid values (missing template file, bad folder, first day of week out of range) are **flagged directly in the settings tab** with a warning note — nothing is silently ignored at runtime.

Two helper buttons:

- **Use this vault's conventions** — fills the detection settings with what this vault already uses: `termin`/`aufgabe` (+`task`) as tag aliases, date `datum` (plus the `due`, `scheduled`, `sitzungsdatum` aliases), time `zeit`, title `titel`, todo completed `status`, journal in `99_Journal/Tage` from `98_Vorlagen/Tagesnotiz.md`, todos in `99_Journal/Todos`. Review and press **Apply preset**. It changes *plugin settings only* — no file in your vault is touched.
- **Create default templates** — writes the three default templates into `98_Vorlagen/Calendar Suite/`, skipping any file that already exists.

---

## Data conventions

The plugin reads your notes through Dataview's index **when Dataview is installed**, and falls back to a fast internal index otherwise. A note is an **event** when it has an event tag and a date property. A note is a **todo** when it has a todo tag (with a date/due property), **or** when it contains an inline task with a 📅 date (`- [ ] something 📅 2026-10-14`).

Example event note:

```markdown
---
tags:
  - termin
datum: 2026-10-14
zeit: 14:00
titel: Team Meeting
---
```

Example todo note:

```markdown
---
tags:
  - aufgabe
datum: 2026-10-14
status: open
---
- [ ] Review the roadmap 📅 2026-10-14
```

Journal notes are recognized by path: `<journal folder>/<YYYY-MM-DD>.md`.

---

## Default templates

The plugin ships three Markdown templates and installs them to `98_Vorlagen/Calendar Suite/` on first load (never overwriting existing files):

- `Event.md` — `title`, `date`, `start`, `end` properties + `event` tag. `{{title}}` and `{{date}}` are filled when a note is created.
- `Todo.md` — `title`, `date`, `completed` properties + `todo` tag. `{{title}}`/`{{date}}` are filled.
- `Journal.md` — daily-note style header for the date. `{{date}}` is filled.

(Only the tokens `{{date}}` and `{{title}}` are substituted — core-Templates style. Whatever is left in `start`/`end` is empty for you to fill in.)

To customize, edit the files in your vault (or point the settings to your own templates). Existing templates in `98_Vorlagen/` (`Termin.md`, `Aufgabe.md`, `Tagesnotiz.md`) are **not** used automatically and are never modified — if you prefer them, select them in **Settings → Calendar Suite** instead of the defaults.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing renders in a code block | Make sure the plugin is enabled and `manifest.json` + `main.js` + `styles.css` are in `.obsidian/plugins/calendar-suite/`. |
| DataviewJS launcher shows a red error | Dataview is missing/disabled — install/enable it, or use the native code blocks instead. |
| Events don't show up | Check the tag/property names in **Settings → Calendar Suite** (this vault uses `termin`, `datum`, `zeit`, `titel`). |
| Todos don't show up | Same as above (`aufgabe`, `datum`, `status`); inline `📅` tasks always work. |
| Wrong weekday order | Set **First day of week** in settings. |
| Old date still on the dashboard | Turn on **Sync existing dashboard views**, or press **Go to Today**. |
| Settings warning note | The flagged value is invalid (e.g. template file was deleted) — fix it and press **Apply**. |

---

## Development

```bash
npm install
npm run build              # tsc -noEmit && esbuild → main.js
npm run dev                # watch mode
npm test                   # unit tests (date utils, settings, indexing, rendering helpers)
npm run install-to-vault   # copy manifest.json, main.js, styles.css into the vault
```

Deployment target (this vault): `~/Zentraler Vault/.obsidian/plugins/calendar-suite/`.

The source is split into small modules — `main.ts`, `settings.ts`, `settings-tab.ts`, `calendar-view.ts`, `day-overview.ts`, `timeline-view.ts`, `dashboard-view.ts`, `date-utils.ts`, `note-utils.ts`, `templates.ts`, `data.ts`, `state.ts`, `ui.ts`, `env.ts`, `api.ts`, `types.ts` — one concern each.

---

## Test checklist

- [ ] Plugin enables/disables cleanly; no console errors.
- [ ] **Insert Month Calendar** → block renders; prev/next change the month; **Today** returns to the current month.
- [ ] Click a day in the month calendar → Day Overview, Day Timeline and the existing dashboard all update.
- [ ] **Insert Day Overview** → todos and events for the selected date appear; clicking a row opens the note; checkboxes toggle the todo's `done` property.
- [ ] **Insert Day Timeline** → events with times appear at the right hour; an event without a time appears under "No time"; an event without any time doesn't crash the view.
- [ ] **Insert Full Calendar Dashboard** → all three views render and stay in sync.
- [ ] **Create Event / Todo / Journal Entry for Selected Date** → a new note is created in the configured folder from the template and opens.
- [ ] Day with no data → friendly empty state, not a blank box.
- [ ] Dataview disabled → native code blocks and JS API still work; DataviewJS launcher shows the English error.
- [ ] Settings warnings appear for a missing template / bad folder / bad first day of week.
- [ ] Rename or delete a note → views update; no errors in the console.
- [ ] Switch themes (light/dark) → colors follow the theme; nothing is hardcoded.
