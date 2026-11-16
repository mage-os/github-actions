# Browser tests

A small Playwright suite that proves a Mage-OS release is **being served**,
**can take an order** and **can be administered** -- installed, reachable over
HTTP(S), rendering with its static content deployed, able to carry a guest from
a category listing to a persisted order, and able to let an administrator sign
in, work a grid and create the catalog and customer records a store is
made of.

It is the canary for [`warden/setup-environment`](../../../../warden/setup-environment):
`.github/workflows/_internal-e2e.yaml` stands a store up with that action on
every change to it and runs this suite against the result.

| Spec | Needs fixtures | Asserts |
| --- | --- | --- |
| `hello-magento.spec.ts` | no | the Luma homepage renders with static content deployed |
| `guest-checkout.spec.ts` | yes | catalog -> product -> cart -> shipping -> payment -> order |
| `admin/login.spec.ts` | no | the admin sign-in form refuses a bad credential and accepts a good one |
| `admin/product-grid.spec.ts` | yes | the product grid renders through Magento_Ui and filters server-side |
| `admin/create-product.spec.ts` | no | admin form -> EAV save -> url rewrite -> indexers -> storefront -> quote |
| `admin/create-category.spec.ts` | yes | category tree -> save -> url rewrite -> category index -> storefront listing + menu |
| `admin/create-customer.spec.ts` | no | customer form -> save -> read-back -> the storefront refuses the address twice |
| `admin/menu-navigation.spec.ts` | no | the admin's own rendered link reaches the product grid, secret key or not |

Storefront selectors live in `luma.ts`, shared by every spec that looks at a
storefront page. A Hyva variant of this suite is that file with a different
map, not a rewrite of the specs.

## Running it against a store

```bash
cp .env.example .env     # then point PLAYWRIGHT_BASE_URL at your store
npm ci
npx playwright install --with-deps chromium
npm test
```

