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
| `storefront/hello-magento.spec.ts` | no | the Luma homepage renders with static content deployed |
| `storefront/guest-checkout.spec.ts` | yes | catalog -> product -> cart -> shipping -> payment -> order |
| `storefront/customer-checkout.spec.ts` | yes | address book -> preselected address -> order -> My Orders -> the order page |
| `storefront/product-page.spec.ts` | yes | the product page's own details, and a cart whose arithmetic adds up |
| `storefront/customer-account.spec.ts` | no | register -> signed in -> sign out -> sign in, and a refused credential |
| `storefront/search.spec.ts` | yes | a sku read off a product page is found by full-text search, and an absent term is not |
| `admin/login.spec.ts` | no | the admin sign-in form refuses a bad credential and accepts a good one |
| `admin/product-grid.spec.ts` | yes | the product grid renders through Magento_Ui and filters server-side |
| `admin/create-product.spec.ts` | no | admin form -> EAV save -> url rewrite -> indexers -> storefront -> quote |
| `admin/create-category.spec.ts` | yes | category tree -> save -> url rewrite -> category index -> storefront listing + menu |
| `admin/create-customer.spec.ts` | no | customer form -> save -> read-back -> the storefront refuses the address twice |
| `admin/create-order.spec.ts` | yes | create-order form -> quote -> shipping rate -> payment -> order -> order grid |
| `admin/menu-navigation.spec.ts` | no | the admin's own rendered link reaches the product grid, secret key or not |

Each area owns a directory, and the Playwright project of the same name
matches it:

```
fixtures.ts                 the page fixture both areas use
admin/support.ts            admin helpers, selectors, the saved session
admin/*.spec.ts
storefront/luma.ts          storefront selectors
storefront/support.ts       storefront behaviour
storefront/*.spec.ts
```

Storefront selectors live in `storefront/luma.ts`, shared by every spec that
looks at a storefront page. A Hyva variant of this suite is that file with a
different map, not a rewrite of the specs. `storefront/support.ts` holds the
behaviour that goes with them -- choosing whatever options a product requires,
reading the number out of a rendered price, registering an account, filling an
address form -- because that part is not theme-specific. Three admin specs import from both, which is the point: an
admin spec that proves a save reached a shopper is looking at a storefront
page, and should read it the way the storefront specs do.

## Running it against a store

```bash
cp .env.example .env     # then point PLAYWRIGHT_BASE_URL at your store
npm ci
npx playwright install --with-deps chromium
npm test
```

