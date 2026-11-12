# Magento 2 Coding Standard Action

A Github Action that runs the Magento Coding Standard.

> [!WARNING]
> This action is only compatible with Magento v2.4.4+.

## Inputs

See the [action.yml](./action.yml)

## Usage

The caller is responsible for checking out the repository and setting up PHP before calling this action.

```yml
name: Coding Standard

on:
  push:
    branches:
    - main
  pull_request:
    branches:
    - main

jobs:
  coding-standard:
    runs-on: ubuntu-latest
    steps:
    - uses: actions/checkout@v6

    - uses: shivammathur/setup-php@v2
      with:
        php-version: '8.3'
        tools: composer:v2
        coverage: none

    - uses: mage-os/github-actions/coding-standard@main
      with:
        path: app/code # Optional, defaults to .
        version: 25 # Optional, will use the latest if omitted.
        severity: 8 # Optional, will use phpcs default of 5 if not specified.
        warning_severity: 4 # Optional, will use severity value if not specified.
        error_severity: 7 # Optional, will use severity value if not specified.
```

## Where the standard is installed

If `path` already has the coding standard in its `vendor` directory, that copy
is used. Otherwise the standard is installed into a directory of its own under
`RUNNER_TEMP`, and `phpcs` is run from there against `path`.

It is not installed into the code under test, because `phpcs` reads files
statically and never autoloads the project. Installing it there makes the
project's own locked dependencies a veto over whether the standard can be
installed at all -- a project locked to a `magento/framework` that caps PHP
below the runner's version cannot resolve one, and the check fails before a
single sniff runs.
