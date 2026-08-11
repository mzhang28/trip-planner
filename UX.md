# UX review

I reviewed the live app at `localhost:5173` on 11 August 2026.

The review used Chromium at 1440 × 1000 and 390 × 844. I used separate owner and viewer sessions.

I also ran the end-to-end suite on phone, tablet, and desktop layouts. It passed 140 of 141 tests.

The failed test exposed a timing race in the collaborator list. The other tests confirmed the main paths and accessibility rules.

## Coverage

The review included these journeys and states:

- Create a trip, open it again, and open an invalid trip address.
- Add, schedule, edit, move, merge, and delete events.
- Use activity, lodging, flight, and note event types.
- Add places, transit, booking data, links, files, descriptions, and mentions.
- Create and use all custom-field types.
- Use Day, Week, and Month views, including calendar-based creation.
- Use search, date navigation, time-zone display, weather, and the day map.
- Create viewer and editor links, copy links, revoke links, and remove members.
- Open read-only event details and read-only field settings.
- Edit offline, reconnect, recover old local work, and review agent activity.
- Use light, dark, and system themes with keyboard and touch input.

## Highest-priority journeys

### 1. An invalid trip looks editable and claims that work is safe

**Journey:** Open an old, removed, or incorrect `/t/:tripId` address.

- The page shows a trip named “Trip” instead of an access or not-found message.
- The page shows event controls and accepts new local work.
- The status says “Saved on this device,” although the server rejects the trip.
- A removed member can get the same state from an old local copy.

This state can cause silent work loss. It also gives a false impression that access still exists.

**Improve:** Block editing until the trip request succeeds. Show distinct not-found, access-removed, and offline-copy states.

### 2. A date without a time becomes 12:00

**Journey:** Add an event, reveal Date, and select a day without selecting a time.

- The card immediately shows `12:00`.
- The time field also shows `12:00`.
- Clearing a time puts the event back at noon.
- The interface says that a blank time means that the user has not decided it.

The stored model cannot represent a known date with an unknown time. Noon can look like a real booking time.

**Improve:** Store a date-only state. Display “Time not set” until the user supplies a time.

### 3. A date change resets the editor

**Journey:** Reveal Date, Duration, City, Place, and Booking. Then set the date.

- The event moves from “No date yet” to the selected day.
- The editor stays open, but the unfilled revealed fields disappear.
- The user must find and reveal those fields again.
- Draft text in a field can disappear if the field did not commit before the move.

**Improve:** Keep the revealed-field state above the dated sections. Preserve all drafts during event moves.

### 4. Long event editing has no clear exit

**Journey:** Open an event on a phone and reveal most optional fields.

- The editor becomes much taller than the screen.
- The card header scrolls out of view.
- The only close action is another press on that hidden header.
- “Delete event” is the only action at the bottom.

**Improve:** Add a sticky Done action. Keep the event name and close action visible during long edits.

### 5. Trip setup stops after the name

**Journey:** Create a trip, then try to set its main details.

- Creation asks only for a name.
- The app copies the device time zone without showing it.
- “Trip settings” contains only custom fields and recent changes.
- There is no interface to change the trip name, time zone, date range, or destination.
- There is no interface to archive or delete a trip.

These missing controls affect calendar grouping, default event times, and trip-list usefulness.

**Improve:** Add a Basics section to Trip settings. Include the name, home time zone, dates, destination, archive, and delete controls.

## Calendar and planning issues

### 6. Week cards hide the event name by default

**Journey:** Add short events at 09:00 and 19:00. Open the Week view with default display settings.

- The timetable compresses 09:00 through midnight into the available height.
- A short event gets a 24-pixel card with two text lines.
- The time remains visible, but the event name is clipped.
- The result looks like two unnamed time markers.

**Improve:** Use a single-line card in compressed mode. Put the name first and add the time on the same line.

### 7. Month view gives weak itinerary information

**Journey:** Open a month that has two events on one day.

- The cell says only “2 things.”
- Event names and booking states are unavailable until the user opens the day.
- An empty cell creates an event, but its add target is invisible without hover.
- A touch user can create an unnamed event without seeing the action first.

**Improve:** Show one or two compact event names and a `+n` count. Give the add target a visible touch affordance.

### 8. Day navigation changes two different concepts

**Journey:** View several dated sections in Day view. Then press Earlier or Later.

- The itinerary list still contains every trip day.
- The navigation changes the map day and the range label.
- The list does not always move to the new anchor day.
- “All in this day” also uses the hidden anchor, not the visible section.

**Improve:** Either filter Day view to one day or scroll it to the anchor. Name the selected day in bulk actions.

### 9. Unscheduled events disappear from Week and Month

**Journey:** Add several events without dates. Then switch away from Day view.

- Week and Month do not show the unscheduled events.
- The user gets no count or tray that shows pending scheduling work.
- Search can still find the events, but the calendar gives no clue that they exist.

**Improve:** Add an Unscheduled tray or count to every calendar view. Support moving an item from the tray to a day.

### 10. Touch creation and selection are difficult to discover

**Journey:** Use Week view or bulk selection on a phone.

- Week drag creation is unavailable for touch input.
- The empty week columns do not expose a clear alternative action.
- Event selection boxes stay transparent until selection starts.
- Touch has no hover state that can reveal the first selection box.

**Improve:** Add a visible Select mode. Add a clear “Add here” action to each week day on touch devices.

## Event data issues

### 11. Flight entry can assign the wrong date or break the view

**Journey:** Change an event to Flight and enter the flight data first.

