import { expect, type Page } from '@playwright/test';

/** Creates an unscheduled event through the compact toolbar action. */
export async function addNewEvent(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add event' }).click();

  const nameField = page.getByRole('textbox', { name: 'Name' });
  await expect(nameField).toBeFocused();
  await nameField.fill(name);
  await nameField.blur();
  await expect(page.getByTestId('event').filter({ hasText: name })).toBeVisible();

  await page.getByTestId('close-editor').click();
}
