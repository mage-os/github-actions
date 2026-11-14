import { expect, test } from '@playwright/test';
import { adminGrid, adminSelectors, adminUrl } from './support';
import { luma, productUrl } from '../luma';

/**
 * The spec that crosses the most seams in the application, and the reason the
 * admin is worth gating a release on at all.
 *
 * Saving one simple product in the admin form exercises the UI component form
 * and its validation, the EAV write path, the attribute set defaults, the
 * stock item, the url rewrite generation and the indexers that make a product
 * salable. Buying it afterwards proves all of that reached the storefront.
 * Each of those has broken in a Magento release at some point, and none of
 * them is visible from a storefront-only smoke test against a seeded catalog:
 * fixtures are written straight to the database, so they skip the entire write
 * path this spec is about.
 */

const productForm = {
    bodyClass: /catalog-product-new/,
    savedBodyClass: /catalog-product-edit/,
    addProduct: '#add_new_product',
    name: '.admin__field[data-index=name] input',
    sku: '.admin__field[data-index=sku] input',
    price: '.admin__field[data-index=price] input',
    quantity: '.admin__field[data-index=qty] input',
    stockStatus: '[data-index="product-details"] select[name="product[quantity_and_stock_status][is_in_stock]"]',
    // Collapsed on load, and its fields are not in the DOM until it is opened:
    // the collapsible renders its content lazily, so url_key cannot be filled
    // without clicking this first.
    seoSection: 'div[data-index="search-engine-optimization"]',
    urlKey: 'input[name="product[url_key]"]',
    save: '#save-button',
    saved: 'div[data-ui-id="messages-message-success"]',
    // Either outcome of a save, so the spec can wait for whichever the store
    // produces rather than only for the one it hopes for.
    anyMessage: 'div[data-ui-id="messages-message-success"], div[data-ui-id="messages-message-error"]',
};

