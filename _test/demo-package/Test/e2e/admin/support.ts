import { expect, type Locator, type Page } from '@playwright/test';
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

/**
 * Every admin listing -- products, customers, orders, CMS pages -- is the same
 * Magento_Ui grid component, so one object drives all of them.
 *
 * It is also why a grid spec is worth more than it looks: none of this markup
 * exists in the HTML the server sends. The table, the row count and the filter
 * controls are rendered by Knockout from a separate mui/index/render request,
 * so a grid that renders at all is a statement that requirejs resolved, the
 * component bootstrapped and the data provider answered. A release that breaks
 * any of those breaks every admin screen.
 *
 * @param component the listing's component name, e.g. product_listing. Needed
 *   because the admin header carries a second grid of its own -- the
 *   notification area -- whose loading mask is otherwise indistinguishable
 *   from the one belonging to the grid under test.
 */
export function adminGrid(page: Page, component: string) {
    // The page content, which excludes the notification grid in the header.
    const scope = page.locator('#container');
    // data-role="grid" rather than the class alone: the admin renders a second
    // copy of the toolbar and the table inside a .sticky-header element, which
    // carries the same classes. Every selector here has to say which copy it
    // means or it matches two elements and Playwright refuses to act.
    const table = scope.locator('table.data-grid[data-role="grid"]');
    // The real toolbar, as a direct child of the outer wrap. The sticky copy
    // sits a level deeper, so this relationship is what separates them.
    const toolbar = scope.locator('.admin__data-grid-outer-wrap > .admin__data-grid-header');

    return {
        table,
        toolbar,
        rows: table.locator('tr.data-row'),
        headers: table.locator('thead th'),
        activeFilters: toolbar.locator('.admin__data-grid-filters-current._show'),

        /**
         * Waits for the grid to finish whatever request it is making. Every
         * filter, sort and page change is an ajax round trip behind a loading
         * mask, so without this an assertion races the rows it counts.
         */
        async ready(): Promise<void> {
            // Scoped by component: the admin header carries a grid of its own
            // -- the notification area -- whose loading mask is otherwise
            // indistinguishable from this one's.
            await expect(
                page.locator(`.admin__data-grid-loading-mask[data-component*="${component}"]`),
            ).toBeHidden();
            await expect(table).toBeVisible();
        },

        /**
         * The number of records the grid says it found, which comes from the
         * collection size rather than from the rows it drew.
         */
        async recordsFound(): Promise<number> {
            const text = await toolbar.locator('.admin__control-support-text').first().innerText();
            const found = text.match(/([\d,]+)\s+records found/);

            expect(found, `the grid should report how many records it found; it says "${text}"`).not.toBeNull();

            return Number(found![1].replace(/,/g, ''));
        },

        /**
         * The index of a column, by its header label. Which columns a grid
         * shows is per-admin-user state -- saved as bookmarks, reorderable by
         * dragging -- so a spec that wants the SKU cell asks which column that
         * is rather than counting on it being the seventh.
         */
        async columnIndex(label: string): Promise<number> {
            const labels = (await this.headers.allInnerTexts()).map((header) => header.trim());
            const index = labels.findIndex((header) => header === label);

            expect(
                index,
                `the grid should have a "${label}" column; it has: ${labels.join(', ')}`,
            ).toBeGreaterThanOrEqual(0);

            return index;
        },

        /** The cells of one column, top to bottom, as the grid renders them. */
        column(index: number): Locator {
            return this.rows.locator(`td:nth-child(${index + 1})`);
        },

        /** Opens the filter panel, sets one field and applies it. */
        async filterBy(field: string, value: string): Promise<void> {
            await toolbar.locator('button[data-action="grid-filter-expand"]').click();
            await toolbar.locator(`input.admin__control-text[name="${field}"]`).fill(value);
            await toolbar.locator('button[data-action="grid-filter-apply"]').click();
            await this.ready();
        },

        /**
         * Clears every applied filter. Not politeness: grid state lives in the
         * ui_bookmark table per admin user, so a filter a spec leaves applied
         * is still applied the next time anything opens that grid.
         */
        async clearFilters(): Promise<void> {
            await toolbar.locator('button[data-action="grid-filter-reset"]').click();
            await this.ready();
        },

        /**
         * Starts from an unfiltered grid, whatever the last visitor left
         * behind. Because that state is persisted per admin user rather than
         * per session, the leak this cleans up is the suite's own: a filter
         * spec that fails halfway, or a human clicking around the same store,
         * otherwise decides what the next run sees. Says nothing about the
         * store, so it asserts nothing.
         */
        async startUnfiltered(): Promise<void> {
            const clear = toolbar.locator('button[data-action="grid-filter-reset"]');

            if (await clear.count()) {
                await clear.click();
                await this.ready();
            }
        },
    };
}

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
