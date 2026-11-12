# Browser-based E2E Tests for Mage-OS

A Github Workflow that stands a Mage-OS store up, **serves it**, and points a
browser-based test runner at it.

This is not the PHPUnit-based suite that upstream calls "functional tests". It
installs a store, serves it through Traefik and Varnish on a resolvable
hostname, optionally seeds a catalog, and runs a browser against the result.

## Inputs

See the [e2e.yaml](./e2e.yaml)

### What to install

| Input                | Description                                                                 | Required | Default                       |
| -------------------- | --------------------------------------------------------------------------- | -------- | ----------------------------- |
| magento_version      | The package to install, e.g. `mage-os/project-community-edition:4.0.0`      | true     | NULL                          |
| magento_repository   | The composer repository to install it from                                  | false    | https://repo.mage-os.org/     |
| php_version          | The PHP version that installs and serves the store                          | false    | 8.4                           |
| composer_version     | The Composer version used inside the container                              | false    | 2.10.2                        |

A release gate points `magento_repository` at the preview repository and
`magento_version` at the release being built, which is how it tests the
artifact about to be tagged rather than whatever is already published.

### What to serve it with

| Input                  | Description                                                               | Required | Default         |
| ---------------------- | ------------------------------------------------------------------------- | -------- | --------------- |
| database               | Database service and version                                              | false    | mariadb:11.8    |
| search                 | Search service and version                                                | false    | opensearch:3.4  |
| rabbitmq               | Message queue service and version                                         | false    | rabbitmq:4.2    |
| redis                  | Cache service and version                                                 | false    | redis:7.4       |
| varnish                | HTTP cache service and version                                            | false    | varnish:8.0     |
| static_content_themes  | Space separated themes to deploy static content for. Empty deploys every theme, which is considerably slower. | false | Magento/luma Magento/backend |
| backend_frontname      | `setup:install --backend-frontname`. Passed to the install and to the suite from this one place, so the two cannot disagree about the admin URL. | false | admin |
| disable_admin_auth_modules | Disable `Magento_TwoFactorAuth` and `MageOS_PasskeyAuth` so a suite can sign in to the admin. Set `false` for a storefront-only run. | false | true |

### Where the suite comes from

| Input             | Description                                                      | Required | Default                           |
| ----------------- | ---------------------------------------------------------------- | -------- | --------------------------------- |
| suite_repository  | The repository holding the test suite                            | false    | mage-os/github-actions            |
| suite_ref         | The ref to check it out at                                       | false    | main                              |
| test_directory    | The suite's directory, relative to the root of `suite_repository` | false    | _test/demo-package/Test/e2e       |

The defaults point at the suite this repository carries for its own canary. A
caller with a suite of its own overrides all three.

### How to run it

| Input                    | Description                                                        | Required | Default              |
| ------------------------ | ------------------------------------------------------------------ | -------- | -------------------- |
| test_command             | The command to run, from `test_directory`                          | false    | `npx playwright test` |
| node_version             | Node version for the runner                                        | false    | 22                   |
| fixture_profile          | A performance-toolkit profile to seed, relative to the suite root. Empty skips seeding. | false | _test/demo-package/Test/e2e/fixtures/mageos-e2e.xml |
| timeout_minutes          | Job timeout                                                        | false    | 60                   |
| artifact_name            | Name of the uploaded report artifact                               | false    | playwright-report    |
| artifact_retention_days  | How long the report is kept                                        | false    | 30                   |

## Secrets

| Input         | Description                                                                 | Required | Default |
| ------------- | --------------------------------------------------------------------------- | -------- | ------- |
| composer_auth | JSON string of composer credentials                                         | false    | NULL    |

## Outputs

| Output   | Description                           |
| -------- | ------------------------------------- |
| base_url | The URL the store was served on       |

## `test_command`

The workflow does not know what test runner you use. `test_command` is run from
`test_directory` with `PLAYWRIGHT_BASE_URL` already set to the served store, so
a caller can pass grep filters, shards, a different reporter, or something that
is not Playwright at all, without this workflow growing an input per flag.

The command arrives through the environment rather than interpolated into the
script, so its quoting is bash's problem and not the expression engine's.

**Keep evidence policy out of it.** `trace`, `video` and `screenshot` belong in
the suite's own config, where they are reviewable. A CLI flag overrides the
config, and `--trace on` records a trace for every passing test, which uploads
a large artifact for no benefit. The default command carries no flags for that
reason.

### A setup phase

Playwright's project `dependencies` are the mechanism for shared state that is
expensive to build -- an authenticated admin or customer session saved as
`storageState` and reused by every spec that needs it. Express that in the
suite's config rather than as two `--grep` / `--grep-invert` invocations in
`test_command`: two invocations write to the same report directory, so the
second overwrites the first and a failing setup phase loses its own evidence.
One command, one report, one exit code.

Data is a different matter. Catalog and configuration are seeded through
`fixture_profile` by the CLI in seconds; doing the same work through a browser
would be slower and flakier for no gain.

## What the suite is told about the store

