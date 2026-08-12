import { expect, test, type Page } from '@playwright/test';

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

async function reveal(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  if ((await editor.getByTestId(`add-field-${key}`).count()) === 0) {
    await editor.getByTestId('expand-palette').click();
  }
  await editor.getByTestId(`add-field-${key}`).click();
}

test.describe('putting an event on a chosen day', () => {
  test('a date can be set directly rather than defaulting to today', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Morning temple');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Morning temple').click();
    await reveal(page, 'when');

    // A real date control. Typing a time used to put it on today whatever day
    // was meant, which on a trip planner is the one thing not to guess.
    const date = page.getByTestId('event-date');
    await date.fill('2026-09-03');

    await page.getByTestId('close-editor').click();
    await page.getByTestId('go-to-date').fill('2026-09-03');

    await expect(page.getByTestId('range-label')).toContainText('3 September 2026');
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
      await page
        .getByRole('radiogroup', { name: 'Calendar view' })
        .getByText(view, { exact: true })
        .click();

      await expect(page.getByTestId('go-to-date')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Today' })).toBeVisible();
    }
  });

  test('a mistyped time says so instead of being ignored', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Morning temple');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Morning temple').click();
    await reveal(page, 'when');

    await page.getByTestId('event-date').fill('2026-09-03');

    const time = page.getByRole('textbox', { name: 'Time' });
    await time.fill('nine-ish');
    await time.blur();

    // Keeping the text and saying what is wrong is the difference between a
    // correction and a silent loss.
    await expect(page.getByText('Use a 24-hour time, like 09:00')).toBeVisible();
    await expect(time).toHaveValue('nine-ish');
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Ryokan').click();
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
    await panel.getByRole('radiogroup', { name: 'What the link allows' })
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
    await expect(guest.getByRole('textbox', { name: 'New event' })).toHaveCount(0);

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
  test('a duration must be a number of minutes, and says so when it is not', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Tea ceremony');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Tea ceremony').click();
    await reveal(page, 'duration');

    const duration = page.getByRole('textbox', { name: 'How long' });
    await duration.fill('-30');
    await duration.blur();

    // The text stays put with the reason beside it, rather than being dropped
    // on the floor and leaving the old value looking accepted.
    await expect(duration).toHaveValue('-30');
    await expect(page.getByText('more than zero')).toBeVisible();

    await duration.fill('90');
    await duration.blur();
    await expect(page.getByText('more than zero')).toHaveCount(0);

    // Reloaded, so this reads what was stored rather than what is still on
    // screen: the refused text must not have been kept, and the good one must.
    await page.reload();
    await eventRow(page, 'Tea ceremony').click();
    await expect(page.getByRole('textbox', { name: 'How long' })).toHaveValue('90');
  });

  test('a time zone is searched by IANA name inside the time field', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Tea ceremony');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Tea ceremony').click();
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

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

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    const search = page.getByRole('combobox', { name: 'Search this trip' });
    await search.fill('Fushimi');

    // Whatever the field says is selected has to be the row that is
    // highlighted, or a screen reader reads out one thing while Enter takes
    // you to another.
    const first = page.getByRole('option').first();
    const selected = await first.getAttribute('id');
    expect(await search.getAttribute('aria-activedescendant')).toBe(selected);

    await search.press('Enter');
    await expect(page.getByTestId('event-editor')).toBeVisible();
  });
});

