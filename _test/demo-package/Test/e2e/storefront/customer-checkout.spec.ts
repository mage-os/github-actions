import { expect, test } from '../fixtures';
import { luma } from './luma';
import {
    fillAddressFields,
    newShopper,
    registerCustomer,
    selectRequiredOptions,
    shopperAddress,
} from './support';

/**
 * Checkout as a signed-in customer, which is not the guest path with a
 * session attached.
 *
 * guest-checkout.spec.ts already walks catalog -> cart -> shipping -> payment
 * -> order, so this spec is written around the four things that only happen
 * when the shopper has an account, each measured on this store rather than
 * assumed:
 *
 * - The address book. A customer saves an address through
 *   Magento_Customer's own form, and the first one saved becomes the default
 *   for billing and shipping. Nothing else in this suite touches
 *   customer_address_entity from the storefront.
 * - Checkout reading it. The saved address arrives preselected and the email
 *   step is not rendered at all -- #customer-email is not in the page, where
 *   a guest gets it as the first thing to fill. So checkout is proving it
 *   knows who is shopping, which is a different code path from the guest
 *   quote entirely.
 * - The order belonging to someone. A guest order is attached to an email
 *   address; this one is attached to a customer id, and that association is
 *   what makes the next two assertions possible.
 * - The account keeping it. My Orders lists the increment id, and the order
 *   page renders the sku that was bought. A release where orders place but do
 *   not appear in the customer's account passes every other test here.
 *
 * It asserts the increment id the success page gave it on all three pages, so
 * what is being checked is that one order moved through, not that each page
 * renders something plausible.
 */