test.describe('Creating a product in the admin', () => {
    // Longer than the suite's 120s, because the save below can take most of a
    // minute on its own; see the step for why.
    test.setTimeout(180_000);

    test('@admin creates a simple product and sells it', async ({ page }) => {
        // Inside the test, not at module scope, so that a retry gets its own
        // sku. The first attempt may well have saved the product before
        // failing, and "The value of attribute SKU must be unique" on the
        // retry would bury the failure that mattered.
        const stamp = `${Date.now()}`;
        const product = {
            name: `Mage-OS E2E Product ${stamp}`,
            sku: `mageos-e2e-${stamp}`,
            price: '42.00',
            quantity: '100',
            urlKey: `mageos-e2e-product-${stamp}`,
        };

        await test.step('the admin offers a new product form', async () => {
            // Through the grid's Add Product button rather than straight to a
            // URL: catalog/product/new on its own is a 404, because the
            // controller forwards to noroute without an attribute set, and the
            // id of the default set is not something a spec should hardcode.
            await page.goto(adminUrl('catalog/product/'));
            await adminGrid(page, 'product_listing').ready();
            await page.locator(productForm.addProduct).click();

            await expect(page.locator('body')).toHaveClass(productForm.bodyClass);
            // The form is a UI component too: these fields are rendered by
            // Knockout, so finding them is already a statement that the form
            // bootstrapped rather than that a page was served.
            await expect(page.locator(productForm.name)).toBeVisible();
            await expect(page.locator(productForm.sku)).toBeVisible();
            await expect(page.locator(productForm.price)).toBeVisible();
        });

        await test.step('the form accepts a simple product', async () => {
            // The name first, and blurred before anything else is typed.
            //
            // Magento_Catalog/js/components/import-handler mirrors the name
            // into sku, url_key and the meta fields through the masks in
            // catalog/fields_masks, and stops only once the field has been
            // edited by hand. The name field is configured with
            // valueUpdate: 'keyup', which Playwright's fill() does not emit,
            // so the import runs on the name's change event -- which fires
            // when focus leaves it, i.e. while the sku is being filled.
            //
            // Fill the sku straight after the name and the two interleave: the
            // store ends up with a sku of "<name><sku>". That passed every
            // assertion in this spec for an afternoon, because the grid's sku
            // filter is a LIKE and a contains assertion is satisfied by a
            // superstring. Hence the blur, the sku last, and toHaveValue.
            await page.locator(productForm.name).fill(product.name);
            await page.locator(productForm.name).blur();

            await page.locator(productForm.price).fill(product.price);
            await page.locator(productForm.quantity).fill(product.quantity);
            // Set rather than assumed: the default is In Stock, but a product
            // that cannot be bought is the one failure this spec must not
            // mistake for a broken storefront.
            await page.locator(productForm.stockStatus).selectOption('1');

            await page.locator(productForm.sku).fill(product.sku);
            // The field holds exactly what was typed, nothing imported around
            // it. Without this the spec cannot tell which product it made.
            await expect(page.locator(productForm.sku)).toHaveValue(product.sku);
        });

        await test.step('the url key is set explicitly', async () => {
            // Magento would derive one from the name, and this spec could
            // guess at that transformation. Setting it means the storefront
            // step below is a statement about url rewrites rather than a guess
            // about how a name becomes a url.
            await page.locator(productForm.seoSection).click();
            await expect(page.locator(productForm.urlKey)).toBeVisible();
            await page.locator(productForm.urlKey).fill(product.urlKey);
            // url_key is imported from the name by the same handler as sku,
            // so it gets the same guard.
            await expect(page.locator(productForm.urlKey)).toHaveValue(product.urlKey);
        });

        await test.step('saving the product reports success', async () => {
            await page.locator(productForm.save).click();

            // Whichever message arrives, with a timeout far longer than the
            // suite's 20s. This was flaky in CI exactly once and the shape of
            // the flake is informative: the first attempt timed out here, and
            // the retry passed in 10s end to end. The first product save on a
            // freshly installed store in developer mode pays for the code
            // generation along the save path, and then for the Update on Save
            // indexers -- price, EAV, product categories, catalog search --
            // which is work this gate wants happening, not work to switch off.
            //
            // Waiting for either message rather than only the success one is
            // what keeps the generous timeout honest: a save rejected by
            // validation renders an error at the top of the page, and that
            // should fail in a second with the message visible, not in ninety
            // with "element(s) not found".
            await expect(page.locator(productForm.anyMessage).first()).toBeVisible({ timeout: 90_000 });
            await expect(page.locator(productForm.saved)).toContainText('You saved the product.');
            // On the edit form for a product with an id: the save redirected
            // to a persisted entity rather than re-rendering the new form with
            // the values still in it.
            await expect(page.locator('body')).toHaveClass(productForm.savedBodyClass);
            await expect(page).toHaveURL(/catalog\/product\/edit\/id\/\d+/);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText(product.name);
            // What was persisted, read back off the edit form: the sku the
            // spec asked for, not one the form composed on its way past.
            await expect(page.locator(productForm.sku)).toHaveValue(product.sku);
        });

        await test.step('the grid finds the product by its sku', async () => {
            const grid = adminGrid(page, 'product_listing');

            await page.goto(adminUrl('catalog/product/'));
            await grid.ready();
            await grid.startUnfiltered();
            await grid.filterBy('sku', product.sku);

            // Exactly one, unlike the grid spec's LIKE filter caveat: this sku
            // is unique to this attempt, so anything else here means the grid
            // is showing rows that do not match its own filter.
            await expect.poll(() => grid.recordsFound()).toBe(1);
            // The cell equals the sku rather than containing it. The filter is
            // a LIKE, so a product whose sku merely ends with this one would
            // satisfy a contains assertion -- which is exactly how a mangled
            // sku passed this spec before.
            const skuColumn = await grid.columnIndex('SKU');
            await expect(grid.column(skuColumn).first()).toHaveText(product.sku);

            // The grid remembers filters per admin user, so leaving this one
            // applied would change what every later run of the grid spec sees.
            await grid.clearFilters();
        });

        await test.step('the storefront serves the product it has never seen', async () => {
            // Straight to the url key, with no catalog navigation: a url
            // rewrite that was not generated is a 404 here, which is precisely
            // the failure worth reporting. Finding the product through a
            // category listing would additionally depend on the category
            // assignment and the catalog search index, and would report all
            // three as one red.
            const response = await page.goto(productUrl(product.urlKey));

            expect(response?.status(), 'the url rewrite for a saved product should resolve').toBe(200);
            await expect(page.locator('body')).toHaveClass(/catalog-product-view/);
            await expect(page.locator(luma.pageTitle)).toContainText(product.name);
            // The price this spec typed, rather than any price: a rendered
            // price is the price index having run for a product that did not
            // exist a moment ago, and the storefront renders it as $42.00, so
            // the stored value is a substring of what the theme shows.
            await expect(page.locator(luma.productPrice).first()).toContainText(product.price);
            // Enabled, not merely present: the button renders for an
            // out-of-stock product too, so this is the salability assertion.
            await expect(page.locator(luma.addToCart)).toBeEnabled();
        });

        await test.step('the product can be bought', async () => {
            await page.locator(luma.addToCart).click();

            await expect(page.locator(luma.cartSuccess)).toContainText('to your shopping cart');
            // The minicart arrives over a separate customer-data request, so
            // this is also the private-content path for a brand new product.
            await expect(page.locator(luma.minicartCounter)).toHaveText('1');

            await page.goto('/checkout/cart/');
            await expect(page.locator(luma.cartItemName)).toContainText(product.name);
        });

        // Checkout stops here on purpose. guest-checkout.spec.ts already walks
        // shipping, payment and order placement; what this spec adds is that a
        // product created through the admin reaches a quote at all, and
        // repeating the rest would only make a slow suite slower.
    });
});
