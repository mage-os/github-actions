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
 *
 * ## Why it goes on to invoice and ship
 *
 * Placing the order is only the first transition. An order that is created and
 * then cannot be invoiced or shipped is a store that cannot be run, and
 * nothing before this spec's last three steps touches that: the invoice and
 * the shipment are separate entities with their own grids, their own sequence
 * tables and their own totals, and creating them is what moves the order
 * through new -> processing -> complete.
 *
 * They are steps of this test rather than a spec of their own because they
 * need an order that nothing else has invoiced, and placing one costs the
 * dozen round trips above. A second spec would pay that twice to assert
 * something this one is already holding in its hand. The credit memo at the
 * end is there for the same reason, and it is the one document that can only
 * be made from an order already paid for: new -> processing -> complete ->
 * closed is the whole of the order state machine a store with no gateway
 * credentials can reach.
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
    // Order\View::_construct adds these two by id, each behind its own
    // guard: order_invoice only while canInvoice(), order_ship only while
    // canShip(). So their absence is an assertion of its own -- see the last
    // two lines of the shipping step.
    invoiceButton: '#order_invoice',
    shipButton: '#order_ship',
    // order_creditmemo is added while canCreditmemo(), i.e. while the order
    // has been paid for more than it has been refunded. Its onclick is a
    // plain setLocation here: Order\View wraps it in confirmSetLocation only
    // when the payment method isGateway(), and Check / Money order is not
    // one, so this click navigates rather than opening a dialog.
    creditMemoButton: '#order_creditmemo',
    // The invoice page and the shipment page submit through the same widget.
    // Invoice\Create\Items and Shipping's Create\Items both add a
    // Backend\Widget\Button with class "save submit-button primary" and no
    // id, so the label is the only thing that tells them apart -- which is
    // why the steps below filter on it rather than trusting the page they
    // think they are on.
    submitDocument: 'button.submit-button',
    emailCopy: '#send_email',
    // The saved order and the three document pages render their totals
    // through Magento_Sales::order/totals.phtml, which is not the markup the
    // create form above uses -- order/create/totals.phtml renders
    // tr.row-totals -- so this spec needs two sets of totals selectors.
    //
    // Addressed by label for a second reason as well. totals.phtml names each
    // row tr.col-<code> from the key of the totals array, and those keys are
    // positional, not the totals' own codes. Measured: the invoice's rows are
    // col-0 (Grand Total), col-0 (Subtotal), col-1 (Shipping), and the saved
    // order's are col-0 (Grand Total), col-1 (Total Paid), col-2 (Total
    // Refunded), col-3 (Total Due). The class says nothing about what the row
    // holds and is not even unique.
    documentGrandTotal: '#invoice_totals tr:has-text("Grand Total") .price',
    creditMemoGrandTotal: '.creditmemo-totals tr:has-text("Grand Total") .price',
    viewTotalPaid: 'table.order-subtotal-table tr:has-text("Total Paid") .price',
    viewTotalRefunded: 'table.order-subtotal-table tr:has-text("Total Refunded") .price',
    viewTotalDue: 'table.order-subtotal-table tr:has-text("Total Due") .price',
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

    test('@admin takes an order from placed to refunded', async ({ page }) => {
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
            //
            // Applied with Enter rather than by clicking Search, because the
            // grid re-renders itself while the filter is being typed and the
            // button goes with it: observed in CI as `locator.click` timing
            // out for 20s on a Search button that resolved but was never
            // visible. varienGrid binds keypress on every filter input and
            // calls doFilter() on Enter, which is both what a person does and
            // the one path that does not need the button to survive.
            await page.fill(orderForm.skuFilter, 'product_dynamic');
            await page.locator(orderForm.skuFilter).press('Enter');
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
        let grandTotal = 0;

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
            grandTotal = parseMoney(await totals.locator(orderForm.grandTotalRow).first().innerText());
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
        let orderId = '';

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

            // Kept because the steps after the grid have to come back here,
            // and every admin sales route addresses an order by its entity
            // id, never by the increment id a person reads.
            orderId = page.url().match(/order_id\/(\d+)/)?.[1] ?? '';
            expect(orderId, `the order view URL should carry an entity id: ${page.url()}`).toMatch(/^\d+$/);

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

        await test.step('invoicing it takes the payment', async () => {
            await page.goto(adminUrl(`sales/order/view/order_id/${orderId}/`));

            const invoice = page.locator(orderForm.invoiceButton);
            await expect(
                invoice,
                'a pending order paid by an offline method should offer an invoice',
            ).toBeVisible();
            await invoice.click();

            await expect(page).toHaveURL(/order_invoice\/new/);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('New Invoice');

            // Deliberately left alone rather than cleared. It ships unchecked
            // -- Invoice\Create\Items renders no checked attribute -- and
            // this spec depends on that: a store that pre-checked it would
            // have this step send mail through whatever transport the gate
            // installed, and the failure would surface as a mail error on an
            // invoice that was otherwise fine.
            await expect(
                page.locator(orderForm.emailCopy),
                'the invoice email should be opt-in, so this spec sends none',
            ).not.toBeChecked();

            const invoiceTotal = parseMoney(
                await page.locator(orderForm.documentGrandTotal).first().innerText(),
            );
            expect(invoiceTotal, 'the default invoice should be for the whole order').toBeCloseTo(
                grandTotal,
                2,
            );

            await page
                .locator(orderForm.submitDocument)
                .filter({ hasText: 'Submit Invoice' })
                .first()
                .click();

            await expect(page.locator(orderForm.saved)).toContainText('The invoice has been created.');
            await expect(page).toHaveURL(new RegExp(`sales/order/view/order_id/${orderId}`));

            // The first real transition: new -> processing. A store whose
            // status mapping is broken creates the invoice and leaves the
            // order where it was.
            await expect(
                page.locator(orderForm.orderStatus),
                'an invoiced order is no longer pending',
            ).toHaveText('Processing');

            // Check / money order cannot capture, so Invoice::register()
            // marks the invoice paid as it creates it and the order's paid
            // total is the whole amount. On a gateway method this would be
            // zero until the capture came back, which is why this assertion
            // belongs with the offline method the gate installs rather than
            // in a helper that claims to hold for any payment.
            const paid = parseMoney(await page.locator(orderForm.viewTotalPaid).first().innerText());
            expect(paid, 'an offline invoice is paid as it is created').toBeCloseTo(grandTotal, 2);

            const due = parseMoney(await page.locator(orderForm.viewTotalDue).first().innerText());
            expect(due, 'a fully invoiced order has nothing left due').toBeCloseTo(0, 2);
        });

        await test.step('shipping it completes it', async () => {
            const ship = page.locator(orderForm.shipButton);
            await expect(ship, 'an invoiced order should still be shippable').toBeVisible();
            await ship.click();

            await expect(page).toHaveURL(/order_shipment\/new/);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('New Shipment');

            await page
                .locator(orderForm.submitDocument)
                .filter({ hasText: 'Submit Shipment' })
                .first()
                .click();

            await expect(page.locator(orderForm.saved)).toContainText('The shipment has been created.');
            await expect(
                page.locator(orderForm.orderStatus),
                'invoiced and shipped in full is what Complete means',
            ).toHaveText('Complete');

            // Asserted by absence, which is the only way this page states it:
            // canInvoice() and canShip() are both false once every item is
            // invoiced and shipped, and Order\View::_construct then adds
            // neither button. An order that still offers them is one whose
            // item quantities did not move.
            await expect(
                page.locator(orderForm.invoiceButton),
                'a fully invoiced order should not offer another invoice',
            ).toHaveCount(0);
            await expect(
                page.locator(orderForm.shipButton),
                'a fully shipped order should not offer another shipment',
            ).toHaveCount(0);
        });

        await test.step('refunding it closes it', async () => {
            const creditMemo = page.locator(orderForm.creditMemoButton);
            await expect(
                creditMemo,
                'an order that has been paid for should be refundable',
            ).toBeVisible();
            await creditMemo.click();

            await expect(page).toHaveURL(/order_creditmemo\/new/);
            // "New Memo", not "New Credit Memo". Asserted because it is the
            // one of these three pages whose heading does not read the way
            // the button that reached it does.
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('New Memo');

            await expect(
                page.locator(orderForm.emailCopy),
                'the credit memo email should be opt-in too',
            ).not.toBeChecked();

            // The memo arrives filled in for the whole order: the item rows
            // carry their ordered quantity and creditmemo[shipping_amount]
            // is prefilled with the shipping that is still refundable, so
            // submitting it as it stands refunds everything. If a release
            // ever stopped prefilling the shipping, this is the assertion
            // that says so -- the refund would simply come up short.
            const refundTotal = parseMoney(
                await page.locator(orderForm.creditMemoGrandTotal).first().innerText(),
            );
            expect(
                refundTotal,
                'the default memo should refund the whole order, shipping included',
            ).toBeCloseTo(grandTotal, 2);

            // Refund Offline is the only button an offline method offers --
            // Creditmemo\Create\Items adds "Refund" as well only when the
            // payment can refund online. Filtering on the label means a store
            // that did offer both does not have this step pick by accident.
            await page
                .locator(orderForm.submitDocument)
                .filter({ hasText: 'Refund Offline' })
                .first()
                .click();

            await expect(page.locator(orderForm.saved)).toContainText('You created the credit memo.');
            await expect(page).toHaveURL(new RegExp(`sales/order/view/order_id/${orderId}`));

            // The last transition this store can reach: complete -> closed.
            await expect(
                page.locator(orderForm.orderStatus),
                'an order refunded in full is closed',
            ).toHaveText('Closed');

            const refunded = parseMoney(
                await page.locator(orderForm.viewTotalRefunded).first().innerText(),
            );
            expect(refunded, 'the whole amount should be refunded').toBeCloseTo(grandTotal, 2);

            // Asserted by absence again: canCreditmemo() compares what was
            // paid against what was refunded, so a second memo is offered
            // only if the first one did not account for everything.
            await expect(
                page.locator(orderForm.creditMemoButton),
                'a fully refunded order should not offer another credit memo',
            ).toHaveCount(0);
        });

        await test.step('every document is listed under the order it belongs to', async () => {
            // The same synchronous-grid argument as the order grid above:
            // sales/general/async_indexing is 0, so sales_invoice_grid,
            // sales_shipment_grid and sales_creditmemo_grid are each written
            // in the request that saves their entity. These are three grids
            // over three tables, so a release that broke one of their
            // indexers would leave the order grid above green.
            await page.goto(adminUrl('sales/invoice/'));

            const invoices = adminGrid(page, 'sales_order_invoice_grid');
            await invoices.ready();
            await invoices.startUnfiltered();
            await invoices.filterBy('order_increment_id', incrementId);

            await expect(invoices.rows).toHaveCount(1);
            await expect(invoices.rows.first()).toContainText(incrementId);
            // Still Paid after the refund: refunding the order does not
            // unpay its invoice, it adds a credit memo beside it.
            await expect(invoices.rows.first(), 'the invoice should be listed as paid').toContainText(
                'Paid',
            );
            await invoices.clearFilters();

            await page.goto(adminUrl('sales/shipment/'));

            const shipments = adminGrid(page, 'sales_order_shipment_grid');
            await shipments.ready();
            await shipments.startUnfiltered();
            await shipments.filterBy('order_increment_id', incrementId);

            await expect(shipments.rows).toHaveCount(1);
            await expect(shipments.rows.first()).toContainText(incrementId);
            await shipments.clearFilters();

            await page.goto(adminUrl('sales/creditmemo/'));

            const memos = adminGrid(page, 'sales_order_creditmemo_grid');
            await memos.ready();
            await memos.startUnfiltered();
            await memos.filterBy('order_increment_id', incrementId);

            await expect(memos.rows).toHaveCount(1);
            await expect(memos.rows.first()).toContainText(incrementId);
            await expect(memos.rows.first(), 'the memo should be listed as refunded').toContainText(
                'Refunded',
            );
            await memos.clearFilters();
        });
    });
});
