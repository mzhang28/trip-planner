# UX review

Reviewed the live app at `localhost:5173` on 11 August 2026 in a Chromium browser, including a new trip, creating and editing events, calendar/search/share controls, and the available trip-settings flows. I also checked the responsive states and the related UI behavior for custom fields, files, mentions, maps, weather, collaboration, and recovery.

## Highest-impact journeys

### 1. Planning anything beyond today is unnecessarily difficult

**Journey:** Create a trip, add “Morning temple”, then try to put it on a future travel day.

- A new event starts under **“No time yet”**. Its editor has a **Start time** field but no date field.
- Entering `09:00` silently gives the event *today’s date* (observed: Tuesday 11 August), not a date the user chose.
- The only apparent way to reach another date is then to switch calendar view and drag the event. An unscheduled event is not shown in Week or Month, so the user has to discover the accidental-today step first.
- Day view only shows days that already contain events. There is no date navigator or empty future day that can receive an event.
- Flight departure/arrival and lodging check-in/check-out repeat the problem: they use text fields and derive a missing date from today. This is especially risky for a trip planner, where dates are core data.

**Improve:** Make date and time explicit, preferably with a date picker (and optional time) in the primary event form. Let users navigate and add directly to any day in Day view. Keep “No date yet” as a deliberate state, not the default route to scheduling.

### 2. Viewers cannot actually view event details

**Journey:** Open a shared trip as a viewer and inspect a booking.

- Event cards are disabled for viewers, so they cannot open.
- The collapsed card exposes only time, name, a little location/link-count metadata, and status. Description, booking code/note, links, files, flight information, custom fields, and place details are inaccessible.

This makes a “viewer” share role much less useful than its name suggests: a traveller cannot use it as an itinerary or booking reference.

**Improve:** Allow cards to open in a read-only details view. Hide or disable edit controls within that view, rather than disabling the one route to the content.

### 3. Sharing is fragile and does not match the user’s choices

**Journey:** Owner shares a trip.

- The UI only creates an **editor** link, although the API supports viewer and editor roles. Owners cannot choose read-only sharing.
- The result is a long raw URL in a code block with no Copy button, QR option, or share-sheet action.
- “Anyone with this link can edit the trip. It is shown once.” is alarming and ambiguous. The link stays on screen until navigation, and there is no clear explanation of whether it remains valid, where it can be revoked, or how to make another safely.
- There is no visible list of members/links or permission management.

**Improve:** Use a share dialog with role selection, Copy, and clear lifecycle language. Provide a Collaborators area that shows access, lets owners revoke links, and makes the current sharing state visible.

### 4. First-time trip setup lacks the essentials

**Journey:** Create “Japan, April.”

- The only setup question is the name. Home time zone is silently taken from the current device; dates are deferred completely.
- The empty state tells users to “work out the dates later,” but there is no obvious later setup screen for trip dates, home time zone, destination, or collaborators.
- A trip list card shows only name and role. It gives no dates, destination, progress, next activity, or last update, so a list of several trips will be hard to scan.

**Improve:** Keep quick creation, then offer a lightweight trip setup/onboarding panel for date range and home time zone. Show useful summaries on trip cards once known.

## Editing and calendar issues

### 5. The event editor is an intimidating ungrouped form

Opening a simple event expands a long single-column form: name, kind, city/place, time/duration, transit, time zone, booking, description, links, files, custom fields, and delete. Most fields are irrelevant for most events, and several labels repeat (“How long”, “Note”). On a phone this becomes a long scrolling task with no visible save/close affordance.

**Improve:** Preserve quick inline editing, but use progressive disclosure: show name/date/place/status first; put optional logistics, booking, files, and advanced metadata in collapsible sections. Provide an explicit Close/Done action and a compact read-only summary on the card.

### 6. Invalid inputs fail silently

Time, date, duration, and time-zone inputs are free text. Invalid dates/times are simply ignored; invalid durations can be stored as values such as negative minutes; an invalid IANA time zone can later make formatting fail. There is no input format example beyond placeholders, validation message, or confirmation of the saved value.

**Improve:** Use appropriate date/time controls where possible, validate on blur, retain erroneous text with a specific fix message, and constrain duration to positive values. Offer searchable time-zone selection rather than requiring an exact identifier.

### 7. Calendar navigation is fragmented

- **Earlier / Today / Later** only appears in Week and Month. Day view—the primary view—has no equivalent navigation.
- Month cells only show a count (“3 things”), so users must switch views to learn what those things are.
- Week is intentionally horizontally scrollable on narrow screens, but the actual week label and navigation live above it; it is easy to lose orientation while scrolling.
- The current anchor starts at today, even if the trip’s events are all in a different period.

**Improve:** Give every view a consistent date picker/range navigator and open a trip on its nearest upcoming (or first) event. In Month, show one or two compact event labels when space permits and a clear “+n” affordance.

### 8. Drag-and-drop is doing too much work

Moving between days depends on a tiny, low-contrast grip that is visually absent from the normal event-card flow. The destination is only a currently visible day/calendar cell, and bulk selections are global while “All in this day” means the map’s anchor day—not necessarily the day(s) containing the selection.

