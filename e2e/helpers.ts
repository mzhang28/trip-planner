import { expect, type Page } from '@playwright/test';

/** Whether this run is at a width the app treats as a phone. */
function onAPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) < 640;
}

/** What the switcher draws for each view where the header has room for a letter. */
const SHORT_VIEW = { Day: 'D', Week: 'W', Month: 'M' } as const;

/** Moves between the Day, Week and Month views, however this width writes them. */
export async function switchView(page: Page, view: 'Day' | 'Week' | 'Month') {
  await page
    .getByRole('radiogroup', { name: 'Calendar view' })
    .getByText(onAPhone(page) ? SHORT_VIEW[view] : view, { exact: true })
    .click();
}

/** Opens one of the trip's screens, from wherever this width keeps the links. */
export async function goToScreen(
  page: Page,
  screen: 'Itinerary' | 'To-dos' | 'Files' | 'Settings',
) {
  if (onAPhone(page)) await page.getByTestId('open-drawer').click();

  await page.getByRole('link', { name: screen, exact: true }).click();
}

/** Creates an unscheduled event through the compact toolbar action. */
export async function addNewEvent(page: Page, name: string) {
  // A phone has no room for that action along the top, so it is in the drawer
  // at the bottom edge with the rest of what the header holds.
  if (onAPhone(page)) await page.getByTestId('open-drawer').click();

  await page.getByRole('button', { name: 'Add event' }).click();

  const nameField = page.getByRole('textbox', { name: 'Name' });
  await expect(nameField).toBeFocused();
  await nameField.fill(name);
  await nameField.blur();
  await expect(page.getByTestId('event').filter({ hasText: name })).toBeVisible();

  await page.getByTestId('close-editor').click();
}
