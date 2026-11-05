import { test, expect } from '@playwright/test';

// A 200 proves very little on its own: the admin login page, a CMS no-route
// page and a Magento error page all answer 200 and all carry a header, a
// footer and a title. Every assertion below is here because it fails on
// something a storefront check should not accept.
test.describe('Storefront smoke test', () => {
    test('serves the Luma homepage with its static content deployed', { tag: ['@smoke', '@cold'] }, async ({ page }) => {
        const response = await page.goto('/');

        await test.step('the homepage responds 200', async () => {
            expect(response?.status(), 'the homepage should respond 200').toBe(200);
        });

        await test.step('the response is the storefront homepage, not some other 200', async () => {
            // Luma puts the resolved route in the body class, which is the
            // cheapest way to tell the homepage apart from /admin or a 404.
            await expect(page.locator('body')).toHaveClass(/cms-index-index/);
            await expect(page.locator('[data-block="minicart"]')).toBeAttached();
        });

        await test.step('static content is deployed', async () => {
            await expect(page.locator('link[rel="stylesheet"]').first()).toBeAttached();

            // A stylesheet that 404s is still a link element, so ask the
            // browser whether any of them parsed into rules. Without this the
            // test passes against a store whose pub/static is empty.
            const ruleCount = await page.evaluate(() =>
                Array.from(document.styleSheets).reduce((total, sheet) => {
                    try {
                        return total + sheet.cssRules.length;
                    } catch {
                        return total;
                    }
                }, 0),
            );
            expect(ruleCount, 'at least one stylesheet should have loaded').toBeGreaterThan(0);
        });
    });
});
