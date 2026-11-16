import { type Page } from '@playwright/test';
import { luma } from './luma';

/**
 * Storefront behaviour shared between specs, as opposed to luma.ts, which is
 * only the selectors.
 */

/**
 * A configurable product will not go into the cart until every attribute has
 * a value, and which product the catalog lists first is not ours to decide.
 * So pick the first available value for whatever the page asks for, and let a
 * spec work on a simple product, a configurable, or a merchant's own catalog.
 */
export async function selectRequiredOptions(page: Page): Promise<void> {
    const swatchGroups = page.locator(luma.swatchGroup);
    for (let i = 0; i < (await swatchGroups.count()); i++) {
        const option = swatchGroups.nth(i).locator(luma.swatchOption).first();
        if (await option.count()) {
            await option.click();
        }
    }

    // Configurables render dropdowns instead of swatches when the attribute
    // has no swatch values, which is what the fixture profile produces.
    const selects = page.locator(luma.optionSelect);
    for (let i = 0; i < (await selects.count()); i++) {
        const select = selects.nth(i);
        const values = await select
            .locator('option')
            .evaluateAll((options) =>
                options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
            );
        if (values.length) {
            await select.selectOption(values[0]);
        }
    }
}

/**
 * The number inside a rendered price, e.g. '$1,234.56' -> 1234.56.
 *
 * Specs use this to compare amounts the store rendered against each other --
 * a row subtotal against its unit price and quantity, a grand total against
 * its parts -- never against a literal. What a fixture product costs is not
 * something a release gate should have an opinion about; that the arithmetic
 * holds is.
 *
 * Returns NaN rather than throwing when there is no number in the text, so
 * the caller's assertion is the thing that fails, with its own message.
 * Assumes the group separator is ',' and the decimal separator is '.', which
 * is en_US -- the locale this gate installs.
 */
export function parseMoney(text: string): number {
    return Number.parseFloat(text.replace(/[^\d.,-]/g, '').replace(/,/g, ''));
}

/**
 * Drops the cookies an admin spec is carrying, so the storefront half of it
 * runs as a visitor.
 *
 * The admin specs reuse a saved admin session, and that session is a cookie
 * jar the storefront requests inherit: an `admin` cookie, a PHPSESSID created
 * in the adminhtml area, and a `form_key` cookie that belongs to it. Magento
 * then renders the storefront form with that session's form key, and
 * Magento_PageCache's form-key-provider rewrites the input from the cookie --
 * so a storefront POST is validated against a form key the admin area also
 * controls.
 *
 * Observed consequence: `admin/create-customer.spec.ts` failed its
 * registration step twice with `Invalid Form Key. Please refresh the page.`
 * where it expected `There is already an account with this email address`,
 * and then passed five times in a row. Anything else touching that admin
 * session -- another run against the same store, a human signed in as the
 * same account, a retry -- can rotate the key underneath a page that has
 * already rendered it. CI never saw it, because a gate's store is used once.
 *
 * So rather than chase the race: a shopper is not an administrator, and the
 * specs that cross over say so here. It costs one request's worth of session
 * and removes the whole class.
 */
export async function asShopper(page: Page): Promise<void> {
    await page.context().clearCookies();
}