test.describe('a day decided before an hour', () => {
  test('picking a date does not invent a time', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Ryokan').click();
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
    await page
      .getByRole('radiogroup', { name: 'Calendar view' })
      .getByText('Week', { exact: true })
      .click();
    await expect(page.getByTestId('week-untimed-event')).toContainText('Ryokan');
    await expect(page.getByTestId('week-event')).toHaveCount(0);
  });

  test('a time given, then taken away, leaves the day behind', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Ryokan').click();
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Ryokan').click();

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

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Fushimi Inari').click();

    await page.getByRole('button', { name: 'Delete event' }).click();
    await expect(eventRow(page, 'Fushimi Inari')).toHaveCount(0);

    const undo = page.getByTestId('undo-bar');
    await expect(undo).toContainText('Deleted Fushimi Inari');

    await undo.getByRole('button', { name: 'Undo' }).click();
    await expect(eventRow(page, 'Fushimi Inari')).toBeVisible();
    await expect(page.getByTestId('undo-bar')).toHaveCount(0);
  });

  test('deleting a long selection asks first', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    for (const name of ['One', 'Two', 'Three', 'Four']) {
      await page.getByRole('textbox', { name: 'New event' }).fill(name);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(eventRow(page, name)).toBeVisible();
    }

    const boxes = page.getByTestId('event-select');
    for (let index = 0; index < 4; index += 1) await boxes.nth(index).check();

    const bar = page.getByTestId('selection-bar');
    await bar.getByRole('button', { name: 'Delete 4' }).click();

    // Nothing has happened yet: four events is enough to be worth a question.
    await expect(bar).toContainText('Delete 4 events?');
    await expect(page.getByTestId('event')).toHaveCount(4);

    await bar.getByRole('button', { name: 'Keep them' }).click();
    await expect(page.getByTestId('event')).toHaveCount(4);

    await bar.getByRole('button', { name: 'Delete 4' }).click();
    await bar.getByTestId('confirm-bulk-delete').click();
    await expect(page.getByTestId('event')).toHaveCount(0);

    await page.getByTestId('undo-bar').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('event')).toHaveCount(4);
  });
});

test.describe('text a field will not take', () => {
  test('emptying a name says why instead of quietly restoring it', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Fushimi Inari').click();
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
    await expect(page.getByRole('textbox', { name: 'New event' })).toHaveCount(0);
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
    await expect(guest.getByRole('textbox', { name: 'New event' })).toBeVisible();

    await page.getByRole('button', { name: 'Share trip' }).click();
    const panel = page.getByTestId('share-panel');
    await panel.getByRole('button', { name: 'Remove' }).click();

    await guest.reload();
    await expect(guest.getByTestId('no-access')).toContainText('Your access was removed');

    await other.close();
  });

  test('a list that could not be fetched is not an empty list', async ({ page, context }) => {
    await page.goto('/');
    await newTrip(page);

    await page.goto('/');
    await expect(page.getByText('Japan, April')).toBeVisible();

    // The shell has to be cached before the network goes, or the reload below
    // fails to navigate at all and tests nothing about the list.
    await page.evaluate(() => navigator.serviceWorker.ready);

    await context.setOffline(true);
    await page.reload();

    // "No trips yet" here would send somebody off to make the trip they
    // already have.
    await expect(page.getByTestId('trips-unreachable')).toBeVisible();
    await expect(page.getByText('No trips yet')).toHaveCount(0);

    await context.setOffline(false);
    await page.getByTestId('trips-unreachable').getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Japan, April')).toBeVisible();
  });
});

test.describe('reaching things with a finger', () => {
  test('a week day can be added to without dragging', async ({ page }) => {
    test.skip(test.info().project.name === 'desktop', 'A mouse drags the time out instead.');

    await page.goto('/');
    await newTrip(page);

    await page
      .getByRole('radiogroup', { name: 'Calendar view' })
      .getByText('Week', { exact: true })
      .click();

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

    await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
    await expect(page.getByTestId('event-editor')).toHaveCount(0);
    await page.getByTestId('week-untimed-event').filter({ hasText: 'Dinner' }).click();

    await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
    await expect(page.getByTestId('event-editor')).toBeVisible();
    await expect(page.getByTestId('event-date')).toHaveValue(today);
  });

  test('an event can be ticked without hovering it first', async ({ page }) => {
    test.skip(test.info().project.name === 'desktop', 'Hover reveals the box on a desktop.');

    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // Nothing to hover on a phone, so the box has to be there already.
    await expect(page.getByTestId('event-select')).toBeVisible();
    await page.getByTestId('event-select').check();
    await expect(page.getByTestId('selection-bar')).toBeVisible();
  });

  test('a long editor can be closed from where it ends', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Fushimi Inari').click();

    // Enough fields open that the editor is taller than the screen, which is
    // the state the complaint is about.
    for (const field of ['when', 'duration', 'city', 'place', 'booking', 'links']) {
      await reveal(page, field);
    }

    // Scrolled to the top of the editor: the card header is the other way out,
    // and from here it is several screens up.
    await page.getByTestId('event-name').scrollIntoViewIfNeeded();

    const done = page.getByTestId('close-editor');
    await expect(done).toBeInViewport();
    await done.click();
    await expect(page.getByTestId('event-editor')).toHaveCount(0);
  });
});