`guest-checkout.spec.ts` needs a salable product, which a bare `setup:install`
does not have. Seed one first -- see [Fixtures](#fixtures).

The admin specs need an admin account and a reachable admin URL. Set
`MAGENTO_ADMIN_USER`, `MAGENTO_ADMIN_PASSWORD` and `MAGENTO_ADMIN_FRONTNAME`
in `.env` if your store does not match the defaults in `admin/support.ts`, and
disable the two auth modules named below. To run one side only:

```bash
npx playwright test --project=storefront
npx playwright test --project=admin        # pulls in admin-session itself
```

There is no default base URL. A suite that silently falls back to some public
demo store reports green about a store nobody asked about.

## The admin specs

The storefront is a thin skin over the catalog; the admin is where the
framework lives -- UI components, data providers, the EAV save path, ACL, the
requirejs and knockout bootstrap. Those are also the most-refactored parts of
the codebase, which makes them the parts a release is most likely to break.

They run in their own Playwright project:

| Project | Selects | Session |
| --- | --- | --- |
| `admin-session` | `admin/session.setup.ts` | signs in, saves `admin/.auth/admin.json` |
| `storefront` | everything outside `admin/` | none |
| `admin` | `admin/*.spec.ts` | reuses the saved session |

The sign-in is a **project dependency** rather than a `globalSetup` hook so
that it appears in the report as its own result. "The session could not be
created" and "every admin spec failed" are different problems; if the sign-in
breaks, the dependency fails once and the admin specs report `did not run`
instead of producing a wall of identical reds.

`admin/login.spec.ts` resets `storageState` to empty, because it is the one
spec whose subject *is* the sign-in form. Everything else inherits the session.

### Two traps in the sign-in form

The password field's id is `login`, not `password` -- the id is on the field,
`login[password]` is its name. Guessing gives a timeout that reads like a
broken store.

`#login-form` is **ambiguous**. The storefront authentication popup uses the
same id, so a request that lands on the storefront instead of the admin finds
a `#login-form` and the failure stops being about the admin. The specs assert
the `adminhtml-auth-login` body class first, the same route-discriminator
trick the storefront specs use, and scope the form to `.login-content`. This
was found by a negative control, not by reading markup: pointing the suite at
a wrong frontname passed its form assertion against the storefront's hidden
login form.

### Why the grid spec runs before the create spec

A grid is the whole `Magento_Ui` stack in one page: requirejs resolves the
component, Knockout renders the table, a separate `mui/index/render` request
answers with the data and the collection applies the filters. None of that
markup is in the HTML the server sends, so a grid that renders at all is a
statement that the admin's JavaScript stack works.

That ordering is the point. If the UI component stack is broken, the create
spec fails too -- and on its own it cannot tell you whether the form never
rendered or the product could not be saved. The grid spec answers that first,
cheaply.

`admin/create-product.spec.ts` then crosses the seams a storefront-only check
cannot reach: the form's validation, the EAV write path, the attribute set
defaults, the stock item, url rewrite generation, the indexers that make a
product salable, and finally the storefront and a quote. Fixtures are written
straight to the database, so **they skip that entire write path** -- which is
why a seeded catalog passing says nothing about whether a merchant can add a
product.

It writes data. One product per run, with a unique SKU, and the SKU is
generated inside the test rather than at module scope so that a retry does not
collide with what the failed attempt already saved. Point this suite at a
throwaway store, not a long-lived one.

### The first save a store ever performs is slow

`admin/create-product.spec.ts` allows four minutes for the save to report
back, against the suite's usual twenty seconds. Across GitHub runners that
first save has taken 12s, 17s and over 90s, while every retry afterwards
lands in about 15s: a freshly installed store in developer mode pays for code
generation along the save path, and then for the Update on Save indexers --
price, EAV, product categories, catalog search -- which is work this gate
wants happening rather than work to switch off.

The ceiling is there so runner variance produces a slow pass instead of a red
gate. If the spec ever fails on its retry as well, the save path itself has
regressed, which is the thing worth reporting. The assertion waits for the
success **or** the error message, so a save rejected by validation still fails
in about a second, showing the message.

### Traps in the admin UI components

Each of these cost a red run to find, and none of them is visible in the
markup the server sends.

**Every grid toolbar and table exists twice.** The admin renders a copy of
both inside a `.sticky-header` element, with the same classes, so
`table.data-grid` and `button[data-action="grid-filter-expand"]` each match two
elements and Playwright refuses to act on either. The real table is the one
with `data-role="grid"`; the real toolbar is the one that is a *direct* child
of `.admin__data-grid-outer-wrap`. `admin/support.ts` scopes both.

**There is a second grid on every admin page.** The notification bell in the
header is a grid component of its own, and its loading mask carries the same
class as the one belonging to the grid under test. The mask has to be selected
by `data-component`, which is why `adminGrid()` takes the listing name.

**Grid filter state is saved per admin user, not per session.** It lives in
the `ui_bookmark` table, so a filter a spec leaves applied is still applied the
next time anything -- another spec, a retry, a human -- opens that grid. The
grid spec clears its filter as an asserted step, and both specs call
`startUnfiltered()` first so a half-failed run cannot decide what the next one
sees. This was found the honest way: a throwaway probe script left a filter
behind and the listing assertion went red on the next run, which is exactly
what `> 1 row` rather than `> 0 rows` is there to catch.

**The grid caches pages client-side.** Clearing a filter often re-renders from
`Magento_Ui/js/grid/data-storage` with **no network request at all**, so
waiting for a response hangs, and reading the record count once reads the
number that was on screen before Knockout re-rendered. Numbers that settle
asynchronously are asserted with `expect.poll`.

**`catalog/product/new` is a 404.** The controller forwards to noroute without
an attribute set, so the real route is
`catalog/product/new/set/<id>/type/simple`. The create spec clicks **Add
Product** on the grid instead, because the id of the default attribute set is
not something a spec should hardcode.

**Admin body classes are the full action name**, and only the screens that live
in `Magento_Backend` are prefixed with `adminhtml-`. The dashboard is
`adminhtml-dashboard-index`; the product grid is `catalog-product-index`, with
no prefix at all.

**The product form renders its collapsible sections lazily.** `url_key` is not
in the DOM until the Search Engine Optimization section has been clicked open.
The create spec sets the url key explicitly rather than deriving it from the
product name, so that the storefront step is a statement about url rewrites
instead of a guess about how a name becomes a url.

**The two catalog forms spell the same section differently.** The product
form's SEO collapsible is `data-index="search-engine-optimization"`, with
hyphens. The category form's is `search_engine_optimization`, with underscores.
Same label on screen, two modules' `ui_component` XML underneath.

**The category page is not a grid page.** `catalog/category/` opens the root
category's own edit form -- hence a `catalog-category-edit` body class on what
looks like an index -- with a jstree sidebar beside it. The new-subcategory
form is `catalog-category-add`.

**Products are assigned to a category through a legacy grid widget**, not a UI
component listing. `#catalog_category_products_table` has its own filter row
that applies on **Enter**, row checkboxes with **no name attribute** (the value
is the product id), and no loading mask worth waiting on. `adminGrid()` does
not apply to it and should not be stretched to fit: it is a different thing
that happens to look similar.

That grid is also where a filter race is easiest to write by accident. The
unfiltered table already has rows, so polling for "more than zero rows" is
satisfied by the table that was on screen *before* Enter was pressed. The
first version of the category spec read a product name off the stale table,
checked a box in the table that replaced it, and then reported that the
storefront had listed the wrong product. Poll for something only the filtered
grid can satisfy -- every SKU cell matching the filter -- and re-assert the
row's identity after checking its box.

**The customer grid is the one grid a save does not update.**
`Magento\Customer\Model\Customer::reindex()` is a no-op while the
`customer_grid` indexer is scheduled, which is its default and which nothing
here changes:

```php
public function reindex()
{
    if (!$this->getIndexer()->isScheduled()) {
        $this->getIndexer()->reindexRow($this->getId());
    }
}
```

So on any store without cron running -- every CI store, including this gate's
-- a customer saved in the admin is simply absent from the customer grid. The
customer spec therefore proves persistence from the edit form and from the
storefront and never from the grid. An assertion on the grid there would be
red against a store that is working correctly, which is the worst kind of
assertion to put in front of someone deciding whether to ship.

**A saved customer's form opens on a different tab than a new one's.** The new
form shows Account Information; after a save the page opens on Customer View,
a read-only summary, and the fields are not in the DOM until `#tab_customer`
is clicked. The spec uses **Save and Continue Edit** rather than Save, because
Save redirects to the grid -- see above for why that is a dead end.

**The fixture profile's simple products start at `product_dynamic_2`.** There
is no `product_dynamic_1`. A spec that hardcodes the first index fails on a
correctly seeded store, so the category spec filters on the `product_dynamic`
prefix and reads the SKU and name it finds out of the DOM.

### What makes the admin reachable at all

Magento has **no configuration flag that switches two-factor authentication
off**. `twofactorauth/general/force_providers` is empty by default, and that
does not help: `ControllerActionPredispatch` still routes a fresh admin user
to `tfa/tfa/index`, which redirects to `tfa/tfa/requestconfig`. Disabling
`Magento_TwoFactorAuth` is the only way in, and `MageOS_PasskeyAuth` requires
it and registers an admin 2FA provider, so both have to be disabled in one
command or dependency validation refuses it. The workflow does this and says
so; the cost is that this gate does not cover admin 2FA.

The admin login **CAPTCHA** is on by default -- `admin/captcha/enable` is
`1`, in `after_fail` mode, asking for one after **three failed attempts per
login name**. The count lives in the `captcha_log` table, so against a
long-lived store it accumulates across runs. A suite that asserts a bad
credential is refused manufactures exactly those failures, which is how a
negative control ends up poisoning the positive one; the symptom is an
`Incorrect CAPTCHA` on a *correct* password, which looks nothing like its
cause. The workflow disables it. If you hit it on a store that has not been
configured that way, `truncate table captcha_log` is the reset.

The specs reduce their own exposure anyway: the refusal test signs in as a
name that is not an account, so the failures are counted against a login
nobody will use, and the three sign-in tests are separate tests rather than
steps of one, so each runs in its own browser context.

There is deliberately **no modal dismissal helper**. Both candidates were
checked rather than assumed:

- `Magento_AdminAnalytics`' usage-data prompt is gated by
  `CanViewNotification::isVisible()`, which returns `false` unless
  `admin/usage/enabled` is set. It defaults to `0`, and the workflow pins it.
- `Magento_ReleaseNotification` builds its content URL from
  `system/release_notification/content_url`. Mage-OS ships that **empty**, so
  `UrlBuilder::getUrl()` returns `''` and there is nothing to render.

Neither appears on a store this gate installs. A blanket "click away whatever
is covering the page" helper would be dead code today and a liability later:
if a future release does grow a blocking dialog on first sign-in, the right
outcome is a red test with a screenshot of it, not a suite that dismisses it
and reports green.

### Secret keys in admin URLs, and the one spec that survives them

`admin/security/use_form_key` is **Add Secret Key to URLs**, not the POST form
key -- `Magento\Backend\Model\Url` names the same path
`XML_PATH_USE_SECURE_KEY`. `module-store/etc/config.xml` ships it as `1`, so a
stock store appends a `/key/<hash>/` segment to every admin GET URL and
`AbstractAction::_processUrlKeys` answers a request without one with
`_redirect($this->_backendUrl->getStartupPageUrl())`.

That redirect is the problem. It is a 302 to a **200 on the dashboard**: no
error, no 4xx, nothing the error watching above can see. The only thing that
catches it is an assertion about which page you are on.

Measured, by setting it to `1` on a store and running:

| Spec | Navigates by | Result |
| --- | --- | --- |
| `admin/menu-navigation.spec.ts` | the href the admin rendered | passed |
| `admin/product-grid.spec.ts` | a bare admin route | both tests failed |

The grid specs fail at `adminGrid().ready()` -- "waiting for
`table.data-grid`" -- because they are on the dashboard, which has no grid.
That is the body-class assertions doing their job, and it is also what every
admin spec here would do against a store configured the way stores ship.

So `.github/workflows/e2e.yaml` sets the value to `0` itself, in a step that
explains it, and this is the gap that buys. `admin/menu-navigation.spec.ts`
exists so the gap is not total: it reads `Catalog > Products` out of the menu
Magento rendered and follows that, which works with the setting either way. It
records which way the store was configured as an annotation --
`admin-url-secret-key: present` or `absent` -- so a report says what it
proved. It is also the only spec that looks at a URL the **store** generated
rather than a path the suite wrote, which makes it the only one that can fail
when admin links are built on the wrong host or scheme.

Making the other admin specs navigate that way would let the setting go
entirely. The cost is the usual one: a menu is reordered more often than a
route is renamed.

## Every page is watched for errors nothing asserts on

`fixtures.ts` replaces Playwright's `page` fixture with one that watches three
things and fails the test if any of them fires. Specs import `test` and
`expect` from it instead of from `@playwright/test`, and get the check for
free on every page they touch.

| Signal | Catches |
| --- | --- |
| `pageerror` | an uncaught JS exception -- a missing requirejs module, a mixin that no longer resolves, a knockout binding against a property that moved |
| `console` (errors) | anything the store's own code logged as an error |
| `response` (>= 400) | any failed request, including the ones no assertion looks at |

The third one is the reason this exists. **A failed XHR breaks no assertion.**
`Magento_Ui` renders a listing from its client-side page cache and keeps the
last good state when a request fails, so a grid whose data provider returns
500 goes on showing the rows it already had. Measured on Mage-OS 4.0.0: a 500
on `mui/index/render` left the row count unchanged at 20, raised no
`pageerror`, and `product-grid.spec.ts` -- which asserts `rows > 1` -- passed.
Private content behaves the same way: a 500 on `customer/section/load` leaves
the minicart showing whatever `localStorage` last held.

A 500 or 404 on the *main document* usually does fail a spec, because the
content it asserts on is not there, and two specs check `response.status()`
outright. The gap is everything requested in the background, which is most of
what a Magento page does after it renders.

It was committed strict only after a report-only run of the whole suite.
Eleven specs produced exactly one recurring finding: `GET
/guest-carts/<id>/totals` answering 404 about 460ms after
`payment-information` returned 200. The checkout refreshes the cart totals
after the order is placed, by which point the quote it is asking about has
been consumed -- the shopper is on the success page and nothing is broken.
That is the single entry in the ignore list, scoped to that path and that
status so it cannot hide a cart that 404s while a shopper is still trying to
check out.

A third entry was added after the first rehearsal with Varnish owning the
page cache: Mage-OS enables cross-document view transitions by default
(`MageOS_ThemeOptimization`, `system/view_transitions/enable` = 1), and under
automation Chrome intermittently aborts one in flight with `Transition was
aborted because of invalid state. ViewTransition opt-in disabled`. It showed
up on a category and a product page, first attempt only, retry clean. That is
a cosmetic transition aborting, not a broken store -- but it is worth an
upstream report rather than only an ignore entry, because the module's own
source notes that some in-app browsers never finish the transition and leave
the page blank.

Not everything it finds becomes an ignore entry. The rehearsal that added
`admin/menu-navigation.spec.ts` came back with one finding on the admin
sign-in page: `Refused to apply style from
'.../adminhtml/MageOS/m137-admin-theme/en_US/css/styles.css' because its MIME
type ('text/html') is not a supported stylesheet`. The workflow was deploying
static content for `Magento/backend`, which is the *parent* of the theme
Mage-OS renders the admin in -- `mage-os/theme-adminhtml-m137` registers
`MageOS/m137-admin-theme` -- so the admin's own stylesheet was materialised on
the first request instead, and while Magento built it the browser's request
for it was answered with Magento's HTML 404 page.

That means the admin had been rendering unstyled on the first page load of
every run, and nothing in this suite has anything to say about CSS. It showed
up as a flaky red on the session setup, which is the shape these findings
usually have: real, cheap to fix, invisible to every assertion. The fix went
in the workflow's theme list, not in the ignore list here.

The browser's own `Failed to load resource` console line is also ignored, for
a different reason: it is a URL-less echo of something the response listener
already reports with a status, a method and a full URL. Keeping both counts
every HTTP finding twice and the duplicate is the less useful of the two.

**Keep that ignore list short.** A check like this is only as good as its
ignore list, and a growing list is how such a check quietly dies. Anything new
is a finding until someone proves otherwise, in a comment, in the file.

Demonstrated red the same way as everything else here: 404 a background XHR
that no assertion mentions -- `js-translation.json` will do -- and the spec
passes every one of its own assertions and then fails on the fixture.

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
`admin_account_sharing` to `1`. Both are worth understanding rather than
copying, and the first one is not what its name suggests.

`admin/security/use_form_key` is **Add Secret Key to URLs**:
`Magento\Backend\Model\Url` names the same path `XML_PATH_USE_SECURE_KEY`. It
is not the POST form key, which is validated whatever this is set to --
`Magento\Backend\App\AbstractAction::_processUrlKeys`:

```php
if ($this->getRequest()->isPost()) {
    $_isValidFormKey = $this->_formKeyValidator->validate($this->getRequest());
} elseif ($this->_backendUrl->useSecretKey()) {
    $_isValidSecretKey = $this->_validateSecretKey();
}
```

So neither setting turns off admin CSRF protection. What the secret key does is
append a `/key/<hash>/` segment to admin GET URLs, and
`module-store/etc/config.xml` ships it as `1` -- on, in a stock store. With it
on, a GET to a bare admin route is answered with `_redirect($this->_backendUrl
->getStartupPageUrl())`: a 302 to a 200 on the dashboard, which no
failed-request check can see, and which only a body-class or URL assertion
catches.

Every admin spec here except `admin/menu-navigation.spec.ts` navigates by bare
route, so `.github/workflows/e2e.yaml` sets this to `0` itself, in a step that
says why. That is a real gap between the gate and a stock store, and the way to
close it is to navigate the admin by the links the admin renders -- which is
what that one spec exists to prove is possible.

`admin_account_sharing` at `1` is what upstream's own integration suite sets,
in `dev/tests/integration/etc/config-global.php.dist`. With it off, a login
terminates the account's other sessions
(`Magento\Security\Model\AdminSessionsManager`), and this suite shares one
admin account across a saved `storageState`.

`ConfigsApplyFixture` iterates `$configs['config']` as a list, but a single
`<config>` element collapses to a flat map, so the fixture iterates that
element's own values and fatals with `Cannot access offset of type string on
string`. `small.xml` carries four entries, so upstream never sees it. Keep at
least two in the `<configs>` block.

## What the checkout spec does not cover

Registered-customer checkout, a real payment gateway, taxes, discounts and
multi-address shipping. Each wants fixtures of its own, and none of them is on
the path between "we tagged a release" and "a shopper can buy something".
