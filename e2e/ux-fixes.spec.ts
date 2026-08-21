import { expect, test, type Page } from '@playwright/test';
import { addNewEvent, closeEvent, editEvent, goToScreen, switchView } from './helpers';

async function newTrip(page: Page, name = 'Japan, April') {
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const trip = await page.evaluate(async (tripName) => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: tripName, homeTimezone: 'Asia/Tokyo' }),
    });
    return (await res.json()) as { id: string };
  }, name);

  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  return trip.id;
}

function eventRow(page: Page, name: string) {
  return page.getByTestId('event').filter({ hasText: name });
}

/**
 * Brings a field on screen, wherever it is offered from.
 *
 * A field is already there once it holds something, behind its chip if it
 * does not, and behind the chip the palette folds the rest away under. Some
 * live on the card header instead and are never in the palette at all.
 */
async function reveal(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  const chip = editor.getByTestId(`add-field-${key}`);
  const expand = editor.getByTestId('expand-palette');

  // Waited for rather than counted: the palette renders a tick after the card
  // opens, and counting an element that is not there yet reads as absent.
  await expect(chip.or(expand).first()).toBeVisible();

  if ((await chip.count()) === 0) await expand.click();
  await chip.click();
}

test.describe('putting an event on a chosen day', () => {
  test('a date can be set directly rather than defaulting to today', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Morning temple');
    await editEvent(page, 'Morning temple');
    await reveal(page, 'when');

    // A real date control. Typing a time used to put it on today whatever day
    // was meant, which on a trip planner is the one thing not to guess.
    const date = page.getByTestId('event-date');
    await date.fill('2026-09-03');

    await page.getByTestId('close-editor').click();
    await page.getByTestId('go-to-date').fill('2026-09-03');

    await expect(page.getByTestId('go-to-date')).toHaveValue('2026-09-03');
    await expect(eventRow(page, 'Morning temple')).toBeVisible();
  });

  test('a day with nothing on it can still be added to', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByTestId('go-to-date').fill('2026-09-03');
    await page.getByTestId('add-on-2026-09-03').click();

    const name = page.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    await name.fill('Decided later');
    await name.blur();

    await expect(eventRow(page, 'Decided later')).toBeVisible();
  });

  test('every view can be navigated the same way', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    for (const view of ['Day', 'Week', 'Month'] as const) {
      await switchView(page, view);

      await expect(page.getByTestId('go-to-date')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Earlier' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Later' })).toBeVisible();
    }
  });

  test('a mistyped time says so instead of being ignored', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Morning temple');
    await editEvent(page, 'Morning temple');
    await reveal(page, 'when');

    await page.getByTestId('event-date').fill('2026-09-03');

    const time = page.getByRole('textbox', { name: 'Time' });
    await time.fill('nine-ish');
    await time.blur();

    // Keeping the text and saying what is wrong is the difference between a
    // correction and a silent loss.
    await expect(page.getByText('Use a time like 09:00')).toBeVisible();
    await expect(time).toHaveValue('nine-ish');
  });
});

test.describe('custom colors', () => {
  test('event and city colors use the shared palette across calendar views', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Night train');
    await editEvent(page, 'Night train');

    await page.getByRole('button', { name: 'Color for Night train, no color' }).click();
    const eventPalette = page.getByRole('dialog', { name: 'Color for Night train' });
    await expect(eventPalette.getByRole('button')).toHaveCount(33);
    await eventPalette.getByRole('button', { name: 'Navy' }).click();

    await reveal(page, 'when');
    await page.getByTestId('event-date').fill('2026-09-03');
    await reveal(page, 'city');
    const city = page.getByRole('textbox', { name: 'City' });
    await city.fill('Kyoto');
    await city.blur();

    await page.getByRole('button', { name: 'Color for Kyoto, no color' }).click();
    await page
      .getByRole('dialog', { name: 'Color for Kyoto' })
      .getByRole('button', { name: 'Sunflower' })
      .click();

    await page.getByTestId('close-editor').click();
    await page.getByTestId('go-to-date').fill('2026-09-03');
    await switchView(page, 'Month');

    const cityRibbon = page.getByText('Kyoto', { exact: true }).first();
    await expect(cityRibbon).toHaveCSS('background-color', 'rgb(254, 246, 213)');
    await expect(cityRibbon).toHaveCSS('border-color', 'rgb(250, 204, 21)');
    await expect(cityRibbon).toHaveCSS('color', 'rgb(17, 24, 39)');

    const event = page.getByText('Night train', { exact: true });
    await expect(event.locator('..')).toHaveCSS('background-color', 'rgb(215, 220, 234)');
    await expect(event).toHaveCSS('color', 'rgb(17, 24, 39)');
  });
});

