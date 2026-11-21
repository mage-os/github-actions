import { type Page, type Request } from '@playwright/test';
import { expect, test } from '../fixtures';
import { adminGrid, adminSelectors, adminUrl } from './support';
import { parseMoney } from '../storefront/support';

/**
 * Placing an order from the admin, which is how a merchant takes a phone
 * order and the only part of the sales flow a storefront spec cannot reach.
 *
 * It is a different code path from guest-checkout.spec.ts, not a second run
 * at the same one. The storefront builds a quote through the REST API and
 * Magento_Checkout's knockout components; this page builds one through
 * Magento\Sales\Controller\Adminhtml\Order\Create and a Prototype-era form
 * that re-renders itself on the server after every change. They share the
 * quote model, the shipping and payment method pools and the order placement,
 * and nothing else.
 *
 * ## The one thing that makes this page testable
 *
 * Every interaction here -- choosing a customer, adding a product, changing
 * the country, asking for shipping rates, picking a payment method -- is a
 * POST to sales/order_create/loadBlock that returns fresh HTML for part of
 * the form. There is no "the page is ready" state, no loading mask that is
 * reliably present, and the next action's target often does not exist until
 * the previous reload lands.
 *
 * Waiting on timeouts does not work, and fails in the worst possible way.
 * Measured while writing this spec: adding a product, reading the items grid
 * 700ms later and asserting on it produced "No ordered items" -- the add had
 * been accepted, the grid had not re-rendered yet. A spec written that way
 * would then select a shipping method for an empty order, get no rates, and
 * fail three steps away from the thing that was actually fine.
 *
 * So this spec tracks those requests and waits for them to stop. That is what
 * formReloads() below is, and it is the only reason the rest of this reads as
 * simply as it does.
 */

const orderForm = {
    // sales-order_create-index, with the underscore: the body class is the
    // full action name, and the route is sales/order_create.
    startBodyClass: /sales-order_create-index/,
    viewBodyClass: /sales-order-view/,
    createNewCustomer: '#order-customer-selector .actions button.primary',
    email: '#email',
    group: '#group_id',
    addProducts: '#order-items button',
    searchGrid: '#sales_order_create_search_grid',
    searchGridTable: '#sales_order_create_search_grid_table > tbody tr',
    skuFilter: '#sales_order_create_search_grid_filter_sku',
    applyFilter: '#sales_order_create_search_grid [data-action="grid-filter-apply"]',
    addSelected: '#order-search .admin__page-section-title .actions button.action-add',
    itemsGrid: '#order-items_grid',
    billing: {
        country: '#order-billing_address_country_id',
        firstName: '#order-billing_address_firstname',
        lastName: '#order-billing_address_lastname',
        street: '#order-billing_address_street0',
        city: '#order-billing_address_city',
        regionSelect: '#order-billing_address_region_id',
        regionInput: '#order-billing_address_region',
        postcode: '#order-billing_address_postcode',
        telephone: '#order-billing_address_telephone',
    },
    getShippingRates: '#order-shipping_method a.action-default',
    flatRate: '#s_method_flatrate_flatrate',
    shippingSection: '#order-shipping_method',
    paymentSection: '#order-billing_method',
    // Expands the payment block when it has collapsed to a summary line.
    paymentSummaryLink: '#order-billing_method_summary > a',
    checkMoneyOrder: '#p_method_checkmo',
    totals: '#order-totals',
    // Relative to `totals`, and by label rather than by row position: a
    // store with tax or a discount renders extra rows between these two.
    subtotalRow: 'tr.row-totals:has-text("Subtotal") .price',
    grandTotalRow: 'tr.row-totals:has-text("Grand Total") .price',
    submit: '#submit_order_top_button',
    saved: '.message-success',
    orderStatus: '#order_status',
    // The saved order's own items table, which is a different block from the
    // form's: Order\View\Items renders .edit-order-table, with the sku in
    // its own element and the quantity as a breakdown ("Ordered 2").
    orderedItems: '.edit-order-table',
};

