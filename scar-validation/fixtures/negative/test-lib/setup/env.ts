export const config = {
  password: process.env.ADMIN_PASSWORD || '',
  sit2: {
    admin: process.env.SIT2_ADMIN || '',
  },
};

export async function ensureSession(page: any) {
  await page.locator('#oneHeader').waitFor({ timeout: 60000 });
}
