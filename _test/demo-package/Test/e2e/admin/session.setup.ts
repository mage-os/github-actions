import { expect, test as setup } from '@playwright/test';
import { admin, adminSelectors, adminStateFile, signIn } from './support';

/**
 * Signs in once and saves the session for every spec in the admin project.
 *
 * This is a project dependency rather than a globalSetup hook so that the
 * sign-in shows up in the report as its own result. "The session could not be
 * created" and "every admin spec failed" are different problems, and a release
 * gate is read by someone deciding whether to ship: they should not look alike.
 */
setup('an admin session can be established and saved', async ({ page }) => {
    await setup.step('the sign-in form accepts the credentials the install made', async () => {
        await signIn(page, admin.user, admin.password);
    });

    await setup.step('the dashboard loads with the admin menu rendered', async () => {
        // By page identity rather than URL: Magento serves the dashboard at
        // whichever admin path was requested, so the URL is not a reliable
        // statement about which page rendered.
        await expect(page.locator('body')).toHaveClass(adminSelectors.dashboardBodyClass);
        await expect(page.locator(adminSelectors.menu)).toBeVisible();
    });

    await page.context().storageState({ path: adminStateFile });
});
