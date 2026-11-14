import { expect, test } from '@playwright/test';
import { adminGrid, adminSelectors, adminUrl } from './support';

/**
 * The first admin screen worth gating a release on, and deliberately ahead of
 * the specs that create things.
 *
 * A grid is the whole Magento_Ui stack in one page: requirejs resolves the
 * component, Knockout renders the table, the data provider answers a separate
 * mui/index/render request and the collection applies the filters. If any of
 * that is broken then every admin screen is broken -- and a create-product
 * spec fails too, with no way to tell "the form never rendered" from "the
 * product could not be saved". This spec is what makes that distinction
 * readable in a release report.
 */

const productGrid = {
    // Not adminhtml-catalog-product-index: the body class is the full action
    // name, and this controller answers under the catalog route, so the admin
    // screens outside Magento_Backend are not prefixed the way the dashboard
    // and the login page are.
    bodyClass: /catalog-product-index/,
    route: 'catalog/product/',
    component: 'product_listing',
};

test.describe('Admin product grid', () => {
    test('@admin renders the product grid', async ({ page }) => {
        const grid = adminGrid(page, productGrid.component);

        await test.step('the listing page loads under the admin frontname', async () => {
            await page.goto(adminUrl(productGrid.route));

            await expect(page.locator('body')).toHaveClass(productGrid.bodyClass);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('Products');
        });

        await test.step('the grid component draws the catalog', async () => {
            await grid.ready();
            await grid.startUnfiltered();

            // More than one row, not just one: a spec that left a filter
            // applied would otherwise pass here, and grid state is saved per
            // admin user, so that leak is real and should be loud.
            const rows = await grid.rows.count();
            expect(rows, 'the seeded catalog should fill the product grid').toBeGreaterThan(1);

            // The rows and the count come from different parts of the
            // component -- the rendered records and the collection size -- so
            // having them agree on the first page is a cheap consistency check.
            expect(await grid.recordsFound()).toBeGreaterThanOrEqual(rows);
        });

        await test.step('the rows carry the columns a merchant works from', async () => {
            const sku = await grid.columnIndex('SKU');

            // Not an empty cell: a data provider that answered with the right
            // shape but no values renders a full table of blanks.
            await expect(grid.column(sku).first()).not.toBeEmpty();
        });
    });

    test('@admin filters the product grid by sku', async ({ page }) => {
        const grid = adminGrid(page, productGrid.component);

        await page.goto(adminUrl(productGrid.route));
        await grid.ready();
        // The grid remembers its filters per admin user, so a retry of this
        // test would otherwise inherit the filter the failed attempt applied
        // and measure "unfiltered" against an already filtered grid.
        await grid.startUnfiltered();

        const skuColumn = await grid.columnIndex('SKU');
        const unfiltered = await grid.recordsFound();
        const sku = (await grid.column(skuColumn).first().innerText()).trim();

        await test.step(`the sku filter narrows the grid to ${sku}`, async () => {
            await grid.filterBy('sku', sku);

            // The applied filter is shown back to the merchant. A filter that
            // reached the collection but was never acknowledged in the UI is a
            // bug that a row count alone would miss.
            await expect(grid.activeFilters).toContainText(sku);

            // Polled rather than read once. The count is rendered by Knockout
            // after the grid settles, and the grid does not always go to the
            // server to settle: it caches pages it has already fetched, keyed
            // by the request, so a filter the merchant has used before -- or
            // the unfiltered page below -- can re-render with no request at
            // all. Waiting for a response would hang on exactly that case, and
            // reading the number once reads whatever was on screen before.
            //
            // Fewer, rather than exactly one: the sku filter is a LIKE and
            // fixture skus are numbered, so one sku is legitimately a prefix
            // of another. What matters is that the filter reached the
            // collection and that every remaining row satisfies it.
            await expect
                .poll(() => grid.recordsFound(), { message: 'filtering should remove rows' })
                .toBeLessThan(unfiltered);
            await expect(grid.rows).not.toHaveCount(0);

            for (const found of await grid.column(skuColumn).allInnerTexts()) {
                expect(found.trim()).toContain(sku);
            }
        });

        await test.step('clearing the filter restores the full listing', async () => {
            await grid.clearFilters();

            await expect.poll(() => grid.recordsFound()).toBe(unfiltered);
        });
    });
});
