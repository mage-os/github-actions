import { test, expect, type Page } from '@playwright/test';

// The deepest path a storefront check can walk: catalog -> product -> cart ->
// shipping -> payment -> order. It touches the layered navigation, the price
// index, the quote, the shipping and payment method pools, the order
// placement and the private-content sections that Varnish punches holes for.
// If a release breaks any of those, this fails and the homepage check does not.
//
// It needs a salable product, which a bare setup:install does not have. See
// fixtures/mageos-e2e.xml.

const shopper = {
    email: `mageos-e2e-${Date.now()}@example.com`,
    firstname: 'Mage',
    lastname: 'Tester',
    street: '1 Open Source Way',
    city: 'Austin',
    regionId: process.env.E2E_REGION_ID ?? '57', // Texas
    postcode: '78701',
    telephone: '5125550123',
    countryId: process.env.E2E_COUNTRY_ID ?? 'US',
};

// Every selector below is Luma's. Keeping them in one place is what makes the
// Hyva variant of this suite a copy of this file with a different map, rather
// than a rewrite.
const luma = {
    navCategory: '.navigation li.level0 > a',
    productItem: '.product-item-info',
    productItemLink: 'a.product-item-link',
    addToCart: '#product-addtocart-button',
    cartSuccess: '.message-success',
    minicartCounter: '.minicart-wrapper .counter-number',
    cartItemName: '.cart.item .product-item-name',
    proceedToCheckout: 'button[data-role="proceed-to-checkout"]',
    checkoutEmail: '#customer-email',
    shippingForm: '#co-shipping-form',
    shippingMethod: 'input[value="flatrate_flatrate"]',
    nextButton: 'button[data-role="opc-continue"]',
    paymentSection: '#checkout-step-payment',
    placeOrder: '#checkout-payment-method-load button.action.checkout.primary',
    successPageTitle: '.page-title',
    successBlock: '.checkout-success',
};

async function fillShippingAddress(page: Page) {
    const form = page.locator(luma.shippingForm);

    // The country select repopulates the region field, so it goes first.
    await form.locator('select[name="country_id"]').selectOption(shopper.countryId);
    await form.locator('input[name="firstname"]').fill(shopper.firstname);
    await form.locator('input[name="lastname"]').fill(shopper.lastname);
    await form.locator('input[name="street[0]"]').fill(shopper.street);
    await form.locator('input[name="city"]').fill(shopper.city);

    // Magento renders either a region select or a free-text input depending on
    // the country. Handle whichever is actually on the page.
    const regionSelect = form.locator('select[name="region_id"]');
    if (await regionSelect.isVisible()) {
        await regionSelect.selectOption(shopper.regionId);
    } else {
        await form.locator('input[name="region"]').fill('Texas');
    }

    await form.locator('input[name="postcode"]').fill(shopper.postcode);
    await form.locator('input[name="telephone"]').fill(shopper.telephone);
}

test.describe('Guest checkout', () => {
    test('places an order as a guest', { tag: ['@checkout', '@guest'] }, async ({ page }) => {
        await test.step('a category in the main navigation lists products', async () => {
            await page.goto('/');

            const category = page.locator(luma.navCategory).first();
            await expect(category, 'the fixture categories should appear in the main navigation').toBeVisible();
            await category.click();

            await expect(page.locator('body')).toHaveClass(/catalog-category-view/);
            // Not toBeVisible on .first(): an empty category still renders the
            // listing wrapper, and a priced, indexed, in-stock product is the
            // thing being asserted.
            await expect(page.locator(luma.productItem).first()).toBeVisible();
        });

        await test.step('the product page offers the product for sale', async () => {
            await page.locator(luma.productItemLink).first().click();

            await expect(page.locator('body')).toHaveClass(/catalog-product-view/);
            await expect(page.locator('.page-title')).toBeVisible();
            // A price proves the price index ran. Out-of-stock or unindexed
            // products render a page but no add-to-cart button.
            await expect(page.locator('.product-info-main .price').first()).toBeVisible();
            await expect(page.locator(luma.addToCart)).toBeEnabled();
        });

        await test.step('adding to the cart updates the minicart', async () => {
            await page.locator(luma.addToCart).click();

            // customer-data arrives over a separate /customer/section/load
            // request that Varnish must not have cached. A stale minicart here
            // is a real bug, so assert the counter, not just the message.
            await expect(page.locator(luma.cartSuccess)).toContainText('to your shopping cart');
            await expect(page.locator(luma.minicartCounter)).toHaveText('1');
        });

        await test.step('the cart holds the line item', async () => {
            await page.goto('/checkout/cart/');

            await expect(page.locator('body')).toHaveClass(/checkout-cart-index/);
            await expect(page.locator(luma.cartItemName)).toHaveCount(1);
            await expect(page.locator(luma.proceedToCheckout)).toBeEnabled();
        });

        await test.step('the shipping step accepts a guest address and a rate', async () => {
            await page.locator(luma.proceedToCheckout).click();

            await expect(page.locator(luma.checkoutEmail)).toBeVisible();
            await page.locator(luma.checkoutEmail).fill(shopper.email);
            await fillShippingAddress(page);

            // The rate pool is requested from the server once the address is
            // complete. No rate means no checkout, which is a release blocker.
            const flatRate = page.locator(luma.shippingMethod);
            await expect(flatRate, 'Flat Rate should be offered for the shipping address').toBeVisible();
            await flatRate.check();

            await page.locator(luma.nextButton).click();
        });

        await test.step('the payment step places the order', async () => {
            await expect(page.locator(luma.paymentSection)).toBeVisible();

            // Check / Money order is active by default and is the only method
            // on a store with no gateway credentials, so it is already
            // selected. Assert rather than click, so a store that offers
            // nothing fails here instead of timing out on Place Order.
            const checkmo = page.locator('input[value="checkmo"]');
            await expect(checkmo, 'Check / Money order should be available').toBeChecked();

            await page.locator(luma.placeOrder).click();
        });

        await test.step('the order is confirmed with an increment id', async () => {
            await expect(page).toHaveURL(/checkout\/onepage\/success/);
            // The confirmation copy is in the page heading; the increment id is
            // in the block below it.
            await expect(page.locator(luma.successPageTitle)).toContainText('Thank you for your purchase');
            await expect(page.locator(luma.successBlock)).toBeVisible();

            // An increment id proves the order was persisted, not just that a
            // success page rendered. Matched as a pattern rather than through
            // a selector: success.phtml wraps the id in a.order-number only
            // when the viewer can open the order, so a guest gets a bare
            // <span>. Digits also keep this assertion locale-independent.
            await expect(page.locator(luma.successBlock)).toContainText(/\d{9}/);
        });
    });
});