- Departure time uses today when the event has no date.
- Arrival has a time but no explicit date.
- An earlier arrival time always means the next day.
- Trips longer than 24 hours need a workaround.
- Flight time-zone fields do not use the validation from the general time-zone field.
- An unknown flight time zone can make time formatting fail for the event.

**Improve:** Use date and time fields for both ends. Validate both time zones before the event changes.

### 12. Lodging dates use unchecked text fields

**Journey:** Change an event to Stay and enter check-in and check-out dates.

- These fields are text inputs, unlike the main event date.
- An invalid value disappears without a message.
- The app does not warn when check-out is before check-in.
- The values use UTC times rather than the lodging time zone.

**Improve:** Use date controls and validate the range. Apply the lodging or event time zone.

### 13. Destructive event actions lack recovery

**Journey:** Delete one event, delete selected events, or remove event content.

- Event deletion happens immediately.
- Bulk deletion also happens immediately.
- Link, attachment, and choice removal have no undo action.
- The activity log cannot restore ordinary web edits.
- Field deletion has a warning, but event deletion does not.

**Improve:** Add an undo message after event deletion. Add a confirmation for large deletions and removals that affect stored values.

### 14. Basic text and link errors remain unclear

**Journey:** Clear an event name or add a malformed link.

- A blank name remains visible until the editor closes, then the old name returns.
- The app gives no explanation for the rejected blank name.
- A link accepts any text and can become a broken relative address.

**Improve:** Show inline errors for required names and invalid addresses. Keep rejected text visible until the user corrects it.

## Map, place, and weather issues

### 15. The empty map dominates the main task

**Journey:** Plan events before adding map places.

- A blank map panel uses about half of the desktop content width.
- The phone layout adds a large blank panel after the itinerary.
- The same instruction repeats until any event gets coordinates.

**Improve:** Collapse the map until a pin exists. Provide a compact “Add places to use the map” action.

### 16. Map pins can become stale

**Journey:** Change a pinned place or reorder the times of pinned events.

- The map update key contains event IDs and booking states.
- It does not contain coordinates or start times.
- A moved place can leave its old marker until another tracked value changes.
- Reordered events can keep old pin numbers.

**Improve:** Refresh markers when coordinates, times, or ordering change.

### 17. Weather can describe the wrong city

**Journey:** Add pinned events in several cities across different days.

- The forecast uses the first pinned place in the whole trip.
- Later days can show that first place's weather.
- The calendar does not name the forecast location.

**Improve:** Group forecasts by dated place. Show the city beside every forecast group.

## Sharing and account issues

### 18. Collaboration identities are not useful

**Journey:** Share the trip with several people and review “On this trip.”

- Anonymous members appear as “Someone.”
- The owner cannot tell two members apart.
- The owner cannot change a member between read and edit access.
- The panel does not refresh automatically when a member joins.
- The phone test exposed a race where a new member did not appear in time.

**Improve:** Add member names or device labels. Add role controls and refresh the list while the panel is open.

### 19. Share-link controls do not expose their full lifecycle

**Journey:** Create a viewer link and decide how long it must work.

- The server supports link expiration, but the interface does not expose it.
- The generated sentence says, “This link lets anyone who has it can read.”
- There is no system share action or QR code for phone-to-phone sharing.
- Offline creation fails without a visible error.

**Improve:** Add an expiration choice, correct the sentence, and show network errors. Add the system share action where the browser supports it.

## Secondary flows

### 20. Custom-field settings can remove data too quietly

**Journey:** Create choice fields, use their choices, and edit the field later.

- “Holds” is an unclear label for the field type.
- Duplicate field names and duplicate choices are accepted.
- Removing a choice also clears that choice from every event.
- Choice removal gives no affected-event count or warning.
- Currency accepts any text despite the three-letter hint.

**Improve:** Use “Field type.” Prevent duplicates and validate currencies. Warn before removing a used choice.

### 21. Attachments have a minimal task flow

**Journey:** Attach booking documents online and offline.

- The native file input gives no drop target or preview.
- Size guidance appears only after a file is too large.
- Pending files show “Not sent yet,” but there is no retry action or error detail.
- Removing a file has no undo action.

**Improve:** Add an Attach button or drop zone. Show limits first, add previews, and provide retry details.

### 22. Network failures can look like empty data

**Journey:** Open the app or settings while the server is unavailable.

- A failed trip-list request becomes “No trips yet.”
- A failed access request can make the share panel look empty.
- A failed activity request can look like an empty history.
- These messages can cause incorrect decisions about trips, links, and changes.

**Improve:** Keep empty and unavailable states separate. Provide a retry action for every server-backed panel.

### 23. Trip cards do not help users scan several trips

**Journey:** Return to the trip list after creating several trips.

- Each card shows only the trip name and access role.
- The card omits dates, destination, next event, and last activity.
- Several similar trip names become difficult to tell apart.

**Improve:** Add a compact date range, destination, next event, and recent-activity line.

## What works well

- Quick event creation needs only a name.
- Direct date selection and empty-day creation remove major scheduling friction.
- Generic time, duration, and time-zone fields now explain invalid input.
- Search shows its keyboard shortcut and gives a useful no-results message.
- Place lookup now has keyboard controls and clear loading, empty, and offline states.
- Viewers can open full read-only event details.
- Owners can create read or edit links, copy them, revoke them, and remove members.
- Offline edits survive reloads and synchronize after reconnection.
- Mentions stay connected to renamed events and mark deleted targets.
- Transit warnings explain when travel does not fit between events.
- Field deletion reports how many events will lose a value.
- The tested layouts passed automated accessibility scans in light and dark themes.