test.describe('a stay', () => {
  test('check-in and check-out are dates, read where the hotel is', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Ryokan').click();
    await page.getByTestId('event-kind-button').click();
    await page.getByRole('dialog', { name: 'Event kind' }).getByRole('button', { name: 'Stay' }).click();

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
    await eventRow(page, 'Ryokan').click();
    await expect(page.getByTestId('check-in')).toHaveValue('2026-08-14');
    await expect(page.getByTestId('check-out')).toHaveValue('2026-08-17');

    // Consecutive hotels share one rail instead of each consuming another
    // stacked row beneath the timetable.
    await page.getByTestId('close-editor').click();
    await page.getByRole('textbox', { name: 'New event' }).fill('City Hotel');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'City Hotel').click();
    await page.getByTestId('event-kind-button').click();
    await page.getByRole('dialog', { name: 'Event kind' }).getByRole('button', { name: 'Stay' }).click();
    await page.getByTestId('check-in').fill('2026-08-17');
    await page.getByTestId('check-out').fill('2026-08-19');
    await page.getByTestId('close-editor').click();

    await page
      .getByRole('radiogroup', { name: 'Calendar view' })
      .getByText('Week', { exact: true })
      .click();
    const hotels = page.getByTestId('week-lodging');
    await expect(hotels).toHaveCount(2);
    const tops = await hotels.evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
    expect(new Set(tops).size).toBe(1);
  });
});

test.describe('a flight', () => {
  async function newFlight(page: Page) {
    await page.getByRole('textbox', { name: 'New event' }).fill('NH017');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'NH017').click();
    await page.getByTestId('event-kind-button').click();
    await page.getByRole('dialog', { name: 'Event kind' }).getByRole('button', { name: 'Flight' }).click();
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

    async function pin(name: string, query: string) {
      await page.getByRole('textbox', { name: 'New event' }).fill(name);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await eventRow(page, name).click();

      // On the day the map is showing, which is the day the view is anchored
      // on -- and that is the trip's day, not necessarily today.
      await reveal(page, 'when');
      await page.getByTestId('event-date').fill(anchored);

      await reveal(page, 'place');
      await page.getByRole('combobox', { name: 'Place' }).fill(query);
      await expect(page.getByRole('option').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('option').first().click();
      await expect(page.getByText('Pinned at')).toBeVisible();

      await page.getByTestId('close-editor').click();
    }

    await pin('Fushimi Inari', 'Kyoto Station');
    await pin('Nishiki Market', 'Kyoto Station');

    // Two pins on the same spot sit on top of each other.
    const pins = page.locator('.leaflet-marker-icon');
    await expect(pins).toHaveCount(2);
    const before = await pins.nth(0).boundingBox();
    expect((await pins.nth(1).boundingBox())!.x).toBeCloseTo(before!.x, 0);

    // The map used to redraw only when an id or a booking state changed, so a
    // place moved to another city left its marker where it was.
    await eventRow(page, 'Nishiki Market').click();
    await page.getByRole('combobox', { name: 'Place' }).fill('Osaka Castle');
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
    await expect(guest.getByRole('textbox', { name: 'New event' })).toHaveCount(0);

    await role.selectOption('editor');
    await guest.reload();
    await expect(guest.getByRole('textbox', { name: 'New event' })).toBeVisible();

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

    await page.getByRole('textbox', { name: 'New event' }).fill('Fushimi Inari');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Fushimi Inari').click();
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

    await page.getByRole('textbox', { name: 'New event' }).fill('Book the ryokan');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(eventRow(page, 'Book the ryokan')).toBeVisible();

    for (const view of ['Week', 'Month'] as const) {
      await page
        .getByRole('radiogroup', { name: 'Calendar view' })
        .getByText(view, { exact: true })
        .click();

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
