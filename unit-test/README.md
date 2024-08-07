# Magento 2 Unit Test Action

A Github Action that runs the Unit Tests of a Magento Package

## Inputs

See the [action.yml](./action.yml)

## Usage

```yml
name: Unit Test

on:
  push:
    branches:
    - main
  pull_request:
    branches:
    - main

jobs:
  unit-test:
    strategy:
      matrix:
        php_version:
          - 8.2
          - 8.3
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v2
    - uses: mage-os/github-actions/unit-test@main
      with:
        php_version: ${{ matrix.php_version }}
        composer_auth: ${{ secrets.COMPOSER_AUTH }}
```
