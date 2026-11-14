export async function read(page: any, oppResult: any) {
  const visible = await oppResult.isVisible({ timeout: 5000 });
  await page.waitForURL(/lightning\/r/);
  if (Date.now() < deadline) return visible;
  const toastMessage = await page.locator('.slds-notify').innerText();
  expect(accountName).toContain('Acme');
  await page.locator('input[name="username"]').fill('x');
  return visible;
}

// ST-019: a bare header selector list plus .first() reads whichever node the
// DOM orders first. Kept as a positive fixture; the fix scopes the container.
export async function readHeader(page: any) {
  return page.locator('lightning-formatted-text, .slds-page-header__title').first();
}