| Variable | Value |
| --- | --- |
| `PLAYWRIGHT_BASE_URL` | the served store's URL |
| `MAGEOS_VERSION` | e.g. `4.0.0` |
| `MAGENTO_VERSION` | the upstream version it is based on, e.g. `2.4.9` |
| `MAGENTO_ADMIN_USER` | the admin account the install created |
| `MAGENTO_ADMIN_PASSWORD` | its password |
| `MAGENTO_ADMIN_FRONTNAME` | whatever `backend_frontname` was set to |

The admin credentials are not inputs. `warden/setup-environment` hardcodes
them in its `admin:user:create` step, so an input a caller could change
without the store changing would only ever be a lie. They are not secrets
either: the store is created and destroyed inside one job.

`backend_frontname` **is** an input, and it reaches the install and the suite
from that single place. Two places holding separate opinions about the admin
URL is a 404 that presents as a broken admin.

## Signing in to the admin

`disable_admin_auth_modules` (default `true`) disables
`Magento_TwoFactorAuth` and `MageOS_PasskeyAuth` after the install.

This is not a convenience. Magento has no configuration flag that switches 2FA
off: `twofactorauth/general/force_providers` is empty by default, and
`ControllerActionPredispatch` still routes a fresh admin user to
`tfa/tfa/index`, which redirects to `tfa/tfa/requestconfig`. Disabling the
module is the only way in. `MageOS_PasskeyAuth` requires it and registers an
admin 2FA provider, so the two go together or `module:disable` refuses the
command. `MageOS_PasskeyAuth` does not exist outside Mage-OS, so the step
checks before naming it -- `module:status` exits `0` even for a module that is
not installed, so its output is the only signal.

The step also pins `admin/usage/enabled` to `0`, its own default, because that
flag gates `Magento_AdminAnalytics`' usage-data modal, which would otherwise
cover the dashboard on first sign-in.

And it disables the admin login CAPTCHA. That one is **on** by default:
`admin/captcha/enable` is `1` in `after_fail` mode, asking for a CAPTCHA after
three failed attempts per login name, counted in the `captcha_log` table. Any
suite that asserts a bad credential is refused generates those failures, so
leaving it on lets a negative control poison the positive one -- and it
surfaces as `Incorrect CAPTCHA` on a password that is correct, which sends you
looking in the wrong place entirely.

The cost is explicit: **a run with this on does not cover admin 2FA.** Doing
that properly means driving a TOTP provider from its shared secret, which is
worth a spec of its own rather than a flag here.

`Magento/backend` is in the `static_content_themes` default for the same
reason: an admin spec against an undeployed admin theme waits for every asset
to be generated on demand, and reads as a timeout rather than as a missing
deploy.
Both versions are **probed from the running store** (`bin/magento --version`),
not echoed back from `magento_version`. A version input can be a constraint,
the repository can resolve it differently than expected, and a gate should
report what installed rather than what was asked for.

Two versions rather than one because they drift apart for different reasons:
Luma markup tracks upstream Magento, while feature availability tracks Mage-OS.
A spec that has to care about either should say so next to the assertion:

```ts
test('...', async ({ page }) => {
    test.skip(!atLeast(process.env.MAGEOS_VERSION, '5.0.0'), 'introduced in 5.0');
});
```

Prefer `test.skip` with a reason over excluding the spec with `--grep`. A skip
appears in the report, with its reason, so "why did this not run" is answerable
from the artifact. A grep exclusion is invisible, and nothing fails when a
version condition goes stale.

The step also writes the full stack -- PHP, database, search, Redis and Varnish
patch levels, probed from the containers -- to the job summary, so a red gate
says what it ran against without anyone reading the log.

## Fixtures

`fixture_profile` is a [performance
toolkit](https://developer.adobe.com/commerce/php/development/tools/performance-toolkit/)
profile, applied with `setup:performance:generate-fixtures`. The command
reindexes as part of its own run, so no `indexer:reindex` follows it.

A bare `setup:install` has no salable product, so any suite that reaches a
product page or a checkout needs this. Leave it empty for a suite that asserts
only on what a bare install provides.

## Usage

```yaml
jobs:
  e2e:
    uses: mage-os/github-actions/.github/workflows/e2e.yaml@main
    with:
      magento_version: "mage-os/project-community-edition:4.0.0"
```

Gating a release on the artifact that is about to be tagged:

```yaml
jobs:
  storefront-check:
    needs: [ deploy ]
    uses: mage-os/github-actions/.github/workflows/e2e.yaml@main
    with:
      magento_repository: ${{ inputs.repo }}
      magento_version: "mage-os/project-community-edition:${{ inputs.mageos_release }}"
      artifact_name: "storefront-check-${{ inputs.mageos_release }}"
```

Running a suite of your own:

```yaml
jobs:
  e2e:
    uses: mage-os/github-actions/.github/workflows/e2e.yaml@main
    with:
      magento_version: "mage-os/project-community-edition:4.0.0"
      suite_repository: my-org/my-e2e-tests
      suite_ref: v1.2.0
      test_directory: "."
      test_command: "npx playwright test --grep @smoke"
      fixture_profile: "fixtures/minimal.xml"
```

## Where things end up on the runner

`warden/setup-environment` checks the Warden CLI out into `warden/` at the
workspace root, and `base_directory` has to sit exactly one level below it.
That is why the suite is checked out into `suite/` and the store into
`_ghamagento/`, and why neither is at the workspace root.
