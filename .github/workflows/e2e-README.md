# End-to-End (E2E) Tests for Mage-OS / Magento

A reusable GitHub Actions workflow that installs Magento (Mage-OS)
and runs browser-based End-to-End (E2E) tests against a real storefront
using Playwright or an equivalent E2E runner.

## Inputs

See the [e2e.yaml](./e2e.yaml)

| Input              | Description                                                                                                                                     | Required | Default                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------- |
| matrix             | JSON string of [version matrix for Magento](./#matrix-format)                                                                                   | true     | NULL                          |
| fail-fast          | Same as Github's [fail-fast](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstrategyfail-fast) | false    | true                          |
| package_name       | The name of the package                                                                                                                         | true     | NULL                          |
| source_folder      | The source folder of the package                                                                                                                | false    | $GITHUB_WORKSPACE             |
| magento_directory  | The folder where Magento will be installed                                                                                                      | false    | ../magento2                   |
| magento_repository | Where to install Magento from                                                                                                                   | false    | https://mirror.mage-os.org/   |
| test_command       | The e2e test command to run                                                                                                             | false    | "../../../vendor/bin/phpunit" |
| composer_cache_key | A key to version the composer cache. Can be incremented if you need to bust the cache.                                                          | false    | ""                            |

## Secrets
| Input         | Description                                                                                                                             | Required | Default |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- |
| composer_auth | JSON string of [composer credentials](https://devdocs.magento.com/guides/v2.4/install-gde/prereq/connect-auth.html) | false    | NULL    |
> The `test_command` is executed from the Magento installation directory.
> E2E tests are expected to live under `dev/tests/e2e`.

###  Matrix Format

The Magento matrix format outlined by the [supported versions action.](https://github.com/mage-os/github-actions/tree/main/supported-version/supported.json) 


## E2E execution model

The E2E test suite is executed in two phases:

### 1. Setup phase

The setup phase prepares shared browser state (e.g. authenticated sessions,
cookies, required entities). This phase is marked using the `@setup` tag.

```bash
npx playwright test --grep "@setup" --trace on
```

This step is required once per fresh environment.

### 2. Test phase

Once setup has completed successfully, the full E2E test suite can be executed.
Setup tests are skipped using --grep-invert.

```bash
npx playwright test --grep-invert "@setup" --trace on
```

This phase validates real user journeys against a live Magento storefront.

```yml
name: E2E Test

on:
  push:
    branches:
    - main
  pull_request:
    branches:
    - main

jobs:
  compute_matrix:
      runs-on: ubuntu-latest
      outputs:
        matrix: ${{ steps.supported-version.outputs.matrix }}
      steps:
        - uses: actions/checkout@v2
        - uses: mage-os/github-actions/supported-version@main
          id: supported-version
        - run: echo ${{ steps.supported-version.outputs.matrix }}
  e2e-workflow:
    needs: compute_matrix
    uses: mage-os/github-actions/.github/workflows/e2e.yaml@main
    with:
      package_name: my-vendor/package
      matrix: ${{ needs.compute_matrix.outputs.matrix }}
      test_command: |
          npx playwright test --grep "@setup" --trace on
          npx playwright test --grep-invert "@setup" --trace on
  secrets:
      composer_auth: ${{ secrets.COMPOSER_AUTH }}
```
