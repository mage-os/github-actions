import { expect, type Locator, type Page } from '@playwright/test';
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
 *
 * Every wait here is load-order, not politeness. Neither control arrives with
 * its values: the server sends an empty `<select>` and an empty swatch group,
 * and Magento_ConfigurableProduct's widget fills them in from spConfig once
 * requirejs has it. Reading them straight after the navigation therefore
 * finds nothing to choose, which this function used to shrug off -- and the
 * product then fails validation on add-to-cart, with no success message and
 * no mention of options anywhere. Measured on this store: the dropdown is
 * empty on arrival and holds three values a moment later.
 *
 * So an option control that never becomes selectable now fails here, with a
 * timeout naming the locator, rather than three assertions later as a cart
 * that stayed empty. A product nobody can configure is a product nobody can
 * buy, which is a finding either way.
 */
export async function selectRequiredOptions(page: Page): Promise<void> {
    const swatchGroups = page.locator(luma.swatchGroup);
    for (let i = 0; i < (await swatchGroups.count()); i++) {
        const option = swatchGroups.nth(i).locator(luma.swatchOption).first();
        await option.waitFor({ state: 'visible' });
        await option.click();
    }

    // Configurables render dropdowns instead of swatches when the attribute
    // has no swatch values, which is what the fixture profile produces.
    const selects = page.locator(luma.optionSelect);
    for (let i = 0; i < (await selects.count()); i++) {
        const select = selects.nth(i);
        // The placeholder option ships with the page and carries no value, so
        // this waits for a real one rather than for any option at all.
        const firstValue = select.locator('option[value]:not([value=""])').first();
        await firstValue.waitFor({ state: 'attached' });
        const value = await firstValue.getAttribute('value');
        if (value) {
            await select.selectOption(value);
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
 * Waits until the page's form key is one the server will accept.
 *
 * Magento_PageCache ships `form-key-provider.js` because a storefront page can
 * be served from the full page cache, where a server-rendered form key would
 * be some earlier visitor's. So the script mints a key, writes it to the
 * `form_key` cookie and rewrites every form's hidden input to match. Until it
 * runs, the page carries a key that does not match any cookie.
 *
 * Measured on this store, sampling both values from document commit:
 *
 *     +   0ms  cookie=(none)           input=sKSvRQDyz5fExuSH   no match
 *     + 250ms  cookie=gVEGZbqOGvCViuHP input=gVEGZbqOGvCViuHP   match
 *
 * A quarter of a second, which a browser driven by a person never loses and
 * one driven by Playwright sometimes does: a form filled in faster than that
 * POSTs the stale key and Magento answers `Invalid Form Key. Please refresh
 * the page.` It is a flake rather than a bug -- the store is behaving as
 * designed and the shopper is never that fast -- and it reads as a broken
 * registration, which is worse than it sounds: the spec that hits it is
 * asserting on a *message*, so the failure arrives as the wrong message
 * rather than as a timing problem.
 *
 * Observed on registration three times across this suite's history, which is
 * where the race is lost: five fields filled back to back is the fastest form
 * submission here. Called before every storefront form submit anyway, because
 * the next spec to be fast enough should not have to rediscover this.
 *
 * See asShopper below for the other way this key goes wrong, which is not a
 * race at all.
 */
export async function awaitFormKey(page: Page): Promise<void> {
    await expect
        .poll(
            async () => {
                const cookie = (await page.context().cookies()).find(
                    (candidate) => candidate.name === 'form_key',
                )?.value;
                if (!cookie) return false;

                const input = page.locator('input[name="form_key"]').first();
                if ((await input.count()) === 0) return false;

                return (await input.inputValue()) === cookie;
            },
            { message: 'the page should carry a form key matching its cookie' },
        )
        .toBe(true);
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

/**
 * The password every spec here registers with.
 *
 * Magento wants 8 characters and 3 of the 4 character classes
 * (customer/password/minimum_password_length,
 * required_character_classes_number, both read from the shipped config). This
 * one has all four, so a store that tightened the policy by one notch still
 * accepts it.
 */
export const customerPassword = 'Mage0s-E2E-pass1';

/** A shopper nothing else in the store has seen, name and address apart. */
export function newShopper() {
    const stamp = Date.now();

    return {
        firstName: 'Mage-OS',
        lastName: `Shopper ${stamp}`,
        email: `mageos-e2e-shopper-${stamp}@example.test`,
    };
}

/**
 * One postal address, shared by every spec that needs one.
 *
 * Texas and the US because the store installs en_US with the US as its single
 * allowed country; overridable because a gate run against a store configured
 * for somewhere else should be a matter of two variables, not a patch.
 */
export const shopperAddress = {
    street: '1 Open Source Way',
    city: 'Austin',
    regionId: process.env.E2E_REGION_ID ?? '57', // Texas
    region: 'Texas',
    postcode: '78701',
    telephone: '5125550123',
    countryId: process.env.E2E_COUNTRY_ID ?? 'US',
};

/**
 * Fills an address form -- checkout's or the account's -- with the address
 * above.
 *
 * Deliberately not the name fields. Checkout wants them typed and the account
 * form arrives with them already filled from the customer entity, and that
 * prefill is worth asserting rather than overwriting. So the caller owns the
 * name and this owns the address.
 */
export async function fillAddressFields(form: Locator): Promise<void> {
    // The country select repopulates the region field, so it goes first.
    await form.locator('select[name="country_id"]').selectOption(shopperAddress.countryId);
    await form.locator('input[name="street[0]"]').fill(shopperAddress.street);
    await form.locator('input[name="city"]').fill(shopperAddress.city);

    // Magento renders either a region select or a free-text input depending on
    // the country. Both are in the account form's markup with one hidden, so
    // this asks which one is actually on the page rather than which country it
    // is.
    const regionSelect = form.locator('select[name="region_id"]');
    if (await regionSelect.isVisible()) {
        await regionSelect.selectOption(shopperAddress.regionId);
    } else {
        await form.locator('input[name="region"]').fill(shopperAddress.region);
    }

    await form.locator('input[name="postcode"]').fill(shopperAddress.postcode);
    await form.locator('input[name="telephone"]').fill(shopperAddress.telephone);
}

/**
 * Registers an account and submits the form, leaving the outcome to the
 * caller: customer-account.spec.ts is about what registration does, and
 * customer-checkout.spec.ts only needs an account to exist.
 *
 * Registration signs the new customer in -- CreatePost calls
 * setCustomerDataAsLoggedIn unless customer/create_account/confirm is set, and
 * it is 0 -- so a spec that calls this is signed in from here on. There is no
 * CAPTCHA on this form: user_create is in always_for but not in
 * customer/captcha/forms.
 */
export async function registerCustomer(
    page: Page,
    customer: { firstName: string; lastName: string; email: string },
): Promise<void> {
    const response = await page.goto('/customer/account/create/');

    expect(response?.status(), 'the registration page should be served').toBe(200);
    await expect(page.locator('body')).toHaveClass(/customer-account-create/);

    await page.fill(luma.registerFirstName, customer.firstName);
    await page.fill(luma.registerLastName, customer.lastName);
    await page.fill(luma.registerEmail, customer.email);
    await page.fill(luma.registerPassword, customerPassword);
    await page.fill(luma.registerPasswordConfirm, customerPassword);

    // Read back before submitting. A form that silently dropped a field fails
    // here, where the cause is visible, rather than as a validation error
    // whose text is about something else.
    await expect(page.locator(luma.registerEmail)).toHaveValue(customer.email);

    await awaitFormKey(page);
    await page.locator(luma.registerSubmit).click();
}
