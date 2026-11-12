import { expect, test } from '@playwright/test';
import { admin, adminSelectors, adminUrl, signIn } from './support';

// These specs are about the sign-in form itself, so they start with no session
// rather than the one admin/session.setup.ts saved. Without this they would
// arrive already authenticated and assert nothing.
test.use({ storageState: { cookies: [], origins: [] } });

// Two tests rather than two steps of one, so each gets its own browser context.
// Signing in badly and then well inside a single context does not behave like
// two separate attempts: Magento counts the failure, and the admin CAPTCHA
// (admin/captcha/enable, on by default, after_fail at three attempts per login
// name) can then intercept the good credential. The workflow turns that off,
// and the contexts keep these independent of each other as well.
test.describe('Admin sign-in', () => {
    test('@admin serves the sign-in form under the admin frontname', async ({ page }) => {
        const response = await page.goto(adminUrl());

        expect(response?.status()).toBe(200);
        // The route discriminator, asserted before the form: #login-form alone
        // is ambiguous, because the storefront authentication popup uses that
        // id too. Without this, a request that lands on the storefront passes.
        await expect(page.locator('body')).toHaveClass(adminSelectors.loginPageBodyClass);
        await expect(page.locator(adminSelectors.loginForm)).toBeVisible();
    });

    test('@admin refuses a credential that is not an account', async ({ page }) => {
        // A username that does not exist, rather than the real account with a
        // wrong password: failures are counted per login name, in captcha_log
        // and in admin_user.failures_num. Spending them on a name nobody will
        // sign in with keeps this from making the next test flaky.
        await signIn(page, 'not-a-real-admin', 'definitely-not-the-password');

        await expect(page.locator(adminSelectors.errorMessage)).toBeVisible();
        // Still the sign-in page, rather than "not the dashboard": asserting
        // the absence of a URL passes on an error page too.
        await expect(page.locator('body')).toHaveClass(adminSelectors.loginPageBodyClass);
    });

    test('@admin accepts the account the install created', async ({ page }) => {
        await signIn(page, admin.user, admin.password);

        // The dashboard by page identity, not by URL. Magento serves it at
        // whatever admin path was requested rather than always redirecting to
        // admin/dashboard, so the URL depends on how the session got here.
        await expect(page.locator('body')).toHaveClass(adminSelectors.dashboardBodyClass);
        await expect(page.locator(adminSelectors.menu)).toBeVisible();
        await expect(page.locator(adminSelectors.pageTitle)).toContainText('Dashboard');
    });
});
