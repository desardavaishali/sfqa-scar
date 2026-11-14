export const config = {
  password: 'SuperSecret123',
  sit2: {
    admin: process.env.SIT_ADMIN,
  },
};

export async function waitForHeader(page: any) {
  await page.locator('#oneHeader').waitFor({ timeout: 5000 });
}
