# Setup Mage-OS in Warden

Brings up a full Mage-OS service stack on the runner using
[Warden](https://github.com/wardenenv/warden), and optionally installs Magento
into it.

Used by [`full-integration-tests.yaml`](../../.github/workflows/full-integration-tests.yaml)
and [`nx-integration-tests.yml`](../../.github/workflows/nx-integration-tests.yml).

## Usage

```yaml
- uses: mage-os/github-actions/warden/setup-environment@main
  with:
    php_version: '8.4'
    database: 'mariadb:11.4'
    search: 'opensearch:3.3'
    run_composer_install: '1'
    run_setup_install: '1'
```

### Browser-based tests

PHPUnit suites drive Magento's own bootstrap and never make an HTTP request, so
they need nothing beyond the above. A browser does. Three things have to be true
before one can reach the storefront, and all three are off by default:

```yaml
- uses: mage-os/github-actions/warden/setup-environment@main
  id: warden
  with:
    php_version: '8.4'
    run_composer_install: '1'
    run_setup_install: '1'
    # Install on the URL the environment is actually served on, otherwise
    # Magento redirects the browser to its default base URL.
    base_url: 'https://app.mageos.test/'
    # Warden uses dnsmasq locally; a runner has no such resolver.
    configure_host_resolution: '1'
    # Without deployed static content the storefront returns 200 and renders
    # nothing.
    run_static_content_deploy: '1'
    static_content_themes: 'Magento/luma'

- run: npx playwright test
  env:
    E2E_BASE_URL: ${{ steps.warden.outputs.base_url }}
```

## Where the action puts things

The action checks the Warden CLI out into `warden/` **at the workspace root**,
and every step then calls it as `$(dirname $(pwd))/warden/bin/warden`. Two
consequences:

- `base_directory` has to be exactly one level below the workspace root.
- a repository checked out at the workspace root that has a `warden/`
  directory of its own will have it overwritten -- including this one. Check
  such a repository out into a subdirectory instead:

  ```yaml
  - uses: actions/checkout@v6
    with:
      path: actions
  - uses: ./actions/warden/setup-environment
  ```

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| `warden_version` | `0.14.2` | Warden version to use. |
| `php_version` | `8.2` | PHP version in the Warden containers. |
| `composer_version` | `2.2.22` | Composer version to use. |
| `database` | `mariadb:10.6` | `distribution:version` of the database. |
| `search` | `opensearch:2.5` | Search engine; `elasticsearch:*` or `opensearch:*`. |
| `varnish` | `varnish:7.3` | Varnish version, or `null` to disable. |
| `rabbitmq` | `rabbitmq:3.11` | RabbitMQ version, or `null` to disable. |
| `redis` | `redis:7.0` | Redis version, or `null` to disable. |
| `base_directory` | `./` | Base directory of the Mage-OS codebase. |
| `run_composer_install` | `0` | Run `composer install`. |
| `run_setup_install` | `0` | Run `setup:install`. |
| `run_setup_upgrade` | `0` | Run `setup:upgrade`. |
| `run_reindex` | `0` | Run `indexer:reindex`. |
| `run_production_deploy_mode` | `0` | Run `deploy:mode:set production`. |
| `run_magento_config_preset` | `0` | Apply the test-oriented config preset. |
| `run_admin_user_creation` | `0` | Create an `admin` / `abcABC123` user. |
| `env_name` | `mageos` | `WARDEN_ENV_NAME`. |
| `traefik_domain` | `mageos.test` | `TRAEFIK_DOMAIN`. |
| `traefik_subdomain` | `app` | `TRAEFIK_SUBDOMAIN`. |
| `traefik_version` | `2.11` | `TRAEFIK_VERSION` for Warden's global services. Warden 0.14.2 defaults to `2.2`, which cannot talk to the Docker daemon on a current runner -- see below. |
| `backend_frontname` | `admin` | Admin frontName passed to `setup:install`. |
| `base_url` | *(empty)* | Passed as `--base-url` with `--use-rewrites=1`. Empty leaves Magento's default. |
| `configure_host_resolution` | `0` | Resolve `<subdomain>.<domain>` to `127.0.0.1` on the runner. |
| `run_static_content_deploy` | `0` | Run `setup:static-content:deploy`. |
| `static_content_languages` | `en_US` | Space separated locales to deploy. |
| `static_content_themes` | *(empty)* | Space separated themes, e.g. `Magento/luma`. Empty deploys every theme. |

### Why `traefik_version` exists

Warden 0.14.2 pins `traefik:${TRAEFIK_VERSION:-2.2}`, and Traefik 2.2's Docker
provider speaks Docker API 1.24. The Docker daemon on GitHub's current runner
image refuses anything below 1.40:

```
traefik | level=error msg="Failed to retrieve information of the docker client
and server host: Error response from daemon: client version 1.24 is too old.
Minimum supported API version is 1.40"
```

Traefik then reads no container labels, builds no routers, and answers **404 to
every request**. Nothing else looks wrong: every container is up, `bin/magento`
works inside them, and a Traefik 404 is indistinguishable from a Magento 404
from outside. If a store answers 404 on every URL, check this before anything
in Magento.

## Outputs

| Name | Description |
| --- | --- |
| `base_url` | The URL the environment is served on, derived from `traefik_subdomain` and `traefik_domain`. |
