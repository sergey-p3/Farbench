# Right Tab Shortcut Rail Design

## Goal

Add a compact shortcut rail on the right side of the focused workspace so users can quickly switch between all open tabs/items in the current workspace.

## Chosen Design

Use the compact icon rail option. The rail floats over the right edge of the focused item, remains transparent enough to preserve context, highlights the active item, and exposes the full item title through the button label and browser tooltip.

## Behavior

- Show one shortcut button per open item in the selected workspace.
- Clicking a shortcut focuses that item using the existing `focusItem` flow.
- Hide the rail when there are no open items.
- Keep the rail vertically scrollable when items do not fit the viewport.
- Do not add close controls to the rail; closing remains in the existing item switcher.

## Accessibility

Each shortcut is a real button with an accessible name of `Switch to <title>`. The active item uses `aria-current="page"` and `aria-pressed="true"`.

## Testing

Add Playwright coverage that seeds several persisted open items, verifies the right-side rail appears, switches back to Files through the rail, and checks the rail has vertical overflow styling.