`storefront/guest-checkout.spec.ts` needs a salable product, which a bare
`setup:install` does not have. Seed one first -- see [Fixtures](#fixtures).

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

## The storefront specs

### Luma renders every login field twice, with the same ids

Magento renders the authentication popup -- the one checkout opens -- into
every page, and it carries a second copy of the sign-in form. Measured on the
login page of Mage-OS 4.0.0:

| Selector | `name` | Visible | Which copy |
| --- | --- | --- | --- |
| `#pass` | `password` | no | the popup |
| `#password` | `login[password]` | yes | the form |
| `#customer-email` | `username` | no | the popup |
| `#email` | `login[username]` | yes | the form |
| `#send2` | - | no | the popup |
| `#send2` | - | yes | the form |

So `#send2` matches two elements and `#pass` matches the invisible one. A spec
that uses either waits thirty seconds for a hidden element to become
clickable and then reports a timeout, which reads as a broken store rather
than as a selector that found the wrong copy. Everything in
`storefront/luma.ts` under
sign-in is scoped to `.login-container`, which holds only the real form.

This is the storefront twin of the `#login-form` collision the admin sign-in
spec documents below -- and the same popup is what causes it.

### Registering signs the customer in

`CreatePost` calls `setCustomerDataAsLoggedIn` unless
`customer/create_account/confirm` is set, and it is `0`. Two consequences for
a spec:

- The login page is only reachable after signing out. Visiting it while
  signed in redirects to the dashboard -- where the only password field left
  in the DOM is the popup's hidden copy, so the symptom is the timeout above
  rather than a wrong URL.
- The sign-out link is rendered **four times** and every copy is hidden until
  the header's `.customer-welcome` switch is clicked. Clicking that switch is
  part of the assertion: a header that never renders its customer menu is a
  broken header.

The account dashboard's Contact Information box is server rendered, so that is
what the spec reads the saved customer back out of. The header greeting
arrives with private content and is a worse thing to assert on.

A password needs 8 characters and 3 of the 4 character classes
(`customer/password/minimum_password_length`,
`required_character_classes_number`).

### Luma's quick search can only be submitted by keyboard

`Magento_Search`'s `form-mini` widget binds a `_.debounce`d handler to the
search field's `input` event. That handler sets `submitBtn.disabled = true`
and the re-enable beside it does not stick, so roughly 400ms after typing
stops the search button is dead for the rest of the page's life.

Measured against a seeded store, with the button already disabled:

| submission | result |
| --- | --- |
| `press('Enter')` | submits |
| `click()` on the button | does not submit |
| `click({ force: true })` | does not submit |
| `form.requestSubmit()` | submits |

So the spec types and presses Enter. Clicking the button works only inside
that 400ms window, which is why doing it looks fine on an idle machine and
fails on a busy one. Worth reporting upstream: a shopper who types, pauses,
then reaches for the button gets nothing.

### An absent search term has to be one token

The query is tokenised and matched as an OR, so a hyphenated phrase is not an
absent term. `zzz-mageos-no-such-product-zzz` splits and matches the entire
catalogue on `product` alone -- which is how the no-results test failed the
first time it ran. The term is a single nonsense token, and fixed rather than
random, because a gate that reports a different failure every run is one
nobody can triage.

### The storefront CAPTCHA is on, for two forms

`customer/captcha/enable` is `1`, for `user_login` and `user_forgotpassword`,
in `after_fail` mode, after **three failures per login name**. So the refusal
test signs in as an address generated per run, which can never be the third
failure for anything -- the same trick the admin sign-in spec uses, for the
same reason.

Registration has no CAPTCHA: `user_create` appears in `always_for` but not in
`customer/captcha/forms`, and the `forms` list is what decides.

### What a signed-in checkout sees that a guest does not

`storefront/customer-checkout.spec.ts` is not the guest spec with a session
attached. Checkout renders differently for someone it knows, and all three
differences below were measured on this store rather than assumed -- each one
is an assertion the guest spec cannot make:

| | guest | signed in |
| --- | --- | --- |
| email | `#customer-email`, the first field to fill | not in the page at all |
| address | `#co-shipping-form`, empty | the default address, preselected; the form is in the DOM but hidden |
| success page | the increment id in a bare `<span>` | `a.order-number`, linking to the order |

So the email check is `toHaveCount(0)` and the address-form check is
`not.toBeVisible()`. Neither could be the other way round: the form *is*
present -- it belongs to the New Address popup -- and the email field is
absent rather than hidden.

The order link is what the rest of the spec rests on. A guest order is
attached to an email address and a signed-in one to a customer id, and that
association is why the order then appears in My Orders and opens from it. The
spec carries the increment id the success page gave it to both of those pages,
so what it proves is that one order moved through, not that three pages each
rendered something plausible.

One selector trap on the way: the My Orders grid and the order's own items
table are both `#my-orders-table`. `sales_order_history.phtml` and
`order_items.phtml` give them the same id, on different pages. The grid is
therefore addressed through its cells (`td.col.id`, `td.col.status`) and the
order through `.table-order-items`.

The first address a customer saves becomes the default for billing *and*
shipping, which is what lets checkout preselect it -- an account with no
address gets the empty form instead, which is the guest spec's path again.
The spec also asserts the new-address form arrives carrying the customer's
name before it types anything into it: a form reading the wrong entity saves
the address either way, so nothing else would notice.

### Why a second cart spec

`storefront/guest-checkout.spec.ts` walks past the product page and the cart
on its way
to an order, and it has to -- its subject is the whole path. `product-page`
looks closely at both instead, and asserts the thing nothing else does: that
the arithmetic holds. Unit price times quantity is the row subtotal, the rows
are the cart subtotal, subtotal plus shipping is the order total. Totals are
assembled by collectors that any module can replace, so that is an assertion
about the release.

Every amount is compared against another amount the store rendered, never
against a number in the spec. A gate that goes red because a fixture
product's price changed is a gate people switch off.

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

### The create-order form rebuilds itself, and that is the whole problem

`admin/create-order.spec.ts` drives a page from before Magento_Ui. Every
interaction -- choosing a customer, adding a product, changing the country,
asking for rates, picking a payment method -- is a POST to
`sales/order_create/loadBlock` that returns fresh HTML for part of the form.
There is no "ready" state, no loading mask that is reliably present, and the
next action's target often does not exist until the previous reload lands.

Waiting on timeouts does not work, and it fails in the worst way. Measured
while writing the spec: add a product, read the items grid 700ms later, and it
says **"No ordered items"** -- the add had been accepted, the grid had not
re-rendered. A spec written that way then picks a shipping method for an empty
order, gets no rates, and goes red three steps away from anything that is
wrong.

So the spec counts those requests and waits for them to stop -- in flight
count at zero and nothing new for a quiet period. The quiet period matters:
one action can trigger two reloads, so awaiting "the next response" returns on
the first and reads a half-built form.

Three more traps on that page, each of which cost a red run to find:

- **The row checkbox needs `click()`, not `check()`.** It is the legacy grid
  widget, whose selection is wired to the checkbox's click handler.
  `check()` sets the property, the handler never runs, and the product is
  silently not added. Same family as the category spec's product grid.
- **The sku filter is a `LIKE`.** Filtering for `product_dynamic` returns
  every fixture simple, so the spec reads the sku, name and price out of the
  row it picked instead of assuming which row it got.
- **One payment method means the radio is checked and hidden.** A shipped
  store has exactly one active method, so the admin applies it as soon as the
  order has a total and collapses the block to a summary line. The input is
  in the DOM, `checked`, and invisible. Insisting on clicking it fails with
  `42 x locator resolved to <input ... id="p_method_checkmo"
  checked="checked"> - unexpected value "hidden"`, which reads as a missing
  payment method rather than as one already chosen. The spec asserts
  *attached*, expands the summary if it is collapsed, and only clicks if
  nothing has been chosen -- so it works on a store with one method and on a
  store with six.

### The storefront half of an admin spec is a different visitor

Three admin specs cross into the storefront to prove the save reached a
shopper. They do it from a fresh session, by `asShopper(page)` in
`storefront/support.ts`, and that is not tidiness either.

The admin specs reuse a saved admin session, which is a cookie jar the
storefront requests inherit: an `admin` cookie, a PHPSESSID created in the
adminhtml area, and a `form_key` cookie that belongs to it. Magento renders
the storefront form with that session's form key, and Magento_PageCache's
form-key-provider rewrites the hidden input from the cookie -- so a storefront
POST is validated against a form key the admin area also controls.

Observed: `admin/create-customer.spec.ts` failed its registration step twice
with `Invalid Form Key. Please refresh the page.` where it expected `There is
already an account with this email address`, then passed five times in a row.
Anything else touching that admin session -- a second run against the same
store, a human signed in as the same account, a retry -- can rotate the key
under a page that has already rendered it. CI has never seen it, because a
gate's store is used once and by one run.

Rather than chase that race: a shopper is not an administrator. Clearing the
cookies costs one request's worth of session and removes the class.

### One grid a save does update

`admin/create-order.spec.ts` asserts the order appears in the order grid.
`admin/create-customer.spec.ts` deliberately does not assert the customer
grid. The difference is in the shipped configuration, not in the specs:
`sales/general/async_indexing` is `0`, so `sales_order_grid` is written in the
same request that saves the order, while `customer_grid` is a scheduled
indexer that this store has no cron to run.

One is a fair assertion. The other would be a red test against a store that is
working correctly, which is the worst kind to put in front of someone deciding
whether to ship.

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
Eleven specs produced exactly one recurring finding: a request the checkout
issues against the quote that placing the order has just consumed. The masked
id of a guest cart stops resolving the moment the quote becomes an order, so
anything still in flight comes back 404. Which request it is, is a race.
Measured by logging every `/rest/` response with its offset from the start of
the test and repeating the checkout spec six times -- three clean, two on
totals, one on estimate-shipping-methods:

```
+10164ms  200 POST  .../payment-information
+10645ms  404 GET   .../totals                     (+481ms)

 +7633ms  200 POST  .../payment-information
 +7709ms  404 POST  .../estimate-shipping-methods    (+76ms)
```

The shopper is on the success page by then and nothing is broken. Those are
two entries in the ignore list, each scoped to one path, one method and one
status -- not to 404s, not to `/rest/` 404s, and not to `/guest-carts/` 404s.
A cart that 404s while a shopper is still checking out has to stay a finding.

A third kind of entry was added after the first rehearsal with Varnish owning
the page cache: Mage-OS enables cross-document view transitions by default
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

## What the checkout specs do not cover

A real payment gateway, taxes, discounts, multi-address shipping, and the
order's life after it is placed -- invoice, shipment, credit memo. Each wants
fixtures or credentials of its own, and none of them is on the path between
"we tagged a release" and "a shopper can buy something".

Both ways of buying are covered: `guest-checkout` as a visitor and
`customer-checkout` as a shopper with an account, an address book entry and an
order history. `admin/create-order` covers the third front end onto the same
quote model, carrier pool and payment pool.

The nearest remaining gap is the order state machine. Every order this suite
places stays Pending, because Check / Money order is the only payment method
on a store with no gateway credentials, and nothing here invoices or ships
one. An invoice-and-ship spec against the order `admin/create-order` already
places would cover it without needing a single new fixture.
