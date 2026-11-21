import { expect, test } from '../fixtures';
import { luma } from './luma';

/**
 * Full-text search: the one service this gate installs and never questioned.
 *
 * The workflow stands OpenSearch up, probes its version and prints it in the
 * run summary -- and until this spec, no test ever sent it a query. A release
 * that shipped a client which could not speak to the engine, an unbuilt
 * catalogsearch_fulltext index, or a changed result template passed all
 * sixteen of the other tests here.
 *
 * It searches for a sku it reads off a product page rather than one written
 * in this file. That costs two navigations and buys two things: the spec
 * cannot go stale when the fixture profile changes its naming, and the
 * assertion becomes one about this release rather than this catalogue --
 * "the catalogue has this product, so search can find it".
 *
 * It asserts the *first* result rather than the only one. A sku with a space
 * in it tokenises into an OR query: measured on a seeded store, the sku
 * "Configurable Product 1" returns 41 results while "product_dynamic_5"
 * returns exactly 1. What holds for both is that the exact match ranks first,
 * so that is what gets checked -- which also means relevance ordering is
 * covered, and no assertion here depends on which product the catalogue
 * happens to list first.
 *
 * The no-results test is not decoration. A search that ignored its query and
 * listed the whole catalogue would satisfy every assertion in the first test.
 * It is the control that gives the first one its meaning.
 */

// A term no catalogue should match: one token, no separators, no word a
// product could carry. The query is tokenised and matched as an OR, so a
// hyphenated phrase is not an absent term -- "zzz-mageos-no-such-product-zzz"
// splits and matches the whole catalogue on "product" alone, which this spec
// found the first time it ran. Fixed rather than random, because a gate that
// reports a different failure every run is one nobody can triage.
const absentTerm = 'zzzqxvnomatch';

test.describe('Storefront search', () => {
    test('finds a product by the sku the catalogue gave it', { tag: ['@catalog', '@search'] }, async ({ page }) => {
        let sku = '';
        let productName = '';

        await test.step('the catalogue offers a product to look for', async () => {
            await page.goto('/');

            const category = page.locator(luma.navCategory).first();
            await expect(category, 'the fixture categories should appear in the main navigation').toBeVisible();
            await category.click();
            await expect(page.locator('body')).toHaveClass(/catalog-category-view/);

            const firstProduct = page
                .locator(luma.productList)
                .locator(luma.productItem)
                .first()
                .locator(luma.productItemLink);
            await expect(firstProduct, 'the category should list at least one product').toBeVisible();
            productName = ((await firstProduct.textContent()) ?? '').trim();
            await firstProduct.click();

            const skuValue = page.locator(luma.productSku);
            await expect(skuValue, 'a product page should render its sku').toBeVisible();
            sku = ((await skuValue.textContent()) ?? '').trim();
            expect(sku, 'the sku should not be empty').not.toBe('');
        });

        await test.step('the search form takes that sku', async () => {
            // Through the form rather than by building the url: the form is
            // part of what a storefront has to render, and a release that
            // breaks its route should fail here rather than silently never be
            // tested.
            await page.goto('/');

            const search = page.locator(luma.searchInput);
            await expect(search, 'Luma should render its quick-search field').toBeVisible();
            await search.fill(sku);

            // By keyboard, not by clicking the button, and that is a measured
            // decision rather than a preference. Magento_Search's form-mini
            // widget runs a debounced 'input' handler about 400ms after
            // typing stops, which sets submitBtn.disabled = true; the
            // re-enable alongside it does not stick, so from then on the
            // button is dead. Measured against this store, with the button
            // already disabled: Enter submits, a click does not, and not even
            // a forced click does. Enter works whether the widget has settled
            // or not, so it is the only submission this spec can rely on.
            await search.press('Enter');

            await expect(page).toHaveURL(/catalogsearch\/result/);
            await expect(page.locator('body')).toHaveClass(/catalogsearch-result-index/);
            await expect(
                page.locator(luma.pageTitle),
                'the results page should name what was searched for',
            ).toContainText(sku);
        });

        await test.step('the product is the first result', async () => {
            const results = page.locator(luma.productList).locator(luma.productItem);
            await expect(
                results,
                'searching a sku the catalogue just showed should return at least one result',
            ).not.toHaveCount(0);

            await expect(
                page.locator(luma.searchResultsCount).first(),
                'the toolbar should report how many results there were',
            ).not.toBeEmpty();

            const top = results.first().locator(luma.productItemLink);
            await expect(top, 'the exact match should rank first').toHaveText(productName);

            await top.click();
            await expect(
                page.locator(luma.productSku),
                'the result should lead back to the product whose sku was searched',
            ).toHaveText(sku);
        });
    });

    test('returns no results for a term the catalogue does not contain', { tag: ['@catalog', '@search'] }, async ({ page }) => {
        await page.goto(`/catalogsearch/result/?q=${encodeURIComponent(absentTerm)}`);

        // Still the search controller, not an error page or a redirect to the
        // homepage: an empty result is a normal answer and has to look like
        // one.
        await expect(page.locator('body')).toHaveClass(/catalogsearch-result-index/);
        await expect(
            page.locator(luma.searchNoResults),
            'an unmatched term should be reported, not answered with products',
        ).toContainText('Your search returned no results.');

        // The list block is not rendered at all on this page, so this counts
        // zero rather than finding an empty wrapper.
        await expect(
            page.locator(luma.productList).locator(luma.productItem),
            'nothing should be listed for a term nothing matches',
        ).toHaveCount(0);
    });
});
