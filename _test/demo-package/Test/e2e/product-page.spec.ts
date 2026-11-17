import { expect, test } from './fixtures';
import { luma } from './luma';
import { parseMoney, selectRequiredOptions } from './storefront';

/**
 * A product page and the cart it fills, asserted properly.
 *
 * guest-checkout.spec.ts walks past both on its way to an order, and it has
 * to: its subject is the whole path, so it checks that a price is on the page
 * and that something reached the cart. What it cannot afford to do is look
 * closely. This spec does that instead, and the difference is worth a
 * separate red light:
 *
 * - A product page that renders without a sku, without a stock status or
 *   without a price is a broken catalog, and the checkout spec would still
 *   pass if the quantity it added was silently 1 instead of 3.
 * - The cart's arithmetic is a release-sensitive thing that nothing else
 *   here checks. Totals are assembled by collectors, each of which can be
 *   replaced by a module, so "unit price times quantity equals the row
 *   subtotal, and the rows add up to the order total" is a real assertion
 *   about this release and not about this catalog.
 *
 * Every amount is compared against another amount the store rendered. None of
 * them is compared against a number written in this file: a gate that goes
 * red because a fixture product's price changed is a gate people switch off.
 */

const quantity = 3;

test.describe('Product page', () => {
    test('adds a product to the cart from its own page', { tag: ['@catalog', '@cart'] }, async ({ page }) => {
        let productName = '';

        await test.step('the catalog lists a product', async () => {
            await page.goto('/');

            const category = page.locator(luma.navCategory).first();
            await expect(category, 'the fixture categories should appear in the main navigation').toBeVisible();
            await category.click();

            await expect(page.locator('body')).toHaveClass(/catalog-category-view/);

            // Read the name from the listing so the product page can be
            // checked against what the listing promised. A page that renders
            // a different product than the link said is a url rewrite bug,
            // and nothing else in this suite would see it.
            const link = page.locator(luma.productList).locator(luma.productItemLink).first();
            await expect(link).toBeVisible();
            productName = (await link.innerText()).trim();

            await link.click();
        });

        let unitPrice = 0;

        await test.step(`the product page offers ${productName} for sale`, async () => {
            await expect(page.locator('body')).toHaveClass(/catalog-product-view/);
            await expect(page.locator(luma.pageTitle)).toContainText(productName);

            // A sku on the page means the attribute was loaded, not just the
            // url rewrite resolved. Asserted as "not empty" rather than
            // against a value: on a configurable this is the parent's sku
            // until an option is chosen.
            await expect(page.locator(luma.productSku).first()).not.toBeEmpty();

            // The in-stock variant of the availability block. An unsalable
            // product renders the page and no add-to-cart button, which is a
            // far more confusing failure three steps later.
            await expect(page.locator(luma.productStock).first()).toBeVisible();

            const price = page.locator(luma.productPrice).first();
            await expect(price, 'a priced product means the price index ran').toBeVisible();
            unitPrice = parseMoney(await price.innerText());
            expect(unitPrice, 'the product page should render a price').toBeGreaterThan(0);

            await selectRequiredOptions(page);
        });

        await test.step(`the cart accepts ${quantity} of it`, async () => {
            // Not the default quantity: 1 is what the field already says, so
            // a spec that leaves it alone cannot tell a quantity that was
            // applied from one that was ignored.
            const qty = page.locator(luma.productQty);
            await qty.fill(String(quantity));
            await expect(qty).toHaveValue(String(quantity));

            await page.locator(luma.addToCart).click();

            // Magento names the product in the message, which is the cheapest
            // proof that what reached the quote is what was on screen.
            await expect(page.locator(luma.cartSuccess)).toContainText(
                `You added ${productName} to your shopping cart.`,
            );

            // The counter is private content, fetched separately from the
            // page, so it is polled rather than read once. It is also the
            // only place the suite sees the quote through a different request
            // than the one that filled it.
            await expect
                .poll(async () => (await page.locator(luma.minicartCounter).innerText()).trim(), {
                    message: 'the minicart should count the quantity that was added',
                })
                .toBe(String(quantity));
        });

        await test.step('the cart page agrees with itself', async () => {
            await page.goto('/checkout/cart/');

            await expect(page.locator('body')).toHaveClass(/checkout-cart-index/);
            await expect(page.locator(luma.cartItem)).toHaveCount(1);
            await expect(page.locator(luma.cartItemName)).toContainText(productName);
            await expect(page.locator(luma.cartItemQty).first()).toHaveValue(String(quantity));

            const rowPrice = parseMoney(await page.locator(luma.cartItemPrice).first().innerText());
            const rowSubtotal = parseMoney(await page.locator(luma.cartItemSubtotal).first().innerText());

            // The row against itself. A quote item whose quantity and row
            // total disagree is the shape of every pricing regression worth
            // stopping a release for, and it renders perfectly happily.
            expect(rowSubtotal, `${rowPrice} x ${quantity} should be the row subtotal`).toBeCloseTo(
                rowPrice * quantity,
                2,
            );

            const subtotal = parseMoney(await page.locator(luma.cartSubtotal).first().innerText());
            expect(subtotal, 'one row means the cart subtotal is that row').toBeCloseTo(rowSubtotal, 2);

            // Shipping is quoted on the cart page before checkout, so the
            // grand total has at least two parts to add up. A store with tax
            // or a discount renders more rows, which is why this reads the
            // ones it needs by class instead of adding up every row it finds.
            const shipping = parseMoney(await page.locator(luma.cartShipping).first().innerText());
            const grandTotal = parseMoney(await page.locator(luma.cartGrandTotal).first().innerText());

            expect(shipping, 'the cart should quote a shipping amount').not.toBeNaN();
            expect(grandTotal, 'subtotal plus shipping should be the order total').toBeCloseTo(
                subtotal + shipping,
                2,
            );
        });
    });
});
