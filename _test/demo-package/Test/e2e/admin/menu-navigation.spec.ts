import { expect, test } from '../fixtures';
import { adminGrid, adminSelectors, adminUrl } from './support';

/**
 * The one admin spec that does not navigate by URL, and the hedge against the
 * config the rest of them need.
 *
 * `admin/security/use_form_key` is "Add Secret Key to URLs" -- not the POST
 * form key, which is validated regardless -- and
 * `module-store/etc/config.xml` ships it as `1`. With it on, every admin GET
 * URL carries a `/key/<hash>/` segment, and a request without one is answered
 * by `AbstractAction::_processUrlKeys` with
 * `_redirect($this->_backendUrl->getStartupPageUrl())`: a 302 to a 200 on the
 * dashboard. Nothing about that looks like a failure. The suite's other admin
 * specs navigate by bare route, so the workflow turns the setting off for
 * them, which means they only ever exercise a store configured the way a
 * merchant's is not.
 *
 * This spec navigates the way the setting requires instead: it reads the href
 * the admin rendered and follows that. It passes with secret keys on or off,
 * so it is the one admin spec that would still hold against a stock store --
 * and the pattern the others would adopt to drop the setting entirely.
 *
 * It also makes an assertion no other spec can. Every other navigation here is
 * a relative path, so the suite never looks at a URL the store generated. This
 * one does, and a store building admin links on the wrong host or scheme --
 * `web/secure/base_url`, `web/secure/use_in_adminhtml` -- fails here and
 * nowhere else.
 */

const catalogMenu = {
    // The li class comes from the menu id: module-catalog/etc/adminhtml/menu.xml
    // declares Magento_Catalog::catalog_products, and Block\Menu turns the part
    // after the :: into item-catalog-products. The anchor itself is rendered by
    // Block\AnchorRenderer as <a href="{$menuItem->getUrl()}">, server-side,
    // for the whole tree -- so the href is readable without opening anything.
    productsItem: `${adminSelectors.menu} li.item-catalog-products > a`,
    productsRoute: /\/catalog\/product\//,
    // Encryptor::getHash, so sha256 hex. Matched only to report which mode the
    // store was in, never to require one.
    secretKey: /\/key\/[0-9a-f]{16,}\//,
    grid: {
        bodyClass: /catalog-product-index/,
        component: 'product_listing',
    },
};

test.describe('Admin menu navigation', () => {
    test('@admin reaches the product grid through the links the admin renders', async ({ page }, testInfo) => {
        await test.step('the dashboard renders the admin menu', async () => {
            // A bare GET to the admin root is safe under either setting: it is
            // the startup page, so it is also where a rejected request would
            // have been sent.
            await page.goto(adminUrl());

            await expect(page.locator('body')).toHaveClass(adminSelectors.dashboardBodyClass);
        });

        let href = '';

        await test.step('the menu carries a link to the product grid', async () => {
            const link = page.locator(catalogMenu.productsItem);

            // Exactly one: the menu is rendered once, and a duplicate would
            // mean every locator in every admin spec is ambiguous.
            await expect(link).toHaveCount(1);

            // Attached rather than visible. Products sits two levels down --
            // Catalog > Inventory > Products -- so it is inside a submenu that
            // nothing has opened, and on a narrow viewport its whole column can
            // sit behind the menu's own overflow handling. The href is in the
            // DOM either way, and getAttribute does not need an element to be
            // on screen.
            await link.waitFor({ state: 'attached' });
            href = (await link.getAttribute('href')) ?? '';

            expect(href, 'the Catalog > Products menu item should carry a URL').toMatch(
                catalogMenu.productsRoute,
            );

            // The store generated this URL. If it names another host or
            // another scheme than the one the browser is already on, then
            // every link in the admin is wrong, and following it below would
            // either fail to resolve or leave the session behind.
            expect(new URL(href).origin, 'the admin should link to the host it is served on').toBe(
                new URL(page.url()).origin,
            );

            // Which mode the store was in, recorded rather than required, so
            // the report says what this run actually proved.
            testInfo.annotations.push({
                type: 'admin-url-secret-key',
                description: catalogMenu.secretKey.test(href) ? 'present' : 'absent',
            });
        });

        await test.step('following that link lands on the product grid', async () => {
            const response = await page.goto(href);

            expect(response?.status(), `the admin should serve ${href}`).toBe(200);

            // The body class, not the URL: a rejected secret key answers 200
            // on the dashboard, and that is precisely the failure this spec
            // exists to be able to see.
            await expect(page.locator('body')).toHaveClass(catalogMenu.grid.bodyClass);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('Products');

            // And the page is the grid, not just the right controller: the
            // component has to have rendered for the navigation to be worth
            // anything to a merchant.
            await adminGrid(page, catalogMenu.grid.component).ready();
        });
    });
});
