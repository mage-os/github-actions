import { expect, test } from '../fixtures';
import { luma } from './luma';
import { customerPassword, newShopper, registerCustomer } from './support';

/**
 * The storefront half of having customers: register, sign out, sign back in.
 *
 * admin/create-customer.spec.ts creates a customer in the admin and proves the
 * storefront knows about it by being refused a second account for the same
 * address. This is the other direction -- an account the shopper creates -- and
 * it covers what that one cannot: the registration form's own validation, the
 * session the registration opens, the sign-out that closes it and the sign-in
 * that opens it again. Four separate pieces of Magento_Customer, none of them
 * exercised by anything else in this suite.
 *
 * Three things about the store this spec relies on, each read from the shipped
 * configuration rather than assumed:
 *
 * - A password needs 8 characters and 3 of the 4 character classes. See
 *   customerPassword in support.ts.
 * - Registration signs the customer in. CreatePost calls
 *   setCustomerDataAsLoggedIn unless customer/create_account/confirm is set,
 *   and it is 0. So the login page is only reachable after signing out --
 *   visiting it while signed in redirects to the dashboard, where the only
 *   password field left in the DOM is the authentication popup's hidden copy.
 *   That looks exactly like a hung page. See luma.ts.
 * - The storefront CAPTCHA is on (customer/captcha/enable = 1) for
 *   user_login and user_forgotpassword, in after_fail mode, after 3 failures
 *   *per login name*. The refusal test below signs in as an address that is
 *   generated per run, so it can never be the third failure for anything.
 *   Registration has no CAPTCHA: user_create is in always_for but not in
 *   customer/captcha/forms.
 */

test.describe('Storefront customer account', () => {
    test('creates an account and signs back into it', { tag: ['@customer'] }, async ({ page }) => {
        const customer = newShopper();

        await test.step('the registration form accepts a new account', async () => {
            await registerCustomer(page, customer);
        });

        await test.step('registering signs the customer in', async () => {
            await expect(page.locator(luma.successMessage)).toContainText(
                'Thank you for registering with',
            );
            await expect(page).toHaveURL(/\/customer\/account\/?$/);
            await expect(page.locator('body')).toHaveClass(/customer-account-index/);

            // The dashboard's Contact Information box, which the server
            // renders from the saved entity -- so this is the registration
            // read back out of the database, not out of the form.
            const information = page.locator(luma.accountInformation).first();
            await expect(information).toContainText(customer.email);
            await expect(information).toContainText(customer.lastName);
        });

        await test.step('signing out ends the session', async () => {
            // The link is in the DOM four times and every copy is hidden
            // until the header's switch is clicked. Clicking the switch is
            // therefore part of the assertion: a header that never renders
            // its customer menu is a broken header.
            const toggle = page.locator(luma.customerWelcomeToggle).first();
            await expect(toggle, 'the header should greet a signed-in customer').toBeVisible();
            await toggle.click();

            const signOut = page.locator(luma.signOut).first();
            await expect(signOut).toBeVisible();
            await signOut.click();

            await expect(page).toHaveURL(/\/customer\/account\/logoutSuccess/);
            await expect(page.locator('body')).toHaveClass(/customer-account-logoutsuccess/);
            await expect(page.locator(luma.pageTitle)).toContainText('You are signed out');
        });

        await test.step('the account signs back in', async () => {
            await page.goto('/customer/account/login/');

            await expect(page.locator('body')).toHaveClass(/customer-account-login/);
            // Scoped to .login-container: there is a second, hidden copy of
            // every field on this page. An unscoped selector finds it.
            await expect(page.locator(luma.loginContainer)).toBeVisible();

            await page.fill(luma.loginEmail, customer.email);
            await page.fill(luma.loginPassword, customerPassword);
            await page.locator(luma.loginSubmit).click();

            await expect(page).toHaveURL(/\/customer\/account\/?$/);
            await expect(page.locator('body')).toHaveClass(/customer-account-index/);
            await expect(page.locator(luma.accountInformation).first()).toContainText(customer.email);
        });
    });

    test('refuses a credential that is not an account', { tag: ['@customer'] }, async ({ page }) => {
        // Generated per run, so these failures are counted against a login
        // name nobody will ever use again -- the same reason the admin
        // sign-in spec does it. The storefront CAPTCHA arms after three
        // failures per login name, and the count outlives the run.
        const unknown = `mageos-e2e-nobody-${Date.now()}@example.test`;

        await page.goto('/customer/account/login/');
        await expect(page.locator('body')).toHaveClass(/customer-account-login/);

        await page.fill(luma.loginEmail, unknown);
        await page.fill(luma.loginPassword, 'not-the-password-1A');
        await page.locator(luma.loginSubmit).click();

        // Magento deliberately says the same thing for a wrong password and
        // an address that has no account, so this asserts the refusal and not
        // which of the two reasons it was.
        await expect(page.locator(luma.errorMessage)).toContainText(
            'The account sign-in was incorrect or your account is disabled temporarily',
        );
        await expect(page.locator('body')).toHaveClass(/customer-account-login/);
    });
});
