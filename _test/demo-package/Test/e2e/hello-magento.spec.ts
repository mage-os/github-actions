import { test, expect } from '@playwright/test';

test.describe('Page health checks', () => {
    test('Homepage_returns_200', {tag: ['@smoke', '@cold']}, async ({page}) => {
        const homepageURL = process.env.PLAYWRIGHT_BASE_URL || process.env.BASE_URL;
        if (!homepageURL) {
            throw new Error("PLAYWRIGHT_BASE_URL has not been defined in the .env file.");
        }

        const homepageResponsePromise = page.waitForResponse(homepageURL);
        await page.goto(homepageURL);
        const homepageResponse = await homepageResponsePromise;
        expect(homepageResponse.status(), 'Homepage should return 200').toBe(200);

        const pageTtitle = page.getByRole('heading', {level: 1})

        await expect(pageTtitle, 'Homepage has a visible title').toBeVisible();
        await expect(pageTtitle).toHaveText(/\S+/);
    })
})
