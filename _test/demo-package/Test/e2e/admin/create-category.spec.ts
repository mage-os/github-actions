import { expect, test } from '../fixtures';
import { adminSelectors, adminUrl } from './support';
import { categoryUrl, luma } from '../storefront/luma';

/**
 * A category is the other half of the catalog write path, and almost none of
 * it is shared with the product form.
 *
 * The product form is a UI component form posting to a UI component data
 * provider. The category page is a jstree sidebar driving a form whose product
 * assignment is still a legacy grid widget, saving through a controller that
 * writes the category tree, generates url rewrites for every store view and
 * invalidates the catalog_category_product index. The storefront then has to
 * resolve the new url, render a listing from that index and show the category
 * in a navigation block that was cached before it existed.
 *
 * So this spec creates a subcategory of the root, assigns it a product, and
 * then asks the storefront for a page that did not exist a moment ago and for
 * a menu entry that was cached without it.
 */

const categoryForm = {
    // catalog/category/ is the tree page, and it opens on the root category's
    // own edit form -- so the body class on what looks like an index is
    // -edit. The admin names the action, and the action is editing.
    treeBodyClass: /catalog-category-edit/,
    formBodyClass: /catalog-category-add/,
    savedBodyClass: /catalog-category-edit/,
    tree: '.tree-holder',
    treeNode: 'li.jstree-node > a',
    addSubcategory: '#add_subcategory_button',
    name: 'input[name="name"]',
    isActive: 'input[name="is_active"]',
    // Underscores, deliberately not a typo: the product form's equivalent
    // section is data-index="search-engine-optimization" with hyphens. Same
    // label in the UI, different spelling in the DOM, and the two forms are
    // maintained by different modules' ui_component XML.
    seoSection: "div[data-index='search_engine_optimization'] .fieldset-wrapper-title",
    urlKey: "input[name='url_key']",
    productsSection: "div[data-index='assign_products'] .fieldset-wrapper-title",
    // A legacy grid widget, not a UI component listing: its own table id, its
    // own filter row that applies on Enter, and row checkboxes with no name
    // attribute. adminGrid() does not apply here and should not be stretched
    // to; this grid is a different thing that happens to look similar.
    productsTable: '#catalog_category_products_table',
    productSkuFilter: 'input[name="sku"]',
    save: '#save',
    // Not div[data-ui-id="messages-message-success"]: the category page
    // renders the plain admin message block.
    saved: '.page-content .message-success',
    anyMessage: '.page-content .message-success, .page-content .message-error',
};