test.describe('what a viewer can do', () => {
  async function shareAsViewer(page: Page, tripId: string) {
    return page.evaluate(async (id) => {
      const res = await fetch(`/api/trips/${id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'viewer' }),
      });
      return ((await res.json()) as { token: string }).token;
    }, tripId);
  }

  test('a viewer can read an event, including what the card does not show', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const tripId = await newTrip(page);

    await addNewEvent(page, 'Ryokan');
    await editEvent(page, 'Ryokan');
    await reveal(page, 'confirmation');
    await page.getByRole('textbox', { name: 'Confirmation code' }).fill('7K2QLM');
    await page.getByRole('textbox', { name: 'Confirmation code' }).blur();
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

    const token = await shareAsViewer(page, tripId);

    const other = await browser.newContext();
    const viewer = await other.newPage();
    await viewer.goto(`/join/${token}`);
    await expect(viewer.getByTestId('event').filter({ hasText: 'Ryokan' })).toBeVisible();

    // The card used to be the only route to the content, and it was disabled.
    await viewer.getByTestId('event').filter({ hasText: 'Ryokan' }).click();
    await expect(viewer.getByTestId('event-details')).toBeVisible();
    await expect(viewer.getByTestId('event-details')).toContainText('7K2QLM');

    // Read-only hides the controls, not the content.
    await expect(viewer.getByTestId('event-editor')).toHaveCount(0);

    await other.close();
  });

  test('a viewer reaching the fields screen is not offered write controls', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const tripId = await newTrip(page);
    const token = await shareAsViewer(page, tripId);

    const other = await browser.newContext();
    const viewer = await other.newPage();
    await viewer.goto(`/join/${token}`);
    await viewer.goto(`/t/${tripId}/fields`);

    // Never offered, not offered and withdrawn: the controls stay hidden until
    // the role is known rather than until it is known to be viewer.
    await expect(viewer.getByRole('button', { name: 'Add field' })).toHaveCount(0);
    await expect(viewer.getByText(/Only someone who can edit/)).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Add field' })).toHaveCount(0);

    await other.close();
  });
});

test.describe('sharing', () => {
  test('a read-only link can be made, copied, and revoked', async ({ page, context, browser }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto('/');
    const tripId = await newTrip(page);

    await page.getByRole('button', { name: 'Share trip' }).click();
    const panel = page.getByTestId('share-panel');
    await expect(panel).toBeVisible();

    // Read-only was never offered though the server always supported it.
    await panel
      .getByRole('radiogroup', { name: 'What the link allows' })
      .getByText('Can read', { exact: true })
      .click();
    await panel.getByRole('button', { name: 'Make a link' }).click();

    const url = await panel.getByTestId('share-url').textContent();
    expect(url).toContain('/join/');

    await panel.getByRole('button', { name: 'Copy' }).click();
    await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

    // The link is listed afterwards, so its existence is not something to
    // remember.
    await expect(panel.getByText(/A link that can read/)).toBeVisible();

    // Somebody uses it, then it is revoked.
    const other = await browser.newContext();
    const guest = await other.newPage();
    await guest.goto(url!);

    // On the trip, and reading it: an assertion that only counts what is
    // absent would also pass on the page that says you cannot open this.
    await expect(guest.getByRole('heading', { name: 'Japan, April' })).toBeVisible();
    await expect(guest.getByRole('button', { name: 'Add event' })).toHaveCount(0);

    await panel.getByRole('button', { name: 'Revoke' }).click();
    await expect(panel.getByText(/A link that can read/)).toHaveCount(0);

    // Nobody new can join with it now.
    const third = await browser.newContext();
    const stranger = await third.newPage();
    await stranger.goto(url!);
    await expect(stranger.getByText(/no longer works/)).toBeVisible();

    // The person who already used it is still on the trip, and listed.
    await expect(panel.getByRole('button', { name: 'Remove' })).toHaveCount(1);

    await other.close();
    await third.close();
    void tripId;
  });
});

test.describe('what a field does with input it cannot use', () => {
  test('an end time calculates a readable duration and says when it cannot be used', async ({
    page,
  }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Tea ceremony');
    await editEvent(page, 'Tea ceremony');
    await reveal(page, 'when');
    await page.getByTestId('event-date').fill('2026-08-30');
    await page.getByRole('textbox', { name: 'Time' }).fill('13:15');
    await page.getByRole('textbox', { name: 'Time' }).blur();
    await reveal(page, 'duration');

    const ends = page.getByRole('textbox', { name: 'Ends' });
    await ends.fill('later');
    await ends.blur();

    // The text stays put with the reason beside it, rather than being dropped
    // on the floor and leaving the old value looking accepted.
    await expect(ends).toHaveValue('later');
    await expect(page.getByText('Use a time like 17:30')).toBeVisible();

    await ends.fill('21:00');
    await ends.blur();
    await expect(page.getByText('Duration: 7 hr 45 min')).toBeVisible();

    // Reloaded, so both the derived end and the human-readable duration come
    // from what was stored rather than local input state.
    await page.reload();
    await editEvent(page, 'Tea ceremony');
    await expect(page.getByRole('textbox', { name: 'Ends' })).toHaveValue('21:00');
    await expect(page.getByText('Duration: 7 hr 45 min')).toBeVisible();
  });

  test('a time zone is searched by IANA name inside the time field', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Tea ceremony');
    await editEvent(page, 'Tea ceremony');
    await reveal(page, 'when');

    await page.getByRole('button', { name: 'Time zone: Asia/Tokyo' }).click();
    const search = page.getByRole('searchbox', { name: 'Search time zone' });
    await search.fill('Japan/Kyoto');
    await expect(page.getByText('No matching time zone.')).toBeVisible();

    await search.fill('London');
    await page.getByRole('option', { name: /Europe\/London/ }).click();
    await expect(page.getByRole('button', { name: 'Time zone: Europe/London' })).toBeVisible();
  });
});

test.describe('searching', () => {
  test('a search that finds nothing says so', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');

    const search = page.getByRole('combobox', { name: 'Search this trip' });
    await search.fill('Fushimi');
    await expect(page.getByRole('option').first()).toContainText('Fushimi Inari');

    await search.fill('zzzzz');
    await expect(page.getByRole('listbox', { name: 'Search results' })).toContainText(
      'Nothing matches',
    );
    await expect(page.getByRole('option')).toHaveCount(0);
  });

  test('results are reachable from the keyboard alone', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');

    const search = page.getByRole('combobox', { name: 'Search this trip' });
    await search.fill('Fushimi');

    // Whatever the field says is selected has to be the row that is
    // highlighted, or a screen reader reads out one thing while Enter takes
    // you to another.
    const first = page.getByRole('option').first();
    const selected = await first.getAttribute('id');
    expect(await search.getAttribute('aria-activedescendant')).toBe(selected);

    await search.press('Enter');
    await expect(page.getByTestId('event-details')).toBeVisible();
  });

  test('a phone searches from a drawer at the bottom, not a row at the top', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');

    // No field in the header: the itinerary has that row back.
    await expect(page.getByRole('combobox', { name: 'Search this trip' })).toHaveCount(0);

    const opener = page.getByTestId('open-drawer');
    const list = page.getByTestId('day-list-scroll');

    // The bar is in the layout rather than over it, so the day list ends above
    // it instead of running underneath.
    const listBox = (await list.boundingBox())!;
    const openerBox = (await opener.boundingBox())!;
    expect(openerBox.y).toBeGreaterThanOrEqual(listBox.y + listBox.height);

    await opener.click();
    await expect(page.getByTestId('trip-drawer')).toBeVisible();

    // Typing goes straight into the field the drawer opened for.
    await page.keyboard.type('Fushimi');
    const search = page.getByRole('combobox', { name: 'Search this trip' });
    await expect(search).toHaveValue('Fushimi');

    await page.getByRole('option').first().click();

    // Picking a result puts the drawer away, leaving what it went to in view.
    await expect(page.getByTestId('trip-drawer')).toHaveCount(0);
    await expect(page.getByTestId('event-details')).toBeVisible();
  });

  test('dragging the bar up brings the header controls within reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await newTrip(page);

    // The phone header keeps the name and whether it is saved. Everything else
    // that was along the top is in the drawer.
    await expect(page.getByRole('heading', { name: 'Japan, April' })).toBeVisible();
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add event' })).toHaveCount(0);

    // Except the calendar switcher, which is asked for too often to be a drawer
    // away. A letter each is all the room the name leaves it.
    await expect(page.getByRole('radiogroup', { name: 'Calendar view' })).toHaveText('DWM');

    await switchView(page, 'Week');
    await expect(page.locator('main')).toHaveAttribute('data-view', 'week');
    await switchView(page, 'Day');
    await expect(page.locator('main')).toHaveAttribute('data-view', 'day');

    const opener = page.getByTestId('open-drawer');
    const bar = (await opener.boundingBox())!;

    async function drag(fromY: number, toY: number) {
      await page.mouse.move(bar.x + bar.width / 2, fromY);
      await page.mouse.down();
      await page.mouse.move(bar.x + bar.width / 2, (fromY + toY) / 2, { steps: 4 });
      await page.mouse.move(bar.x + bar.width / 2, toY, { steps: 4 });
      await page.mouse.up();
    }

    await drag(bar.y + bar.height / 2, bar.y - 120);

    const drawer = page.getByTestId('trip-drawer');
    await expect(drawer).toBeVisible();
    await expect(page.getByTestId('drawer-controls')).toBeVisible();

    // Dragged open rather than tapped, so the drawer is not asking to be typed
    // into and the keyboard stays down.
    await expect(page.getByRole('combobox', { name: 'Search this trip' })).not.toBeFocused();

    // Pulling it back down by its top edge closes it again.
    const top = (await drawer.boundingBox())!.y;
    await drag(top + 30, top + 230);
    await expect(drawer).toHaveCount(0);

    // The controls do what the header's did, and the drawer goes when one is used.
    await drag(bar.y + bar.height / 2, bar.y - 120);
    await page.getByRole('button', { name: 'Add event' }).click();
    await expect(drawer).toHaveCount(0);
    await expect(page.getByTestId('event-editor')).toBeVisible();
  });

  test('every screen of the trip has the same drawer', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await newTrip(page);

    await goToScreen(page, 'To-dos');
    await expect(page.getByRole('heading', { name: 'To-dos', exact: true })).toBeVisible();

    // Nothing of this screen's own to search, so the bar opens on the controls.
    await page.getByTestId('open-drawer').click();
    await expect(page.getByTestId('trip-drawer')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search this trip' })).toHaveCount(0);

    // The screen being read says so, and the others are one tap away.
    await expect(page.getByRole('link', { name: 'To-dos', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByRole('link', { name: 'Files', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.getByTestId('trip-drawer')).toHaveCount(0);

    await goToScreen(page, 'Itinerary');
    await expect(page.getByTestId('go-to-date')).toBeVisible();
  });
});

test.describe('a day decided before an hour', () => {
  test('picking a date does not invent a time', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Ryokan');
    await editEvent(page, 'Ryokan');
    await reveal(page, 'when');

    await page.getByTestId('event-date').fill('2026-09-03');

    // The day is decided and the hour is not, and both the card and the field
    // say so. A 12:00 here reads as a booking somebody made.
    const editor = page.getByTestId('event-editor');
    await expect(editor.getByRole('textbox', { name: 'Time' })).toHaveValue('');
    await expect(editor.getByText('The day is enough')).toBeVisible();
    await expect(eventRow(page, 'Ryokan')).toContainText('--:--');

    // It sits on its day all the same, above the hours rather than inside them.
    await page.getByTestId('go-to-date').fill('2026-09-03');
    await switchView(page, 'Week');
    await expect(page.getByTestId('week-untimed-event')).toContainText('Ryokan');
    await expect(page.getByTestId('week-event')).toHaveCount(0);
  });

  test('a time given, then taken away, leaves the day behind', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Ryokan');
    await editEvent(page, 'Ryokan');
    await reveal(page, 'when');

    await page.getByTestId('event-date').fill('2026-09-03');
    const time = page.getByRole('textbox', { name: 'Time' });
    await time.fill('15:00');
    await time.blur();
    await expect(eventRow(page, 'Ryokan')).toContainText('15:00');

    await time.fill('');
    await time.blur();
    await expect(eventRow(page, 'Ryokan')).toContainText('--:--');
    await expect(page.getByTestId('event-date')).toHaveValue('2026-09-03');
  });

  test('setting a date keeps the fields that were opened for it', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Ryokan');
    await editEvent(page, 'Ryokan');

    await reveal(page, 'when');
    await reveal(page, 'city');
    await reveal(page, 'duration');

    // Setting the date moves the event to another day's section, which used to
    // take every empty field on screen with it.
    await page.getByTestId('event-date').fill('2026-09-03');

    const editor = page.getByTestId('event-editor');
    await expect(editor.getByTestId('field-city')).toBeVisible();
    await expect(editor.getByTestId('field-duration')).toBeVisible();
  });
});

test.describe('taking something back', () => {
  test('a deleted event can be put back from the message that says it went', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');
    await editEvent(page, 'Fushimi Inari');

    await page.getByRole('button', { name: 'Delete event' }).click();
    await expect(eventRow(page, 'Fushimi Inari')).toHaveCount(0);

    const undo = page.getByTestId('undo-bar');
    await expect(undo).toContainText('Deleted Fushimi Inari');

    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
    await expect(page.getByTestId('undo-bar')).toHaveCount(0);
  });
});

test.describe('text a field will not take', () => {
  test('emptying a name says why instead of quietly restoring it', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');
    // One click opens the event; a double-click on its name goes straight to
    // the compact inline name editor.
    await eventRow(page, 'Fushimi Inari').getByTestId('event-name').dblclick();
    const name = page.getByRole('textbox', { name: 'Name' });
    await name.fill('');
    await name.blur();

    await expect(page.getByText('An event needs a name')).toBeVisible();
    await expect(name).toHaveValue('');
  });

  test('a link has to be a web address, and a bare host becomes one', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');
    await editEvent(page, 'Fushimi Inari');
    await reveal(page, 'links');

    const editor = page.getByTestId('event-editor');
    await editor.getByRole('textbox', { name: 'Address' }).fill('not a link');
    await editor.getByRole('button', { name: 'Add link' }).click();
    await expect(editor.getByText('no site in it')).toBeVisible();

    // A host on its own is what people type, so it is completed rather than
    // turned into a link to a page of this app that does not exist.
    await editor.getByRole('textbox', { name: 'Address' }).fill('inari.jp/access');
    await editor.getByRole('button', { name: 'Add link' }).click();
    await expect(editor.getByRole('link', { name: 'https://inari.jp/access' })).toBeVisible();
  });
});

test.describe('trips you cannot open', () => {
  test('an address that names no trip says so instead of opening an editor', async ({ page }) => {
    await page.goto('/t/t_nosuchtripatall');

    await expect(page.getByTestId('no-access')).toContainText('not here');

    // Nothing to type into, because nothing typed would ever be saved.
    await expect(page.getByRole('button', { name: 'Add event' })).toHaveCount(0);
  });

  test('a trip you have been removed from says that, not that it is missing', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const tripId = await newTrip(page);

    const token = await page.evaluate(async (id) => {
      const res = await fetch(`/api/trips/${id}/share`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'editor' }),
      });
      return ((await res.json()) as { token: string }).token;
    }, tripId);

    const other = await browser.newContext();
    const guest = await other.newPage();
    await guest.goto(`/join/${token}`);
    await expect(guest.getByRole('button', { name: 'Add event' })).toBeVisible();

    await page.getByRole('button', { name: 'Share trip' }).click();
    const panel = page.getByTestId('share-panel');
    await panel.getByRole('button', { name: 'Remove' }).click();

    await guest.reload();
    await expect(guest.getByTestId('no-access')).toContainText('Your access was removed');

    await other.close();
  });

  test('a list that could not be fetched falls back to the one saved here', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await newTrip(page);

    await page.goto('/');
    await expect(page.getByText('Japan, April')).toBeVisible();

    // The shell has to be cached before the network goes, or the reload below
    // fails to navigate at all and tests nothing about the list.
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);
    await page.reload();

    // The saved list stands in, so the trip is reachable and the screen never
    // claims there are none -- which would send somebody off to make the trip
    // they already have.
    await expect(page.getByTestId('trips-from-cache')).toBeVisible();
    await expect(page.getByText('Japan, April')).toBeVisible();
    await expect(page.getByText('No trips yet')).toHaveCount(0);

    // Back online, the freshly fetched list replaces the saved one.
    await context.setOffline(false);
    await page.reload();
    await expect(page.getByTestId('trips-from-cache')).toHaveCount(0);
    await expect(page.getByText('Japan, April')).toBeVisible();
  });
});

test.describe('reaching things with a finger', () => {
  test('a week day can be added to without dragging', { tag: '@touch' }, async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await switchView(page, 'Week');

    /*
     * A day chosen on purpose, so this does not depend on where the week
     * happens to open -- the trip's day and the day where the test runs are
     * not the same date on either side of midnight.
     */
    const today = await page.getByTestId('go-to-date').inputValue();

    // Dragging down a column is how the week is scrolled with a finger, so the
    // gesture cannot also create. This is what it gets instead.
    await page.getByTestId(`week-add-${today}`).click();

    const draft = page.getByTestId('week-event-draft');
    const name = draft.getByRole('textbox', { name: 'Event name' });
    await expect(name).toBeFocused();
    await name.fill('Dinner');
    await name.press('Enter');

    await expect(page.locator('main')).toHaveAttribute('data-view', 'week');
    await expect(page.getByTestId('event-editor')).toHaveCount(0);
    await page.getByTestId('week-untimed-event').filter({ hasText: 'Dinner' }).click();

    await expect(page.locator('main')).toHaveAttribute('data-view', 'day');
    await editEvent(page, 'Dinner');
    await expect(page.getByTestId('event-date')).toHaveValue(today);
  });

  test(
    'a long editor can be closed from where it ends',
    { tag: '@responsive' },
    async ({ page }) => {
      await page.goto('/');
      await newTrip(page);

      await addNewEvent(page, 'Fushimi Inari');
      await editEvent(page, 'Fushimi Inari');

      // Enough fields open that the editor is taller than the screen, which is
      // the state the complaint is about.
      for (const field of ['when', 'duration', 'city', 'place', 'confirmation', 'links']) {
        await reveal(page, field);
      }

      // Scrolled to the top of the editor: the card header is the other way out,
      // and from here it is several screens up.
      await page.getByTestId('event-name').scrollIntoViewIfNeeded();

      const done = page.getByTestId('close-editor');
      await expect(done).toBeInViewport();
      await done.click();
      await expect(page.getByTestId('event-editor')).toHaveCount(0);
    },
  );
});

test.describe('a stay', () => {
  test('check-in and check-out are dates, read where the hotel is', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Ryokan');
    await editEvent(page, 'Ryokan');
    await page.getByTestId('event-kind-button').click();
    await page
      .getByRole('dialog', { name: 'Event kind' })
      .getByRole('button', { name: 'Stay' })
      .click();

    // Stay dates are the canonical event schedule, so duplicate generic date
    // and duration controls cannot disagree with them.
    await expect(page.getByTestId('event-date')).toHaveCount(0);
    await expect(page.getByTestId('field-duration')).toHaveCount(0);

    // A text box built the instant at 15:00 UTC, which is the small hours of
    // the next day in Tokyo: the stay was drawn on the wrong nights.
    await page.getByTestId('check-in').fill('2026-08-14');
    await expect(page.getByTestId('day-heading-2026-08-14')).toBeVisible();
    await expect(eventRow(page, 'Ryokan')).toContainText('15:00');
    await page.getByTestId('check-out').fill('2026-08-12');
    await expect(page.getByText('leaving before you arrive')).toBeVisible();

    await page.getByTestId('check-out').fill('2026-08-17');
    await expect(page.getByText('leaving before you arrive')).toHaveCount(0);

    // Read back in the hotel's zone, which is what was typed.
    await page.reload();
    await editEvent(page, 'Ryokan');
    await expect(page.getByTestId('check-in')).toHaveValue('2026-08-14');
    await expect(page.getByTestId('check-out')).toHaveValue('2026-08-17');

    // Consecutive hotels share one rail instead of each consuming another
    // stacked row beneath the timetable.
    await page.getByTestId('close-editor').click();
    await addNewEvent(page, 'City Hotel');
    await editEvent(page, 'City Hotel');
    await page.getByTestId('event-kind-button').click();
    await page
      .getByRole('dialog', { name: 'Event kind' })
      .getByRole('button', { name: 'Stay' })
      .click();
    await page.getByTestId('check-in').fill('2026-08-17');
    await page.getByTestId('check-out').fill('2026-08-19');
    await page.getByTestId('close-editor').click();

    await switchView(page, 'Week');
    const hotels = page.getByTestId('week-lodging');
    await expect(hotels).toHaveCount(2);
    await expect(page.getByTestId('week-event')).toHaveCount(0);
    await expect(page.getByTestId('week-untimed-event')).toHaveCount(0);
    const tops = await hotels.evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);

    // The stay rail ends above the horizontal scrollbar instead of letting the
    // scrollbar draw across the hotel controls and their names.
    const scrollerBox = await page.getByTestId('week-horizontal-scroll').boundingBox();
    const hotelBox = await hotels.first().boundingBox();
    if (!scrollerBox || !hotelBox) throw new Error('no lodging rail bounds');
    expect(hotelBox.y + hotelBox.height).toBeLessThanOrEqual(
      scrollerBox.y + scrollerBox.height - 12,
    );
  });
});

test.describe('a flight', () => {
  async function newFlight(page: Page) {
    await addNewEvent(page, 'NH017');
    await editEvent(page, 'NH017');
    await page.getByTestId('event-kind-button').click();
    await page
      .getByRole('dialog', { name: 'Event kind' })
      .getByRole('button', { name: 'Transit' })
      .click();
    // A flight is the transit method with the per-airport editor.
    await page
      .getByTestId('event-editor')
      .getByTestId('transit-method')
      .getByText('Flight', { exact: true })
      .click();
  }

  test('asks for the departure date rather than assuming today', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);
    await newFlight(page);

    const editor = page.getByTestId('event-editor');
    const departs = editor.getByRole('textbox', { name: /Departs/ });
    await departs.fill('17:05');
    await departs.blur();

    // Typing a time first used to put the flight on today, whatever day the
    // ticket says, with nothing on screen to show it had guessed.
    await expect(editor.getByText('Pick the departure date first')).toBeVisible();

    await editor.getByTestId('departs-date').fill('2026-08-14');
    await departs.fill('17:05');
    await departs.blur();
    await expect(editor.getByText('Pick the departure date first')).toHaveCount(0);
    await expect(editor.getByTestId('departs-date')).toHaveValue('2026-08-14');
  });

  test('an arrival has a date of its own, so a long flight needs no trick', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);
    await newFlight(page);

    const editor = page.getByTestId('event-editor');
    await editor.getByTestId('departs-date').fill('2026-08-14');
    await editor.getByRole('textbox', { name: /Departs/ }).fill('17:05');
    await editor.getByRole('textbox', { name: /Departs/ }).blur();

    // An hour before departure means the next morning, and the date beside it
    // now shows which morning rather than leaving the roll invisible.
    await editor.getByRole('textbox', { name: /Arrives/ }).fill('09:20');
    await editor.getByRole('textbox', { name: /Arrives/ }).blur();
    await expect(editor.getByTestId('arrives-date')).toHaveValue('2026-08-15');

    // Two days out is set on the date, not worked around.
    await editor.getByTestId('arrives-date').fill('2026-08-16');
    await expect(editor.getByTestId('arrives-date')).toHaveValue('2026-08-16');

    // Landing before take-off is refused where it was typed.
    await editor.getByTestId('arrives-date').fill('2026-08-13');
    await expect(editor.getByText('before the flight leaves')).toBeVisible();
  });
});

test.describe('the map and the forecast', () => {
  test('coordinates copied from Google Maps can pin a hand-written place', async ({ page }) => {
    await page.route('**/api/places/search*', (route) => route.fulfill({ json: { places: [] } }));

    await page.goto('/');
    await newTrip(page);
    await addNewEvent(page, 'Byodo-in');
    await editEvent(page, 'Byodo-in');
    await reveal(page, 'place');

    const place = page.getByRole('combobox', { name: 'Place' });
    await place.fill('Byodo-in Temple');
    await page.getByRole('button', { name: 'Add coordinates' }).click();

    const dialog = page.getByRole('dialog', { name: 'Coordinates' });
    const coordinates = dialog.getByRole('textbox', { name: 'Latitude, longitude' });

    await coordinates.fill('91, 135.80448560871287');
    await dialog.getByRole('button', { name: 'Save coordinates' }).click();
    await expect(dialog.getByText('Latitude must be between -90 and 90.')).toBeVisible();

    await coordinates.fill('34.891549790773766, 135.80448560871287');
    await dialog.getByRole('button', { name: 'Save coordinates' }).click();

    await expect(
      page.getByRole('button', {
        name: 'Coordinates: 34.891549790773766, 135.80448560871287',
      }),
    ).toBeVisible();
    await expect(page.getByText('Pinned at 34.8915, 135.8045')).toBeVisible();

    // The pair is part of the event, not state held only by the popover.
    await page.getByTestId('close-editor').click();
    await editEvent(page, 'Byodo-in');
    await expect(
      page.getByRole('button', {
        name: 'Coordinates: 34.891549790773766, 135.80448560871287',
      }),
    ).toBeVisible();
  });

  test('a place has a way through to Google Maps', async ({ page }) => {
    await page.route('**/api/places/search*', (route) => route.fulfill({ json: { places: [] } }));

    await page.goto('/');
    await newTrip(page);
    await addNewEvent(page, 'Sanjusangendo');
    await editEvent(page, 'Sanjusangendo');
    await reveal(page, 'place');

    const place = page.getByRole('combobox', { name: 'Place' });
    await place.fill('Sanjusangendo Temple');
    await place.blur();

    // Done hands the card back to its details, which is where the link is.
    await page.getByTestId('close-editor').click();

    const maps = page.getByTestId('open-in-maps');
    await expect(maps).toHaveAttribute(
      'href',
      'https://www.google.com/maps/search/?api=1&query=Sanjusangendo%20Temple',
    );
    await expect(maps).toHaveAttribute('target', '_blank');

    /*
     * A place written down as a Maps link is followed as it stands. Handing it
     * to a search would look for the address of the link rather than for the
     * place the link points at.
     */
    const shared = 'https://maps.app.goo.gl/QwErTy123';
    await editEvent(page, 'Sanjusangendo');
    await place.fill(shared);
    await place.blur();
    await page.getByTestId('close-editor').click();

    await expect(maps).toHaveAttribute('href', shared);
  });

  test('moving a pinned place moves its pin', async ({ page }) => {
    /*
     * The geocoder is stubbed. What is being tested is what the map does with
     * coordinates, and a test that also depends on a public service answering
     * fails for reasons that have nothing to do with this app.
     */
    await page.route('**/api/places/search*', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q') ?? '';
      const match = query.toLowerCase().includes('osaka')
        ? { label: 'Osaka Castle', lat: 34.6873, lng: 135.5259 }
        : { label: 'Kyoto Station', lat: 34.9858, lng: 135.7588 };

      await route.fulfill({ json: { places: [match] } });
    });

    await page.goto('/');
    await newTrip(page);

    /*
     * A day chosen on purpose. Reading whichever day the view opened on races
     * the opening guess, which moves once the trip stops being empty.
     */
    const anchored = '2026-09-03';
    await page.getByTestId('go-to-date').fill(anchored);

    async function pin(name: string, query: string, day = anchored) {
      await addNewEvent(page, name);
      await editEvent(page, name);

      // On the day the map is showing, which is the day the view is anchored
      // on -- and that is the trip's day, not necessarily today.
      await reveal(page, 'when');
      await page.getByTestId('event-date').fill(day);

      await reveal(page, 'place');
      await page.getByRole('combobox', { name: 'Place' }).fill(query);
      await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('option').first().click();
      await expect(page.getByText('Pinned at')).toBeVisible();

      // Shut, not merely handed back to its details: the click below is what
      // moves the map to this event's day, and a click on an open card closes
      // it instead.
      await closeEvent(page, name);
    }

    await pin('Fushimi Inari', 'Kyoto Station');
    await pin('Nishiki Market', 'Kyoto Station');

    // Two pins on the same spot sit on top of each other.
    const pins = page.locator('.leaflet-marker-icon');
    await expect(pins).toHaveCount(2);
    const before = await pins.nth(0).boundingBox();
    expect((await pins.nth(1).boundingBox())!.x).toBeCloseTo(before!.x, 0);

    // Focusing a card on another day also moves the map to that day.
    await pin('Osaka lunch', 'Osaka Castle', '2026-09-04');
    await expect(pins).toHaveCount(2);
    await eventRow(page, 'Osaka lunch').click();
    await expect(pins).toHaveCount(1);
    await expect(pins.first()).toHaveAttribute('title', 'Osaka lunch');

    // The map used to redraw only when an id or a booking state changed, so a
    // place moved to another city left its marker where it was.
    await editEvent(page, 'Nishiki Market');
    await expect(page.getByTestId('go-to-date')).toHaveValue(anchored);
    const place = page.getByTestId('event-editor').getByRole('combobox', { name: 'Place' });
    await place.fill('Osaka Castle');
    await expect(place).toHaveValue('Osaka Castle');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('option').first().click();

    await expect(async () => {
      const first = await pins.nth(0).boundingBox();
      const second = await pins.nth(1).boundingBox();
      expect(Math.abs(first!.x - second!.x)).toBeGreaterThan(40);
    }).toPass({ timeout: 10_000 });
  });
});

test.describe('who is on a trip', () => {
  test('members are told apart, and can be moved between reading and editing', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    const tripId = await newTrip(page);

    await page.getByRole('button', { name: 'Share trip' }).click();
    const panel = page.getByTestId('share-panel');

    // A link that runs out, which the server has always taken and the panel
    // never offered.
    await panel.getByTestId('link-lifetime').selectOption('7');
    await panel.getByRole('button', { name: 'Make a link' }).click();
    const url = await panel.getByTestId('share-url').textContent();
    await expect(panel.getByText(/runs out/)).toBeVisible();

    const other = await browser.newContext();
    const guest = await other.newPage();
    await guest.goto(url!);
    await expect(guest.getByRole('heading', { name: 'Japan, April' })).toBeVisible();

    // Everyone anonymous used to be called "Someone", so an owner could not
    // tell whose access they were about to remove.
    const role = panel.locator('[data-testid^="member-role-"]');
    await expect(role).toHaveCount(1);
    await expect(panel.getByText('Someone')).toHaveCount(0);

    // A reader becomes an editor without being removed and invited again.
    await role.selectOption('viewer');
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'Add event' })).toHaveCount(0);

    await role.selectOption('editor');
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'Add event' })).toBeVisible();

    await other.close();
    void tripId;
  });
});

test.describe('a trip is more than its name', () => {
  test('the name and the zone can be changed after it is made', async ({ page }) => {
    await page.goto('/');
    const tripId = await newTrip(page);

    await page.goto(`/t/${tripId}/fields`);

    // Neither could be changed once a trip existed, though the zone decides
    // which day every event is grouped under.
    const name = page.getByRole('textbox', { name: 'Trip name' });
    await name.fill('Kyoto in autumn');
    await name.blur();

    const zone = page.getByRole('combobox', { name: 'Home time zone' });
    await zone.fill('Not/AZone');
    await zone.blur();
    await expect(page.getByText('Not a time zone')).toBeVisible();

    await zone.fill('Europe/Lisbon');
    await zone.blur();

    await page.goto('/');
    await expect(page.getByText('Kyoto in autumn')).toBeVisible();
  });

  test('a trip can be put away, and deleted for everybody', async ({ page }) => {
    await page.goto('/');
    const tripId = await newTrip(page);
    await page.goto(`/t/${tripId}/fields`);

    await page.getByTestId('archive-trip').click();
    await expect(page.getByRole('button', { name: 'Put back in the list' })).toBeVisible();

    // Deleting asks first, because there is no way back from it.
    await page.getByRole('button', { name: 'Delete this trip' }).click();
    await page.getByTestId('confirm-delete-trip').click();

    await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();
    await page.goto(`/t/${tripId}`);
    await expect(page.getByTestId('no-access')).toContainText('not here');
  });

  test('a card says when the trip runs and what is next', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Fushimi Inari');
    await editEvent(page, 'Fushimi Inari');
    await reveal(page, 'when');
    await page.getByTestId('event-date').fill('2027-04-14');
    await reveal(page, 'city');
    await page.getByRole('textbox', { name: 'City' }).fill('Kyoto');
    await page.getByRole('textbox', { name: 'City' }).blur();
    await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });

    // A name and a role made two trips called Japan the same card twice.
    await page.goto('/');
    const card = page.getByRole('link', { name: /Japan, April/ });
    await expect(card).toContainText('14 Apr');
    await expect(card).toContainText('Kyoto');
    await expect(card).toContainText('Next on 14 Apr');
  });
});

test.describe('days and what has none', () => {
  test('moving the navigation moves the itinerary too', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    async function addOn(day: string, name: string) {
      await page.getByTestId('go-to-date').fill(day);
      await page.getByTestId(`add-on-${day}`).click();

      const field = page.getByRole('textbox', { name: 'Name' });
      await field.fill(name);
      await field.blur();
      await page.getByTestId('close-editor').click();
      await expect(page.getByTestId('event-editor')).toHaveCount(0);
    }

    await addOn('2026-09-03', 'Later day');
    await addOn('2026-09-10', 'Latest day');

    // Earlier and Later used to move the map and the label while the list
    // stayed where it was, so they looked as though they did nothing.
    await page.getByTestId('go-to-date').fill('2026-09-03');
    await expect(eventRow(page, 'Later day')).toBeInViewport();

    await page.getByTestId('go-to-date').fill('2026-09-10');
    await expect(eventRow(page, 'Latest day')).toBeInViewport();

    // The list moves, and nothing else does. Scrolling a section into view by
    // asking the browser walked up past the list and carried the app header
    // off the top of the window.
    await expect(page.getByRole('banner')).toBeInViewport();
  });

  test('events with no date are offered by the week and the month', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Book the ryokan');
    await expect(eventRow(page, 'Book the ryokan')).toBeVisible();

    for (const view of ['Week', 'Month'] as const) {
      await switchView(page, view);

      // Both views are drawn from dates, so an event without one was
      // invisible in them and nothing said it was waiting.
      const tray = page.getByTestId('unscheduled-tray');
      await expect(tray).toContainText('1 with no date yet');
      await expect(tray.getByTestId('unscheduled-item')).toContainText('Book the ryokan');
    }
  });
});

test.describe('custom fields', () => {
  test('a field name is not taken twice, and a currency is three letters', async ({ page }) => {
    await page.goto('/');
    const tripId = await newTrip(page);
    await page.goto(`/t/${tripId}/fields`);

    // Exact: "Trip name" in the Basics card above also contains "name".
    const name = page.getByRole('textbox', { name: 'Name', exact: true }).first();
    await name.fill('Cost');
    await page.getByRole('combobox', { name: 'Field type' }).selectOption('money');
    await page.getByRole('button', { name: 'Add field' }).click();

    // Two fields with one name are indistinguishable on a card and in search.
    await name.fill('cost');
    await page.getByRole('button', { name: 'Add field' }).click();
    await expect(page.getByText('already a field called')).toBeVisible();

    // The hint said three letters and the box took anything.
    const currency = page.getByRole('textbox', { name: 'Currency' });
    await currency.fill('yen please');
    await currency.blur();
    await expect(page.getByText('Three letters, like JPY')).toBeVisible();

    await currency.fill('jpy');
    await currency.blur();
    await expect(page.getByText('Three letters, like JPY')).toHaveCount(0);
  });

  test('a choice cannot be added twice', async ({ page }) => {
    await page.goto('/');
    const tripId = await newTrip(page);
    await page.goto(`/t/${tripId}/fields`);

    await page.getByRole('textbox', { name: 'Name', exact: true }).first().fill('Dress code');
    await page.getByRole('combobox', { name: 'Field type' }).selectOption('select');
    await page.getByRole('button', { name: 'Add field' }).click();

    const choice = page.getByRole('textbox', { name: 'New choice' });
    for (const value of ['Smart', 'smart']) {
      await choice.fill(value);
      await choice.press('Enter');
    }

    await expect(page.getByRole('button', { name: /^Remove/ })).toHaveCount(1);
  });
});

test.describe('attaching files', () => {
  test('the limit is said up front, and a waiting file can be sent by hand', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addNewEvent(page, 'Ryokan');
    await editEvent(page, 'Ryokan');
    await reveal(page, 'files');

    // Said before a file is chosen rather than after one is refused, and
    // somewhere to drop them.
    const drop = page.getByTestId('attachment-drop');
    await expect(drop).toContainText('Up to 25 MB each');

    /*
     * The server is unreachable rather than the browser being offline. Taking
     * the browser offline and back makes the window fire `online`, which the
     * editor answers by flushing the queue itself -- so the button would be
     * racing the automatic send instead of being the thing that does it.
     */
    const uploads = '**/api/blobs/**';
    await page.route(uploads, (route) => route.abort());
    await page.getByTestId('attachment-input').setInputFiles({
      name: 'booking.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('confirmation'),
    });

    // It waits on the device, and there is something to press about it.
    await expect(page.getByText('Waiting to send')).toBeVisible();
    await page.getByTestId('retry-upload').click();
    await expect(page.getByText('Still waiting')).toBeVisible();

    await page.unroute(uploads);
    await page.getByTestId('retry-upload').click();
    await expect(page.getByText('Waiting to send')).toHaveCount(0);
  });
});