const buyer = {
    firstName: 'Mage-OS',
    street: '1 Open Source Way',
    city: 'Austin',
    // Texas. Overridable for the same reason guest-checkout's is: a store
    // installed for another country has different region ids.
    regionId: process.env.E2E_REGION_ID ?? '57',
    region: 'Texas',
    postcode: '78701',
    telephone: '5125550123',
    countryId: process.env.E2E_COUNTRY_ID ?? 'US',
};

/**
 * Watches the form's own reloads so a step can wait for the page to stop
 * rebuilding itself before it touches the result.
 *
 * Counting requests rather than awaiting one named response, because a single
 * action can trigger more than one -- filling the address fires a reload on
 * change, and the click that follows fires another -- and awaiting "the next
 * one" then returns on the wrong reload and reads a half-built form.
 */
function formReloads(page: Page) {
    const isReload = (request: Request) => /order_create\/(loadBlock|addProducts)/i.test(request.url());
    let pending = 0;
    let lastFinished = Date.now();

    page.on('request', (request) => {
        if (isReload(request)) pending += 1;
    });
    const finish = (request: Request) => {
        if (isReload(request)) {
            pending = Math.max(0, pending - 1);
            lastFinished = Date.now();
        }
    };
    page.on('requestfinished', finish);
    page.on('requestfailed', finish);

    return {
        /** Resets the clock, for the first wait after a full page load. */
        restart(): void {
            pending = 0;
            lastFinished = Date.now();
        },

        /**
         * Resolves once nothing is in flight and nothing new has started for
         * a short quiet period. The quiet period is what catches the second
         * reload an action triggers after the first one finished.
         */
        async settled(quietFor = 1_000): Promise<void> {
            await expect
                .poll(() => pending === 0 && Date.now() - lastFinished > quietFor, {
                    message: 'the order form should stop reloading itself',
                    timeout: 120_000,
                    intervals: [200],
                })
                .toBe(true);
        },
    };
}

