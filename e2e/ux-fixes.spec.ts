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

    await page.locator('[data-testid="event"][aria-expanded="true"]').click();
    await page.getByTestId('go-to-date').fill('2026-09-03');

    await expect(page.getByTestId('range-label')).toContainText('3 September 2026');
    await expect(eventRow(page, 'Morning temple')).toBeVisible();
  });

  test('a day with nothing on it can still be added to', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByTestId('go-to-date').fill('2026-09-03');
    await page.getByTestId('add-on-2026-09-03').click();

    const name = page.getByTestId('event-editor').getByRole('textbox', { name: 'Name' });
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

    const time = page.getByRole('textbox', { name: /Time \(/ });
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
    await expect(guest.getByTestId('event')).toHaveCount(0);
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

  test('a time zone has to be one the browser knows', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await page.getByRole('textbox', { name: 'New event' }).fill('Tea ceremony');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await eventRow(page, 'Tea ceremony').click();
    await reveal(page, 'timezone');

    const zone = page.getByRole('combobox', { name: 'Time zone' });
    await zone.fill('Japan/Kyoto');
    await zone.blur();
    await expect(page.getByText('Not a time zone')).toBeVisible();

    await zone.fill('Asia/Osaka');
    await zone.blur();
    await expect(page.getByText('Not a time zone')).toBeVisible();

    await zone.fill('Asia/Tokyo');
    await zone.blur();
    await expect(page.getByText('Not a time zone')).toHaveCount(0);
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
    await expect(editor.getByRole('textbox', { name: /Time \(/ })).toHaveValue('');
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
    const time = page.getByRole('textbox', { name: /Time \(/ });
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
    await eventRow(page, 'Fushimi Inari').click();

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
