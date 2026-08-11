import { expect, test, type Page } from '@playwright/test';

async function newTrip(page: Page) {
  await expect(page.getByRole('heading', { name: 'Trips' })).toBeVisible();

  const trip = await page.evaluate(async () => {
    const res = await fetch('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });
    return (await res.json()) as { id: string };
  });

  await page.goto(`/t/${trip.id}`);
  await expect(page.getByTestId('sync-status')).toHaveText('Saved', { timeout: 15_000 });
  return trip.id;
}

function eventRow(page: Page, name: string) {
  return page.getByTestId('event').filter({ hasText: name });
}

async function addEvent(page: Page, name: string) {
  await page.getByRole('textbox', { name: 'New event' }).fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(eventRow(page, name)).toBeVisible();
}

/** Opens an event and reveals its description, which starts behind a chip. */
async function openWithDescription(page: Page, name: string) {
  await eventRow(page, name).click();

  const editor = page.getByTestId('event-editor');
  if ((await editor.getByTestId('field-description').count()) === 0) {
    if ((await editor.getByTestId('add-field-description').count()) === 0) {
      await editor.getByTestId('expand-palette').click();
    }
    await editor.getByTestId('add-field-description').click();
  }

  return editor.getByRole('combobox', { name: 'Description' });
}

test.describe('pointing at the rest of the trip', () => {
  test('typing @ offers things, and the mention resolves to the current name', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addEvent(page, 'Nishiki Market');
    await addEvent(page, 'Fushimi Inari');

    const description = await openWithDescription(page, 'Fushimi Inari');

    await description.fill('Eat at @nish');
    await expect(page.getByRole('option', { name: /Nishiki Market/ })).toBeVisible();
    await description.press('Enter');

    // Shown as the thing it points at, not as the markup that stores it.
    const mention = page.getByTestId('mention');
    await expect(mention).toHaveText('Nishiki Market');
    await expect(description).toHaveValue(/@\[Nishiki Market\]\(event:/);

    // Renaming what it points at renames the mention, because the id is the
    // reference and the label is only a copy.
    await page.locator('[data-testid="event"][aria-expanded="true"]').click();
    await eventRow(page, 'Nishiki Market').click();
    await page.getByTestId('event-editor').getByRole('textbox', { name: 'Name' }).fill('Nishiki, morning');
    await page.getByTestId('event-editor').getByRole('textbox', { name: 'Name' }).blur();
    await page.locator('[data-testid="event"][aria-expanded="true"]').click();

    await eventRow(page, 'Fushimi Inari').click();
    await expect(page.getByTestId('mention')).toHaveText('Nishiki, morning');
  });

  test('a mention whose target is gone keeps its words and is marked', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addEvent(page, 'Nishiki Market');
    await addEvent(page, 'Fushimi Inari');

    const description = await openWithDescription(page, 'Fushimi Inari');
    await description.fill('Eat at @nish');
    await expect(page.getByRole('option', { name: /Nishiki Market/ })).toBeVisible();
    await description.press('Enter');
    await expect(page.getByTestId('mention')).toBeVisible();

    await page.locator('[data-testid="event"][aria-expanded="true"]').click();
    await eventRow(page, 'Nishiki Market').click();
    await page.getByTestId('event-editor').getByRole('button', { name: 'Delete event' }).click();

    await eventRow(page, 'Fushimi Inari').click();

    // The sentence still reads. A gap where a name was says less than a name
    // marked as gone.
    await expect(page.getByTestId('mention-gone')).toHaveText('Nishiki Market');
  });

  test('search finds a description by its words, not its markup', async ({ page }) => {
    await page.goto('/');
    await newTrip(page);

    await addEvent(page, 'Nishiki Market');
    await addEvent(page, 'Fushimi Inari');

    const description = await openWithDescription(page, 'Fushimi Inari');
    await description.fill('Eat at @nish');
    await expect(page.getByRole('option', { name: /Nishiki Market/ })).toBeVisible();
    await description.press('Enter');
    await description.blur();
    await page.locator('[data-testid="event"][aria-expanded="true"]').click();

    const search = page.getByRole('combobox', { name: 'Search this trip' }).first();
    await search.fill('Eat at Nishiki');
    await expect(page.getByRole('option', { name: /Fushimi Inari/ })).toBeVisible();
  });
});