test.describe('Creating an order in the admin', () => {
    // Long by design: a dozen server round trips, each re-rendering part of
    // the form, on a store that may also be building static assets.
    test.setTimeout(300_000);

    test('@admin places an order for a new customer', async ({ page }) => {
        const form = formReloads(page);
        const stamp = `${Date.now()}`;
        const customer = {
            lastName: `Order ${stamp}`,
            email: `mageos-e2e-order-${stamp}@example.test`,
        };
        const quantity = 2;

        let sku = '';
        let productName = '';
        let unitPrice = 0;

        await test.step('the create-order page opens on a new customer', async () => {
            await page.goto(adminUrl('sales/order_create/start/'));
            form.restart();

            await expect(page.locator('body')).toHaveClass(orderForm.startBodyClass);
            // "Create New Order in Default Store View" on a single-store
            // install. A store with more than one view asks which one first,
            // which this spec would have to answer -- so the title is worth
            // asserting: it is how that difference shows up.
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('Create New Order');

            await page.locator(orderForm.createNewCustomer).first().click();
            await form.settled();

            // The account section is what the new-customer choice renders.
            await expect(page.locator(orderForm.email)).toBeVisible();
            await expect(page.locator(orderForm.group)).not.toHaveValue('');
        });

        await test.step('a fixture product goes on the order', async () => {
            await page.locator(orderForm.addProducts).filter({ hasText: 'Add Products' }).first().click();
            await form.settled();

            await expect(page.locator(orderForm.searchGrid)).toBeVisible();

            // The sku filter is a LIKE, so this narrows the grid rather than
            // selecting a row: product_dynamic matches every fixture simple.
            await page.fill(orderForm.skuFilter, 'product_dynamic');
            await page.locator(orderForm.applyFilter).click();
            await form.settled();

            const rows = page.locator(orderForm.searchGridTable);
            await expect(rows.first(), 'the fixture catalog should fill this grid').toBeVisible();

            // Read the row rather than assume a sku. Which fixture product
            // comes first is not this spec's business, and the numbering is
            // not contiguous -- the profile's first simple is
            // product_dynamic_2.
            const row = rows.first();
            const cells = (await row.locator('td').allInnerTexts()).map((cell) => cell.trim());
            sku = cells.find((cell) => /^product_dynamic_\d+$/.test(cell)) ?? '';
            productName = cells.find((cell) => /^Simple Product/.test(cell)) ?? '';
            unitPrice = parseMoney(cells.find((cell) => /^\$/.test(cell)) ?? '');

            expect(sku, `the row should carry a fixture sku; it reads: ${cells.join(' | ')}`).not.toBe('');
            expect(unitPrice, 'the row should carry a price').toBeGreaterThan(0);

            // click(), not check(): this is the legacy grid widget, whose
            // selection is wired to the checkbox's click handler. check()
            // sets the property, the handler never runs, and the product is
            // not added -- with no error anywhere.
            await row.locator('td.col-select input[type="checkbox"]').click();
            await row.locator('td.col-qty input[name="qty"]').fill(String(quantity));

            await page.locator(orderForm.addSelected).click();
            await form.settled();

            const items = page.locator(orderForm.itemsGrid);
            await expect(items).toContainText(sku);
            await expect(items, 'the items grid should report what it holds').toContainText(
                '1 product(s)',
            );
        });

        await test.step('the order gets an account and an address', async () => {
            await page.fill(orderForm.email, customer.email);

            // The country goes first and on its own: changing it reloads the
            // address block to swap the region field between a select and a
            // free-text input, which discards anything typed before it.
            await page.selectOption(orderForm.billing.country, buyer.countryId);
            await form.settled();

            await page.fill(orderForm.billing.firstName, buyer.firstName);
            await page.fill(orderForm.billing.lastName, customer.lastName);
            await page.fill(orderForm.billing.street, buyer.street);
            await page.fill(orderForm.billing.city, buyer.city);

            const regionSelect = page.locator(orderForm.billing.regionSelect);
            if (await regionSelect.isVisible()) {
                await regionSelect.selectOption(buyer.regionId);
            } else {
                await page.fill(orderForm.billing.regionInput, buyer.region);
            }

            await page.fill(orderForm.billing.postcode, buyer.postcode);
            await page.fill(orderForm.billing.telephone, buyer.telephone);

            // The address reaches the quote when a field loses focus, and the
            // shipping rates below are quoted against the quote. Without this
            // the rates are requested for an address the server has not been
            // told about yet.
            await page.locator(orderForm.billing.telephone).blur();
            await form.settled();
        });

        let shipping = 0;

        await test.step('the carrier quotes a rate and the method is chosen', async () => {
            await page.locator(orderForm.getShippingRates).first().click();
            await form.settled();

            // Flat Rate is active in a shipped store
            // (OfflineShipping's config.xml: carriers/flatrate/active = 1),
            // which is what makes it the right method for a release gate: no
            // credentials, no external service, and it still goes through the
            // carrier pool and the rate request.
            await expect(
                page.locator(orderForm.flatRate),
                'flat rate should be offered for a complete address',
            ).toBeVisible();
            await page.locator(orderForm.flatRate).check();
            await form.settled();

            await expect(page.locator(orderForm.shippingSection)).toContainText('Flat Rate');
        });

        await test.step('check / money order takes the payment', async () => {
            const checkMoneyOrder = page.locator(orderForm.checkMoneyOrder);

            // Attached, not visible. A store that offers exactly one payment
            // method -- which a shipped store does: check / money order is
            // the only active one -- has the admin apply it as soon as the
            // order has a total, and the block collapses to a summary line
            // with the radio still in the DOM, checked and hidden.
            //
            // So this cannot assert visibility and cannot insist on clicking.
            // Measured: it fails with `42 x locator resolved to <input ...
            // id="p_method_checkmo" checked="checked"> - unexpected value
            // "hidden"`, which reads as a missing payment method rather than
            // as one that was already chosen.
            await expect(
                checkMoneyOrder,
                'check / money order should be offered; it is active in a shipped store',
            ).toBeAttached();

            const summary = page.locator(orderForm.paymentSummaryLink);
            if (!(await checkMoneyOrder.isVisible()) && (await summary.count())) {
                await summary.first().click();
                await form.settled();
            }

            // Only if the store has not already decided. On a store with
            // several active methods this is the real choice; on a shipped
            // one it is a no-op, and both have to work.
            if (!(await checkMoneyOrder.isChecked())) {
                await checkMoneyOrder.check();
                await form.settled();
            }

            await expect(checkMoneyOrder).toBeChecked();
            await expect(page.locator(orderForm.paymentSection)).toContainText('Check / Money order');

            const totals = page.locator(orderForm.totals);
            const subtotal = parseMoney(await totals.locator(orderForm.subtotalRow).first().innerText());
            const grandTotal = parseMoney(await totals.locator(orderForm.grandTotalRow).first().innerText());
            shipping = grandTotal - subtotal;

            // The same arithmetic the cart spec checks on the storefront,
            // against the same collectors through a different front end.
            expect(subtotal, `${unitPrice} x ${quantity} should be the order subtotal`).toBeCloseTo(
                unitPrice * quantity,
                2,
            );
            expect(grandTotal, 'the grand total should include shipping').toBeGreaterThan(subtotal);
            expect(shipping, 'flat rate should charge for the shipment').toBeGreaterThan(0);
        });

        let incrementId = '';

        await test.step('submitting it creates the order', async () => {
            await page.locator(orderForm.submit).click();

            await expect(page.locator(orderForm.saved)).toContainText('You created the order.');
            await expect(page).toHaveURL(/\/sales\/order\/view\/order_id\/\d+/);
            await expect(page.locator('body')).toHaveClass(orderForm.viewBodyClass);

            // Pending is what an offline payment method leaves an order on.
            // A store whose order status mapping is broken reaches this page
            // and shows something else.
            await expect(page.locator(orderForm.orderStatus)).toHaveText('Pending');

            incrementId = (await page.locator(adminSelectors.pageTitle).innerText()).trim().replace(/^#/, '');
            expect(incrementId, 'the order view is titled with the increment id').toMatch(/^\d+$/);

            // The persisted order item, read from the saved order rather than
            // from the form that created it. Scoped to the row that carries
            // the sku, because the column classes are on the header cells
            // too: an unscoped .col-ordered-qty matches the "Qty" heading
            // first, and the failure then quotes the heading at you.
            const item = page
                .locator(`${orderForm.orderedItems} tbody tr`)
                .filter({ hasText: sku })
                .first();
            await expect(item, 'the saved order should hold the product that was added').toBeVisible();
            await expect(item).toContainText(productName);
            await expect(item.locator('.col-ordered-qty')).toContainText(String(quantity));
        });

        await test.step('the order grid lists it', async () => {
            // Asserted here, and deliberately not asserted in
            // create-customer.spec.ts, because the two grids behave
            // differently and the difference is in the shipped
            // configuration: sales/general/async_indexing is 0, so
            // sales_order_grid is written in the same request that saves the
            // order, while the customer grid waits for an indexer that this
            // store has no cron to run. One is a fair assertion and the other
            // is a red test against a working store.
            await page.goto(adminUrl('sales/order/'));

            const grid = adminGrid(page, 'sales_order_grid');
            await grid.ready();
            await grid.startUnfiltered();
            await grid.filterBy('increment_id', incrementId);

            await expect(grid.rows).toHaveCount(1);
            await expect(grid.rows.first()).toContainText(incrementId);
            await expect(grid.rows.first()).toContainText('Pending');

            // Left clean: grid filters are saved per admin user in
            // ui_bookmark, so a filter this spec leaves behind is a filter
            // the next spec inherits.
            await grid.clearFilters();
        });
    });
});
