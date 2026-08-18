import { expect, test, type Page } from '@playwright/test';
import { addNewEvent, editEvent, switchView } from './helpers';

/*
 * The rest of the suite runs on en-GB, which reads times as 24 hours. This file
 * runs the same app for somebody whose device reads them as twelve, which is
 * most of the United States, and checks that the app reads and writes the clock
 * they are looking at rather than making them convert.
 */
test.use({ locale: 'en-US' });

/** A fixed Wednesday, so a test never depends on which day it is run. */
const ON = '2026-08-12';

async function newTrip(page: Page, name: string) {
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

async function revealField(page: Page, key: string) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId(`field-${key}`).count()) > 0) return;

  const chip = editor.getByTestId(`add-field-${key}`);
  const more = editor.getByTestId('expand-palette');

  await expect(chip.or(more).first()).toBeVisible();

  if ((await chip.count()) === 0) await more.click();
  await chip.click();
}

/** Opens an event's date and time fields, having given it a day to be on. */
async function openWhen(page: Page, name: string) {
  await addNewEvent(page, name);
  await editEvent(page, name);

  const editor = page.getByTestId('event-editor');
  await expect(editor).toHaveCount(1);
  await revealField(page, 'when');
  await editor.getByTestId('event-date').fill(ON);

  return page.getByTestId('event-editor');
}

test('a time typed with an AM or PM is kept and shown back that way', async ({ page }) => {
  await page.goto('/');
  await newTrip(page, 'Japan, August');

  const editor = await openWhen(page, 'Fushimi Inari');
  const time = editor.getByRole('textbox', { name: 'Time' });

  // A bare hour with a PM on it is a whole time, so nothing is half-typed and
  // the field takes it.
  await time.fill('9 PM');
  await time.blur();

  await expect(page.getByRole('textbox', { name: 'Time' })).toHaveValue(/^9:00\sPM$/);

  // Stored as a moment rather than as the text that was typed, so it survives
  // the round trip through the document.
  await page.reload();
  await editEvent(page, 'Fushimi Inari');
  await expect(page.getByRole('textbox', { name: 'Time' })).toHaveValue(/^9:00\sPM$/);
});

test('a 24-hour time is still understood, and shown back on a twelve-hour clock', async ({
  page,
}) => {
  await page.goto('/');
  await newTrip(page, 'Japan, August');

  const editor = await openWhen(page, 'Nishiki Market');
  const time = editor.getByRole('textbox', { name: 'Time' });

  await time.fill('13:15');
  await time.blur();

  await expect(page.getByRole('textbox', { name: 'Time' })).toHaveValue(/^1:15\sPM$/);
});

test('the time on a card and on the week axis reads as twelve hours', async ({ page }) => {
  await page.goto('/');
  await newTrip(page, 'Japan, August');

  const editor = await openWhen(page, 'Fushimi Inari');
  await editor.getByRole('textbox', { name: 'Time' }).fill('9:00 AM');
  await editor.getByRole('textbox', { name: 'Time' }).blur();
  await page.getByTestId('close-editor').click();

  await expect(eventRow(page, 'Fushimi Inari')).toContainText(/9:00\sAM/);

  await switchView(page, 'Week');

  // The axis drops the minutes, which say nothing on a column of whole hours.
  const axis = page.getByTestId('week-timetable').first();
  await expect(axis.getByText(/^9\sAM$/).first()).toBeVisible();
  await expect(axis.getByText(/^12\sPM$/).first()).toBeVisible();
});

test('what to type is offered on the clock in use', async ({ page }) => {
  await page.goto('/');
  await newTrip(page, 'Japan, August');

  const editor = await openWhen(page, 'Tea ceremony');
  const time = editor.getByRole('textbox', { name: 'Time' });

  await expect(time).toHaveAttribute('placeholder', /^9:00\sAM$/);

  await time.fill('nine-ish');
  await time.blur();

  // Telling somebody on this clock to write 09:00 asks them to convert
  // something their device never shows them.
  await expect(page.getByText(/Use a time like 9:00\sAM/)).toBeVisible();
  await expect(time).toHaveValue('nine-ish');
});