**Improve:** Add a Move to date command to each event and bulk-action bar, plus a visible date selector. Label the bulk action with the actual day (for example, “Select all — Tue 11 Aug”) or scope it to selected events’ day.

### 9. Deletion is too easy to trigger

Single-event Delete and bulk Delete act immediately, with no confirmation and no undo toast. Field deletion is likewise immediate, despite field values potentially disappearing from every event. Merge at least provides a preview; destructive actions should have comparable recovery.

**Improve:** Use an undo snackbar for event deletion, confirm high-impact field deletion with the affected-value count, and explain whether bulk deletion can be recovered.

### 10. Selection controls are hard to discover and can obscure content

Event checkboxes are fully transparent until hover/focus or after one item is selected. Hover is unavailable on touch devices, and users may not discover multi-select. Once active, the fixed bottom toolbar can cover the lower card/content; it has several similarly weighted actions including destructive Delete.

**Improve:** Provide an explicit “Select” mode or always-visible lightweight selection affordance on touch. Reserve bottom padding while the bar is present and visually separate/desaturate destructive actions.

## Search, place, and information quality

### 11. Search has weak failure states and keyboard ambiguity

The prominent search box returns events, dates, and commands, but it gives no “no matches” feedback and has no visible shortcut hint for Cmd/Ctrl+K. Its active-result bookkeeping counts results while its DOM also includes group headings, so screen-reader focus/selected indication can point at a different row after a category change.

**Improve:** Add an empty state, shortcut hint, and ensure the active descendant/visual highlight follows the same rendered-option index. Consider an explicit command palette trigger on smaller screens.

### 12. Place lookup is pointer-first and opaque while loading

Place results appear after a 400 ms delay with no loading state. The input has no keyboard navigation or Enter-to-select behavior; results are effectively mouse/touch choices. A failed lookup is indistinguishable from no matches, and manually typing a place keeps a label but silently drops the map pin.

**Improve:** Implement combobox keyboard controls, show loading/no-result/offline states, and tell users explicitly when a manual edit will remove coordinates. Offer “keep existing pin” only when safe.

### 13. Weather can mislead on multi-city trips

Weather is fetched from the first event with coordinates in the entire trip and then shown by date across calendar views. A trip that moves from Kyoto to Osaka (or across countries) can display the first location’s forecast for later locations without identifying the forecast city.

**Improve:** Fetch/group forecasts by dated location, or show weather only when its location is clear (for example, “Kyoto forecast”).

### 14. Map and descriptive content are separated from the task

The day map is tied to the hidden/current anchor day. In Day view, users cannot easily change that day, and the blank-map message competes with the main event list. Descriptions and mention previews are only exposed in the expanded editor; after closing it, there is no readable description on the event card.

**Improve:** Let the user choose the map day or follow the selected event. Show a short description preview on expanded/read-only event details and make mention links available there.

## Settings, permissions, and secondary flows

### 15. Trip settings expose a powerful schema editor without enough safeguards

The “Fields” link is terse and easy to overlook. Field types are described only by a small “Holds” select; there is no preview of how each type appears on an event or warning about changing/deleting an existing field. A viewer can also reach `/t/:tripId/fields`; this screen does not apply the trip’s read-only state before offering write controls.

**Improve:** Rename/describe this as “Custom fields”, add type previews and impact warnings, prevent duplicate/confusing field labels, and enforce role-based read-only UI on this route.

### 16. Audit and recovery are buried and jargon-heavy

Audit history is at the bottom of Trip settings rather than near collaboration or recent changes. The offline recovery banner is commendably explicit, but “reloaded from the server because this device had been away too long” does not say what happened in user terms or what “Put them back” will do to conflicts.

**Improve:** Put activity/history in a discoverable Trip activity area. In recovery, state which edits are affected, offer a review option, and make the consequence of restoring them explicit.

### 17. Attachments lack a clear task flow

Files use the browser’s native file picker only. There is no drag-and-drop, image preview, file-type guidance, aggregate progress, retry action, or visible empty-state instruction; only the per-file 25 MB error appears after selection. “Not sent yet” is useful, but the next action is not obvious if syncing remains blocked.

**Improve:** Add a drop zone/Attach button, accepted-file and size guidance before selection, previews for images/PDFs where appropriate, and retry/status detail for queued files.

## Responsive and language details

### 18. Important controls disappear on mobile

The “Show times in” Local time/My time toggle is hidden below the medium breakpoint. Time-zone comparison is often most useful while travelling—precisely when someone may be using a phone. The header also contains several persistent controls that compete for space before the itinerary itself.

**Improve:** Move display-zone choice into an overflow/settings menu on small screens instead of removing it. Prioritize the trip name, search, and one calendar control in the compact header.

### 19. Labels are occasionally clever rather than clear

Examples include “Holds” for field type, “Thing to do” for event kind, “No time yet” for undated events, and “It is shown once” for a share link. They require interpretation at moments where users need confidence.

**Improve:** Prefer direct labels such as “Field type”, “Activity”, “Unscheduled”, and “Copy this link now; you can create or revoke links later.”

## What is already working well

The app has a strong quick-add concept, clear empty states, offline-save status, keyboard-accessible calendar drag handles, status chips, a useful booking/transit model, and a thoughtfully concise week lodging rail. The changes above would preserve those strengths while making the central planning path much more direct and dependable.
