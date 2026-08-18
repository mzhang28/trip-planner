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

  // Done hands the card back to its details rather than shutting it, so the
  // new event is left closed like every other one in the list.
  await closeEvent(page, name);
}

/**
 * The whole card for an event: its header, and whatever it has open below.
 *
 * Found by the name in its own header rather than by the card's text, which
 * takes in the description -- and a description that mentions another event
 * carries that event's name.
 */
export function eventCard(page: Page, name: string) {
  return page
    .getByTestId('event-card')
    .filter({ has: page.getByTestId('event').filter({ hasText: name }) });
}

/**
 * Opens an event's card and takes it through to the editor.
 *
 * A click on a closed row opens what the event says; changing it is one press
 * of Edit further in. A card left showing its details from an earlier step is
 * taken through from there rather than clicked shut and opened again.
 */
export async function editEvent(page: Page, name: string) {
  const card = eventCard(page, name);
  if (await card.getByTestId('event-editor').isVisible()) return;

  const edit = card.getByTestId('edit-event');
  if (!(await edit.isVisible())) await card.getByTestId('event').click();

  await edit.click();
  await expect(card.getByTestId('event-editor')).toBeVisible();
}

/** Shuts an event's card, whether it is showing its details or its editor. */
export async function closeEvent(page: Page, name: string) {
  const card = eventCard(page, name);
  if (await card.getByTestId('close-editor').isVisible()) {
    await card.getByTestId('close-editor').click();
  }

  await card.getByTestId('event').click();
  await expect(card.getByTestId('event-details')).toHaveCount(0);
}
