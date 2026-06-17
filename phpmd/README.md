# PHP Mess Detector for Magento

A GitHub Action that runs the Magento PHPMD (PHP Mess Detector).

## Inputs

See the [action.yml](./action.yml)

Usage:

```yaml
name: PHP Mess Detector

on:
  push:
    branches:
    - main
  pull_request:
    branches:
    - main

jobs:
  mess-detector:
    runs-on: ubuntu-latest
    steps:
    - uses: mage-os/github-actions/phpmd-action@main
      with:
        php_version: '8.1' # PHP version used to execute PHPMD.
        composer_version: '2' # Version of composer to use.
        path: 'app/code' # Directory for PHPMD execution when event is not a pull request.
        ruleset_path: 'dev/tests/static/testsuite/Magento/Test/Php/_files/phpmd/ruleset.xml' # Path to the ruleset.xml file. Optional.
```
