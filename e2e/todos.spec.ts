import { expect, test, type Page } from '@playwright/test';
import { addNewEvent, editEvent, goToScreen } from './helpers';

async function newTrip(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const trip = await page.evaluate(async () => {
    const response = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Japan todos', homeTimezone: 'Asia/Tokyo' }),
    });
    return (await response.json()) as { id: string };
  });

  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  return trip.id;
}

function eventRow(page: Page, name: string) {
  return page.getByTestId('event').filter({ hasText: name });
}

async function revealTodos(page: Page) {
  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId('field-todos').count()) > 0) return;

  const chip = editor.getByTestId('add-field-todos');
  if ((await chip.count()) === 0) await editor.getByTestId('expand-palette').click();
  await editor.getByTestId('add-field-todos').click();
}

async function addTodo(page: Page, text: string, deadline?: string) {
  const editor = page.getByTestId('event-editor');
  const form = editor.getByTestId('add-todo-form');
  await form.getByRole('textbox', { name: 'New todo' }).fill(text);
  if (deadline) await form.getByLabel('Deadline').fill(deadline);
  await form.getByRole('button', { name: 'Add todo' }).click();
}

test('event todos are collected with deadlines first and remain checkable', async ({ page }) => {
  const tripId = await newTrip(page);

  await addNewEvent(page, 'Packing');
  await editEvent(page, 'Packing');
  await revealTodos(page);
  await addTodo(page, 'Pack charger');
  await page.getByTestId('close-editor').click();

  await addNewEvent(page, 'Flight');
  await editEvent(page, 'Flight');
  await revealTodos(page);
  await addTodo(page, 'Check in online', '2026-09-05');
  await addTodo(page, 'Choose a seat', '2026-09-02');
  await page.getByTestId('close-editor').click();

  await goToScreen(page, 'To-dos');
  await expect(page).toHaveURL(`/t/${tripId}/todos`);

  const rows = page.getByTestId('trip-todo');
  await expect(rows).toHaveCount(3);
  expect(
    await rows.evaluateAll((items) => items.map((item) => item.getAttribute('data-deadline'))),
  ).toEqual(['2026-09-02', '2026-09-05', '']);
  await expect(rows.nth(0)).toContainText('Choose a seat');
  await expect(rows.nth(1)).toContainText('Check in online');
  await expect(rows.nth(2)).toContainText('Pack charger');

  await page.getByRole('checkbox', { name: 'Mark complete: Choose a seat' }).check();
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  await page.reload();
  await expect(
    page.getByRole('checkbox', { name: 'Mark incomplete: Choose a seat' }),
  ).toBeChecked();
});
