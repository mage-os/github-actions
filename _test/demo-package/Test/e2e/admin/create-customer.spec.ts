import { expect, test } from '../fixtures';
import { adminGrid, adminSelectors, adminUrl } from './support';
import { luma } from '../luma';

/**
 * Creating a customer exercises a write path the product and category specs
 * do not touch: a different entity type, a different form, the website and
 * group assignment, and the customer repository that the storefront reads
 * through on every registration and login.
 *
 * It also documents the one grid in the admin that a save does not update.
 * Magento\Customer\Model\Customer::reindex() is a no-op when the customer_grid
 * indexer is scheduled, which it is by default and which it stays by default:
 *
 *     public function reindex()
 *     {
 *         if (!$this->getIndexer()->isScheduled()) {
 *             $this->getIndexer()->reindexRow($this->getId());
 *         }
 *     }
 *
 * So on a store without cron running -- every CI store, including this gate's
 * -- a customer saved in the admin is absent from the customer grid until
 * something indexes it. This spec therefore asserts persistence from the edit
 * form and from the storefront, and never from the grid. An assertion on the
 * grid would be red against a correctly working store, which is the worst
 * kind of test to put in front of someone deciding whether to ship.
 */

const customerForm = {
    gridBodyClass: /customer-index-index/,
    // Not customer-index-new. The new-customer form is rendered by the edit
    // action, so a new customer and an existing one share a body class, and
    // this spec identifies the form by its title and its fields instead.
    formBodyClass: /customer-index-edit/,
    addCustomer: '#add',
    firstName: "input[name='customer[firstname]']",
    lastName: "input[name='customer[lastname]']",
    email: "input[name='customer[email]']",
    // The saved customer's form opens on Customer View, a read-only summary.
    // The fields are under Account Information, which is a separate tab and a
    // separate render -- the new-customer form shows them without a click, a
    // saved one does not.
    accountTab: '#tab_customer',
    group: "select[name='customer[group_id]']",
    website: "select[name='customer[website_id]']",
    // Save and Continue Edit rather than Save Customer: Save redirects to the
    // grid, and the grid is the one place this customer will not be. Save and
    // Continue lands on the persisted entity, which is where the read-back
    // below has to happen.
    save: "button[title='Save and Continue Edit']",
    saved: '.page-content .message-success',
    anyMessage: '.page-content .message-success, .page-content .message-error',
};

test.describe('Creating a customer in the admin', () => {
    test.setTimeout(300_000);

    test('@admin creates a customer the storefront knows about', async ({ page }) => {
        const stamp = `${Date.now()}`;
        const customer = {
            firstName: 'Mage-OS',
            lastName: `E2E ${stamp}`,
            email: `mageos-e2e-${stamp}@example.test`,
        };

        await test.step('the customer grid renders', async () => {
            await page.goto(adminUrl('customer/index/index'));

            await expect(page.locator('body')).toHaveClass(customerForm.gridBodyClass);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('Customers');

            // A second UI component listing, which is most of the point of
            // asserting it at all: product_listing working says little about
            // whether customer_listing's own columns and data provider do.
            // No assertion on the row count -- the fixture profile creates no
            // customers, so an empty grid here is correct.
            const grid = adminGrid(page, 'customer_listing');
            await grid.ready();
            expect(await grid.columnIndex('Email')).toBeGreaterThanOrEqual(0);
        });

        await test.step('the admin offers a new customer form', async () => {
            await page.locator(customerForm.addCustomer).click();

            await expect(page.locator('body')).toHaveClass(customerForm.formBodyClass);
            await expect(page.locator(adminSelectors.pageTitle)).toContainText('New Customer');
            await expect(page.locator(customerForm.firstName)).toBeVisible();
            await expect(page.locator(customerForm.lastName)).toBeVisible();
            await expect(page.locator(customerForm.email)).toBeVisible();

            // Left at their defaults, but asserted to have one. These two
            // selects are populated by the form's data provider, and an empty
            // website select is a bootstrapped form that nonetheless cannot
            // save -- a failure that otherwise surfaces as an unhelpful
            // validation error further down.
            await expect(page.locator(customerForm.website)).not.toHaveValue('');
            await expect(page.locator(customerForm.group)).not.toHaveValue('');
        });

        await test.step('saving the customer reports success', async () => {
            await page.locator(customerForm.firstName).fill(customer.firstName);
            await page.locator(customerForm.lastName).fill(customer.lastName);
            await page.locator(customerForm.email).fill(customer.email);

            await page.locator(customerForm.save).click();

            await expect(page.locator(customerForm.anyMessage).first()).toBeVisible({ timeout: 240_000 });
            await expect(page.locator(customerForm.saved)).toContainText('You saved the customer.');
            await expect(page).toHaveURL(/customer\/index\/edit\/id\/\d+/);

            // What the store holds, read off the form it redirected to.
            await page.locator(customerForm.accountTab).click();
            await expect(page.locator(customerForm.email)).toHaveValue(customer.email);
            await expect(page.locator(customerForm.firstName)).toHaveValue(customer.firstName);
        });

        await test.step('the storefront knows the account exists', async () => {
            // The loop closure, and the reason this spec does not end at the
            // admin: registering the same address on the storefront has to be
            // refused. That answer comes from the customer repository looking
            // the address up within the website the admin form assigned, so a
            // customer saved to the wrong website -- or not committed at all
            // -- registers happily here and the spec goes red.
            await page.goto('/customer/account/create/');
            await expect(page.locator(luma.registerForm)).toBeVisible();

            await page.locator(luma.registerFirstName).fill(customer.firstName);
            await page.locator(luma.registerLastName).fill(customer.lastName);
            await page.locator(luma.registerEmail).fill(customer.email);
            await page.locator(luma.registerPassword).fill('mageos-E2E-1!');
            await page.locator(luma.registerPasswordConfirm).fill('mageos-E2E-1!');
            await page.locator(luma.registerSubmit).click();

            await expect(page.locator(luma.errorMessage)).toContainText(
                'There is already an account with this email address',
            );
        });
    });
});