test.describe('Creating a category in the admin', () => {
    // As with the product spec: a category save on a cold store pays for code
    // generation and then for the category/product and url rewrite indexers.
    test.setTimeout(300_000);

    test('@admin creates a category and the storefront lists it', async ({ page }) => {
        // Per attempt, not per module: a retry that collided with the url key
        // its own first attempt saved would report "the url key already
        // exists" instead of whatever actually went wrong.
        const stamp = `${Date.now()}`;
        const category = {
            name: `Mage-OS E2E Category ${stamp}`,
            urlKey: `mageos-e2e-category-${stamp}`,
        };

        await test.step('the admin offers a new subcategory form', async () => {
            await page.goto(adminUrl('catalog/category/'));

            await expect(page.locator('body')).toHaveClass(categoryForm.treeBodyClass);
            // The tree is rendered by jstree from a JSON payload, so a visible
            // node is already a statement that the sidebar bootstrapped.
            await expect(page.locator(categoryForm.tree)).toBeVisible();
            await expect(page.locator(categoryForm.treeNode).first()).toBeVisible();

            // No id in the URL, so the page opens on the store's root
            // category and Add Subcategory makes a child of it. That is the
            // level the storefront navigation renders, which is what makes
            // the menu assertion at the end of this spec possible.
            await page.locator(categoryForm.addSubcategory).click();

            await expect(page.locator('body')).toHaveClass(categoryForm.formBodyClass);
            await expect(page).toHaveURL(/catalog\/category\/add\/store\/\d+\/parent\/\d+/);
            await expect(page.locator(categoryForm.name)).toBeVisible();
            // Asserted rather than set. The default is enabled, and a
            // disabled category answers 404 on the storefront -- so if this
            // default ever changes, the failure should be this line and not a
            // mystifying 404 three steps later.
            await expect(page.locator(categoryForm.isActive)).toBeChecked();
        });

        await test.step('the form accepts a name and a url key', async () => {
            await page.locator(categoryForm.name).fill(category.name);
            await expect(page.locator(categoryForm.name)).toHaveValue(category.name);

            // Collapsed on load and rendered lazily, like every other
            // collapsible in the admin: the url key input is not in the DOM
            // until the section is opened.
            await page.locator(categoryForm.seoSection).click();
            await expect(page.locator(categoryForm.urlKey)).toBeVisible();
            await page.locator(categoryForm.urlKey).fill(category.urlKey);
            await expect(page.locator(categoryForm.urlKey)).toHaveValue(category.urlKey);
        });

        let assignedProduct = '';

        await test.step('a product is assigned to the category', async () => {
            await page.locator(categoryForm.productsSection).click();

            const grid = page.locator(categoryForm.productsTable);
            await expect(grid).toBeVisible();

            // Filtered to the fixture's simple products rather than taking
            // whatever sorts first. The fixture also generates a configurable
            // and its variations, and a variation is Not Visible Individually
            // -- it would save here and then be absent from the storefront
            // listing, which would read as a broken category page.
            await grid.locator(categoryForm.productSkuFilter).fill('product_dynamic');
            await grid.locator(categoryForm.productSkuFilter).press('Enter');

            // A legacy grid reloads over AJAX with no response this spec can
            // reliably await, so the filtered state has to be polled for.
            //
            // Polling the row count is not enough, and getting that wrong is
            // what this comment is for: the unfiltered grid already has rows,
            // so "more than zero rows" is satisfied by the table that was on
            // screen before Enter was pressed. The first attempt at this spec
            // read a name off that stale table, then checked a box in the
            // table that replaced it, and asserted on the storefront that the
            // wrong product was listed. Poll for something only the filtered
            // grid can satisfy instead.
            const headers = (await grid.locator('thead th').allInnerTexts()).map((h) => h.trim());
            const nameColumn = headers.indexOf('Name');
            const skuColumn = headers.indexOf('SKU');
            expect(nameColumn, `the grid should have a Name column; it has ${headers}`).toBeGreaterThan(-1);
            expect(skuColumn, `the grid should have a SKU column; it has ${headers}`).toBeGreaterThan(-1);

            await expect
                .poll(
                    async () => {
                        const skus = await grid.locator(`tbody tr td:nth-child(${skuColumn + 1})`).allInnerTexts();
                        return skus.length > 0 && skus.every((sku) => sku.includes('product_dynamic'));
                    },
                    {
                        message: 'the grid should settle on the fixture products; seed the catalog first',
                    },
                )
                .toBe(true);

            const row = grid.locator('tbody tr').first();
            assignedProduct = (await row.locator('td').nth(nameColumn).innerText()).trim();
            expect(assignedProduct, 'the grid row should carry a product name').not.toBe('');

            // No name attribute on these checkboxes -- the value is the
            // product id and the id is id_<product id>. Scoped to the row
            // rather than selected by name, which there is none of.
            await row.locator('input[type="checkbox"]').check();
            await expect(row.locator('input[type="checkbox"]')).toBeChecked();
            // The row that is checked is still the row that was read. If the
            // grid re-rendered between the two, this is where that shows up
            // rather than in a storefront assertion three steps later.
            await expect(row.locator('td').nth(nameColumn)).toHaveText(assignedProduct);
        });

        await test.step('saving the category reports success', async () => {
            await page.locator(categoryForm.save).click();

            // Either message, with the same generous ceiling and the same
            // reasoning as the product spec: a validation error should fail
            // this in a second with its text on screen, and a slow first
            // save on a cold runner should pass slowly rather than go red.
            await expect(page.locator(categoryForm.anyMessage).first()).toBeVisible({ timeout: 240_000 });
            await expect(page.locator(categoryForm.saved)).toContainText('You saved the category.');

            // A persisted entity with an id, not the add form re-rendered
            // with the values still in it.
            await expect(page.locator('body')).toHaveClass(categoryForm.savedBodyClass);
            await expect(page).toHaveURL(/catalog\/category\/edit\/id\/\d+/);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText(category.name);
            // Read back off the saved form: what the store holds, not what
            // the spec typed into a field.
            await expect(page.locator(categoryForm.name)).toHaveValue(category.name);
        });

        await test.step('the storefront serves the category it has never seen', async () => {
            // Straight to the url key. A url rewrite that was not generated
            // for the new category is a 404 here, and that is the failure
            // worth reporting rather than hiding behind navigation clicks.
            const response = await page.goto(categoryUrl(category.urlKey));

            expect(response?.status(), 'the url rewrite for a saved category should resolve').toBe(200);
            await expect(page.locator('body')).toHaveClass(/catalog-category-view/);
            await expect(page.locator(luma.pageTitle)).toContainText(category.name);

            // The listing renders from catalog_category_product, which the
            // save had to invalidate and reindex. An empty category page
            // returns 200 and looks fine, so this is the assertion that the
            // index actually ran.
            // Exactly one product, and it is the one that was assigned. A
            // count assertion as well as an identity one, because a category
            // that lists the whole catalog is also broken -- and that is what
            // a misconfigured anchor or display mode looks like.
            const listing = page.locator(luma.productList);
            await expect(listing.locator(luma.productItemLink)).toHaveCount(1);
            await expect(listing.locator(luma.productItemLink)).toHaveText(assignedProduct);
        });

        await test.step('the navigation includes the category', async () => {
            // The top menu is a cached block, and it was cached before this
            // category existed. Saving a category has to invalidate it, which
            // is a seam nothing else in this suite touches: a stale menu is a
            // merchant-visible bug that no amount of product testing finds.
            await expect(
                page.locator(luma.navCategory).filter({ hasText: category.name }),
            ).toHaveCount(1);
        });
    });
});
