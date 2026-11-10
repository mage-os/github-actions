# Storefront tests

A small Playwright suite that proves a Mage-OS storefront is **being served**
and **can take an order** -- installed, reachable over HTTP(S), rendering with
its static content deployed, and able to carry a guest from a category listing
to a persisted order.

It is the canary for [`warden/setup-environment`](../../../../warden/setup-environment):
`.github/workflows/_internal-e2e.yaml` stands a store up with that action on
every change to it and runs this suite against the result.

| Spec | Needs fixtures | Asserts |
| --- | --- | --- |
| `hello-magento.spec.ts` | no | the Luma homepage renders with static content deployed |
| `guest-checkout.spec.ts` | yes | catalog -> product -> cart -> shipping -> payment -> order |

## Running it against a store

```bash
cp .env.example .env     # then point PLAYWRIGHT_BASE_URL at your store
npm ci
npx playwright install --with-deps chromium
npm test
```

`guest-checkout.spec.ts` needs a salable product, which a bare `setup:install`
does not have. Seed one first -- see [Fixtures](#fixtures).

There is no default base URL. A suite that silently falls back to some public
demo store reports green about a store nobody asked about.

## Why the assertions look like that

A `200` is not evidence of a storefront. The admin login page, a CMS no-route
page and a Magento error page all answer `200`, and all of them have a header,
a footer, a `<title>` and no console errors. So each assertion here is one that
fails against something that should not pass:

| Assertion | What it rejects |
| --- | --- |
| `body` has `cms-index-index` | Any other route answering 200 -- `/admin`, a 404 CMS page |
| `[data-block="minicart"]` is attached | A storefront page rendered without the Luma layout |
| A stylesheet parsed into CSS rules | A store whose `pub/static` was never deployed |

Before changing an assertion, check that it still fails for the reason it was
written. Do that with a throwaway spec, not by repointing `PLAYWRIGHT_BASE_URL`
at the admin URL: a base URL with a path in it will not do what you expect,
because `page.goto("/")` resolves against the origin and drops the path, so you
end up testing the homepage again and watching it pass.

```ts
// negative-control.spec.ts -- delete it afterwards
import { test, expect } from "@playwright/test";

test("the admin login page must not satisfy the homepage assertions", async ({ page }) => {
    const response = await page.goto("/admin"); // your backend frontName
    expect(response?.status()).toBe(200);       // it answers 200 -- that is the point
    await expect(page.locator("body")).toHaveClass(/cms-index-index/);
});
```

Against a real store that fails on the body class alone, with the 200 and the
stylesheets both satisfied:

```
Expected pattern: /cms-index-index/
Received string:  "m137-admin-theme adminhtml-auth-login page-layout-admin-login"
```

For the static content assertion, clear `pub/static` and reload.

## Version-dependent assertions

When run from `e2e.yaml`, the suite receives `MAGEOS_VERSION` and
`MAGENTO_VERSION`, probed from the running store rather than taken from the
workflow input. Nothing uses them yet.

When something does, use `test.skip(condition, reason)` next to the assertion
rather than excluding the spec from the command line: a skip appears in the
report with its reason, while a `--grep` exclusion is invisible and goes stale
silently. For markup that moves between versions, branch the selector map at
the top of the spec rather than the spec itself.

## Fixtures

`fixtures/mageos-e2e.xml` is a performance-toolkit profile, run with the
command the toolkit ships:

```bash
bin/magento setup:performance:generate-fixtures path/to/fixtures/mageos-e2e.xml
```

Measured on Mage-OS 4.0.0 under Warden: **12s wall clock**, including the
reindex the command runs itself -- no separate `indexer:reindex` needed. It is
idempotent: re-running it does not duplicate anything.

It produces 20 simple products (`product_dynamic_1` .. `product_dynamic_20`),
one configurable with three variations, and two categories that appear in the
main navigation. The SKUs are deterministic, which is the thing sample data
cannot offer: no assertion breaks because a product was renamed upstream.

### Why not a profile that already exists

Core ships five profiles, and the smallest is not small:

| Profile | simple products | categories | customers | orders | images |
| --- | --- | --- | --- | --- | --- |
| `small` | 800 | 30 | 200 | 80 | 100 |
| `medium` | 24,000 | 300 | 2,000 | 50,000 | 1,000 |
| `large` | 300,000 | 3,000 | 5,000 | 100,000 | 2,000 |

They exist to benchmark a store under catalog weight. Core ships nothing for
functional seeding, so this profile is that.

### Why not sample data

`magento2-sample-data` is mirrored into `repo.mage-os.org`, so it is installable
without Adobe credentials. But it is hundreds of megabytes, and its *content*
changes between releases -- an assertion on "Joust Duffle Bag" is an assertion
about sample data, not about Mage-OS. A gate that goes red because a product was
renamed is a gate people switch off.

### Two things to know about the profile

`small.xml` sets `admin/security/use_form_key` to `0` and
`admin_account_sharing` to `1`. Reasonable for load testing, wrong here: a gate
running against a store with admin CSRF protection disabled is not testing the
store we ship. Do not copy those over.

`ConfigsApplyFixture` iterates `$configs['config']` as a list, but a single
`<config>` element collapses to a flat map, so the fixture iterates that
element's own values and fatals with `Cannot access offset of type string on
string`. `small.xml` carries four entries, so upstream never sees it. Keep at
least two in the `<configs>` block.

## What the checkout spec does not cover

Registered-customer checkout, a real payment gateway, taxes, discounts and
multi-address shipping. Each wants fixtures of its own, and none of them is on
the path between "we tagged a release" and "a shopper can buy something".
