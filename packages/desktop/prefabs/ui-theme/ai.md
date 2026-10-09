---
prefab: ui-theme
---

# UI Theme — AI guide

## When to use

Place one UI Theme from the library. Pick Accent Color and Dark or Light in its inspector, then Play. Run Progress, Announcer, and the 2D UI modes of Game Flow, Server Clock and Leaderboard share the palette. A single color change restyles their buttons, timers, scores, progress indicators and results together; text contrast is derived automatically. Keep one theme per scene.

## API

- `accentColor`: six-digit hex color, edited with a color picker.
- `appearance`: Dark or Light.

For custom UI, import `sceneUiTheme` and `UI_CANVAS` from `~runtime/uiTheme`, and `UiPanel`, `UiText`, `UiButton`, `ProgressPips`, `UiNotice` from `~runtime/uiComponents`. Register with `ReactEcsRenderer.addUiRenderer(entity, render, UI_CANVAS)`. Keep viewport roots pointer-transparent and handlers on actual buttons. Labels and stacks need explicit dimensions. Inspect a screenshot in the real preview, including completion and a smaller viewport.

`ColorHex`, `EntityName`, `EntityNames`, `ZoneName` and `ZoneNames` from `~runtime/authoring` are string aliases that give constructor parameters color or entity pickers. Plural references are ordered comma-separated names; creators pick and reorder them in the inspector. Names must be unique and contain no commas. The assistant can provide arrays to the plural parameters.

## Do / Don't

- Use one theme per scene, readable text and small non-blocking HUDs.
- Do not write a separate palette for each prefab or use default pink SDK buttons.
- Verify running and finished states in a real preview screenshot.

## Example

Place UI Theme with accentColor "#59E0AC" and appearance "Dark", then place Run Progress and Announcer.
Their buttons, progress indicators, result panel and messages all share mint accents on dark surfaces.
Choose a new accent in the inspector to change them together. No scene script is needed.
