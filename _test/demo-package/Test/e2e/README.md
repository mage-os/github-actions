# Storefront smoke test

A deliberately small Playwright suite whose only job is to prove that a Mage-OS
storefront is **being served** -- installed, reachable over HTTP(S) and
rendering with its static content deployed.

It is the canary for [`warden/setup-environment`](../../../../warden/setup-environment):
`.github/workflows/_internal-e2e.yaml` stands a store up with that action on
every change to it and runs this suite against the result.

It is not a test suite for a store's behaviour. Product, cart and checkout
coverage belongs in a suite of its own, with its own fixtures.

## Running it against a store

```bash
cp .env.example .env     # then point PLAYWRIGHT_BASE_URL at your store
npm ci
npx playwright install --with-deps chromium
npm test
```

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
written -- point `PLAYWRIGHT_BASE_URL` at the admin URL, or clear `pub/static`,
and watch the step go red.
