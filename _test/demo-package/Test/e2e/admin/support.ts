import { expect, type Page } from '@playwright/test';
import path from 'node:path';

/**
 * These mirror what warden/setup-environment's admin:user:create step makes.
 * The action hardcodes them, so the workflow passes them through rather than
 * letting the suite and the store hold separate opinions about the password.
 */
export const admin = {
    user: process.env.MAGENTO_ADMIN_USER ?? 'admin',
    password: process.env.MAGENTO_ADMIN_PASSWORD ?? 'abcABC123',
    // setup:install --backend-frontname. Pinned by the workflow so a spec can
    // navigate straight to an admin route instead of clicking through menus,
    // which is the difference between an admin suite that is maintainable and
    // one that breaks whenever the menu is reordered.
    frontname: process.env.MAGENTO_ADMIN_FRONTNAME ?? 'admin',
};

/**
 * Written by admin/session.setup.ts and read by the admin project's
 * storageState. Not committed: it holds a live admin session cookie.
 */
export const adminStateFile = path.resolve(__dirname, '.auth/admin.json');

/** A path under the admin frontname, e.g. adminUrl('catalog/product/new'). */
export function adminUrl(route = ''): string {
    return `/${admin.frontname}/${route.replace(/^\/+/, '')}`;
}

export const adminSelectors = {
    // The admin login route, identified by its body class the same way the
    // storefront specs identify theirs. This is asserted before the form
    // because #login-form on its own is ambiguous: the storefront
    // authentication popup carries that same id, so a request that lands on
    // the storefront rather than the admin -- a wrong frontname, say -- finds
    // a #login-form and the failure stops being about the admin at all.
    loginPageBodyClass: /adminhtml-auth-login/,
    loginForm: '.login-content #login-form',
    // The dashboard, identified the same way. Asserted instead of the URL
    // because Magento renders the dashboard at whichever admin path was
    // requested -- sign in from /admin/ and you stay on /admin/ -- so a URL
    // assertion passes or fails depending on how the session arrived.
    dashboardBodyClass: /adminhtml-dashboard-index/,
    username: '#username',
    // The password field's id is "login", not "password" -- the name is
    // login[password]. Worth stating, because guessing #password here gives a
    // timeout that looks like a broken store rather than a bad selector.
    password: '#login',
    submit: 'button.action-login',
    errorMessage: '.message-error',
    menu: '.admin__menu',
    pageTitle: '.page-title',
};

/*
 * There is deliberately no "dismiss whatever modal is covering the page"
 * helper here, and the two candidates were checked rather than assumed:
 *
 * - Magento_AdminAnalytics' usage-data prompt is gated by
 *   CanViewNotification::isVisible(), which returns false unless
 *   admin/usage/enabled is set. It defaults to 0, and the workflow pins it.
 * - Magento_ReleaseNotification builds its content URL from
 *   system/release_notification/content_url. Mage-OS ships that empty, so
 *   UrlBuilder::getUrl() returns '' and the modal has nothing to render.
 *
 * So neither appears on a store this gate installs. Blanket modal dismissal
 * would be dead code today and a liability later: if a future release does
 * grow a blocking dialog on first sign-in, the right outcome is a red test
 * with a screenshot of it, not a suite that clicks it away and reports green.
 */

/**
 * Asserts the page really is the admin sign-in form, then fills and submits
 * it. Says nothing about whether the sign-in succeeded -- that is the caller's
 * assertion to make, and both outcomes are worth testing.
 */
export async function signIn(page: Page, user: string, password: string): Promise<void> {
    await page.goto(adminUrl());
    await expect(page.locator('body')).toHaveClass(adminSelectors.loginPageBodyClass);
    await expect(page.locator(adminSelectors.loginForm)).toBeVisible();
    await page.fill(adminSelectors.username, user);
    await page.fill(adminSelectors.password, password);
    await page.click(adminSelectors.submit);
}