test.describe('Signed-in checkout', () => {
    test(
        'places an order on a saved address and keeps it in the account',
        { tag: ['@checkout', '@customer'] },
        async ({ page }) => {
            const customer = newShopper();
            let sku = '';
            let productName = '';
            let orderNumber = '';

            await test.step('a shopper has an account', async () => {
                await registerCustomer(page, customer);

                // Registration signs the customer in, so there is no sign-in
                // step here. customer-account.spec.ts owns the form itself;
                // this only needs the session it opens.
                await expect(page).toHaveURL(/\/customer\/account\/?$/);
                await expect(page.locator(luma.successMessage)).toContainText(
                    'Thank you for registering with',
                );
            });

            await test.step('the address book takes a shipping address', async () => {
                await page.goto('/customer/address/new/');
                await expect(page.locator('body')).toHaveClass(/customer-address-form/);

                const form = page.locator(luma.addressForm);

                // The form arrives knowing whose it is. Asserted before
                // anything is typed: a new-address form that does not carry
                // the customer's name is reading the wrong entity, and that
                // would otherwise be invisible -- the address saves either
                // way.
                await expect(
                    form.locator(luma.registerFirstName),
                    'the account form should prefill the customer name',
                ).toHaveValue(customer.firstName);
                await expect(form.locator(luma.registerLastName)).toHaveValue(customer.lastName);

                await fillAddressFields(form);
                await page.locator(luma.addressSubmit).click();

                await expect(page.locator('body')).toHaveClass(/customer-address-index/);
                await expect(page.locator(luma.successMessage)).toContainText('You saved the address.');

                // Read back out of the database, through the Address Book's
                // own rendering of it. The first address a customer saves is
                // made default for billing and shipping, which is why
                // checkout can preselect it below.
                const defaultBilling = page.locator(luma.defaultBillingAddress);
                await expect(
                    defaultBilling,
                    'the first saved address should become the default billing address',
                ).toContainText(shopperAddress.street);
                await expect(defaultBilling).toContainText(shopperAddress.city);
            });

            await test.step('the signed-in shopper fills a cart', async () => {
                await page.goto('/');

                const category = page.locator(luma.navCategory).first();
                await expect(category, 'the fixture categories should appear in the main navigation').toBeVisible();
                await category.click();
                await page.locator(luma.productItemLink).first().click();

                await expect(page.locator('body')).toHaveClass(/catalog-product-view/);
                productName = ((await page.locator(luma.pageTitle).textContent()) ?? '').trim();
                sku = ((await page.locator(luma.productSku).textContent()) ?? '').trim();
                expect(sku, 'a product page should render a sku').not.toBe('');

                await selectRequiredOptions(page);
                await page.locator(luma.addToCart).click();

                await expect(page.locator(luma.cartSuccess)).toContainText('to your shopping cart');
                // The counter comes from customer-data, which for a signed-in
                // shopper is a different section payload than a guest's.
                await expect(page.locator(luma.minicartCounter)).toHaveText('1');
            });

            await test.step('checkout already knows the shopper and the address', async () => {
                await page.goto('/checkout/');

                // Not a visibility check: for a signed-in shopper the email
                // step is not rendered at all. Measured on this store, zero
                // copies of it in the page, where a guest gets one.
                await expect(
                    page.locator(luma.checkoutEmail),
                    'checkout should not ask a signed-in customer for an email address',
                ).toHaveCount(0);

                const selected = page.locator(luma.checkoutSelectedAddress);
                await expect(
                    selected,
                    'the default address should arrive preselected, not as an empty form',
                ).toBeVisible();
                await expect(selected).toContainText(shopperAddress.street);
                await expect(selected).toContainText(shopperAddress.postcode);

                // The new-address form is in the DOM and hidden -- it is the
                // New Address popup. Hidden is the assertion; absent would be
                // wrong and present would mean nothing.
                await expect(
                    page.locator(luma.shippingForm),
                    'a shopper with a saved address should not be shown an empty address form',
                ).not.toBeVisible();

                const flatRate = page.locator(luma.shippingMethod);
                await expect(flatRate, 'Flat Rate should be offered for the saved address').toBeVisible();
                await flatRate.check();
                await page.locator(luma.nextButton).click();
            });

            await test.step('the payment step places the order', async () => {
                await expect(page.locator(luma.paymentSection)).toBeVisible();

                // The recap the payment step renders, which is the server's
                // view of the address the quote now carries rather than the
                // selection made a moment ago.
                await expect(page.locator(luma.checkoutShipTo).first()).toContainText(shopperAddress.street);

                await expect(
                    page.locator('input[value="checkmo"]'),
                    'Check / Money order should be available',
                ).toBeChecked();
                await page.locator(luma.placeOrder).click();
            });

            await test.step('the order confirms with a link to itself', async () => {
                await expect(page).toHaveURL(/checkout\/onepage\/success/);
                await expect(page.locator(luma.successPageTitle)).toContainText('Thank you for your purchase');

                // A guest gets a bare span here. A customer who can open the
                // order gets a link to it, and that link is the association
                // between the order and the account being asserted -- so the
                // href is checked, not just the digits.
                const number = page.locator(luma.successOrderNumber);
                await expect(number, 'a signed-in shopper should get a link to the order').toBeVisible();
                await expect(number).toHaveAttribute('href', /sales\/order\/view\/order_id\/\d+/);

                orderNumber = ((await number.textContent()) ?? '').trim();
                expect(orderNumber, 'the success page should name an increment id').toMatch(/^\d{9}$/);
            });

            await test.step('My Orders lists the order', async () => {
                await page.goto('/sales/order/history/');
                await expect(page.locator('body')).toHaveClass(/sales-order-history/);

                // One row, because the account was created in this test: a
                // grid that showed another customer's orders would be a
                // serious defect and this is where it would show.
                const rows = page.locator(luma.orderHistoryRow);
                await expect(rows, 'a new account should list exactly the order it just placed').toHaveCount(1);

                const row = rows.first();
                await expect(row.locator(luma.orderHistoryId)).toHaveText(orderNumber);
                await expect(
                    row.locator(luma.orderHistoryStatus),
                    'a Check / Money order order should be Pending',
                ).toHaveText('Pending');

                await row.locator(luma.orderHistoryView).click();
            });

            await test.step('the order page renders what was bought', async () => {
                await expect(page.locator('body')).toHaveClass(/sales-order-view/);
                await expect(page.locator(luma.pageTitle)).toContainText(orderNumber);
                await expect(page.locator(luma.orderStatus)).toHaveText('Pending');

                // The sku read off the product page before it was added to
                // the cart: the catalogue, the quote and the order all
                // agreeing on which product this was.
                await expect(
                    page.locator(luma.orderItemSku),
                    'the order should carry the sku that was added to the cart',
                ).toHaveText(sku);
                await expect(page.locator(luma.orderItemName)).toContainText(productName);
            });
        },
    );
});
