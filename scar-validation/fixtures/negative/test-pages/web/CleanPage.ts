export async function read(page: any, record: any) {
  await record.waitFor({ state: 'visible', timeout: 10000 });
  const toast = await page.locator('.slds-notify__content').innerText();
  return toast;
}
