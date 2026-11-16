import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every spec's page, watched for the failures assertions cannot see.
 *
 * Three signals, each catching something the other two do not:
 *
 *   pageerror  an uncaught JS exception. Knockout gives up on a binding, a
 *              requirejs module is missing, a mixin no longer resolves. The
 *              page renders, the screenshot is perfect, every assertion
 *              passes, and the button does nothing.
 *   console    the browser's own report of a failed subresource, and anything
 *              the store's own code logged as an error.
 *   response   any response at or above 400. This is the one that matters
 *              most, because a failed *XHR* breaks no assertion: Magento_Ui
 *              renders a listing from its client-side page cache and keeps
 *              the last good state, so a grid whose data provider returns
 *              500 goes on showing the rows it already had. Measured: a 500
 *              on mui/index/render leaves the row count unchanged and raises
 *              no pageerror at all.
 *
 * Findings fail the test, and are also attached to the report and written to
 * test-results/js-errors.jsonl so a red run says what happened without
 * anyone opening a trace.
 *
 * This was committed strict only after a report-only run of the whole suite:
 * eleven specs produced exactly one recurring finding, the post-order totals
 * refresh documented below. A check like this is only as good as its ignore
 * list, and a growing ignore list is how such a check dies -- so every entry
 * has to earn its comment, and anything new is a finding until proven
 * otherwise.
 */

/**
 * Console messages that are not findings.
 *
 * The browser's own "Failed to load resource" line is a URL-less echo of
 * something the response listener below already reports with a status, a
 * method and the full URL. Keeping both means every HTTP finding is counted
 * twice, and the duplicate is the less informative of the two.
 */
const ignoredConsole: RegExp[] = [/^Failed to load resource/];

/**
 * Uncaught exceptions that are not findings. One entry, and it is a judgement
 * call rather than an obviously benign one, so it is written out in full.
 *
 * Mage-OS enables cross-document view transitions by default --
 * MageOS_ThemeOptimization renders `@view-transition { navigation: auto; }`
 * on every storefront page, with system/view_transitions/enable defaulting
 * to 1. Under automation the navigations come faster than a person's, and
 * Chrome intermittently aborts the transition in flight:
 *
 *     Transition was aborted because of invalid state.
 *     ViewTransition opt-in disabled
 *
 * Seen in CI on category and product pages, on the first attempt only, with
 * the retry clean. It is the abort of a cosmetic transition, not a broken
 * store, and the shopper sees a rendered page either way.
 *
 * It is ignored rather than fixed here because a gate that reports a flake is
 * a gate people learn to re-run, which costs more than this error does. It is
 * still worth an upstream report: the module's own source notes that some
 * in-app browsers "never finish" the transition and leave the page blank, so
 * this feature has failure modes that a cosmetic label does not cover.
 * Narrow on purpose -- any other uncaught exception, including any other
 * view-transition failure, is still a finding.
 */
const ignoredPageErrors: RegExp[] = [/^Transition was aborted because of invalid state\./];

/**
 * HTTP responses that are not findings. One entry, and it has to stay this
 * narrow.
 *
 * Magento's checkout refreshes the cart totals after the order is placed.
 * Measured on Mage-OS 4.0.0: payment-information returns 200 at T, and
 * GET /guest-carts/<id>/totals returns 404 at T+460ms, because the quote the
 * place-order call just consumed is no longer an active guest cart. The
 * shopper is on the success page by then and nothing is broken.
 *
 * Scoped to that one path and that one status rather than to 404s, or to
 * /rest/ 404s, so it cannot hide a cart that 404s while the shopper is still
 * trying to check out. That failure would also break the spec's own
 * assertions -- totals would not render and the order would not be placed --
 * which is what makes an ignore this narrow safe to carry.
 */
const ignoredHttp: RegExp[] = [/^404 GET xhr \/rest\/\S+\/guest-carts\/\w+\/totals/];

const logFile = path.resolve(__dirname, 'test-results/js-errors.jsonl');

type Finding = { kind: 'pageerror' | 'console' | 'http'; detail: string; where: string };

export const test = base.extend({
    page: async ({ page }, use, testInfo) => {
        const findings: Finding[] = [];

        page.on('pageerror', (error) => {
            const detail = error.message.split('\n')[0];
            if (ignoredPageErrors.some((pattern) => pattern.test(detail))) return;
            findings.push({ kind: 'pageerror', detail, where: page.url() });
        });

        page.on('console', (message) => {
            if (message.type() !== 'error') return;
            const text = message.text();
            if (ignoredConsole.some((pattern) => pattern.test(text))) return;
            findings.push({ kind: 'console', detail: text.slice(0, 200), where: page.url() });
        });

        page.on('response', (response) => {
            if (response.status() < 400) return;
            const request = response.request();
            const detail = `${response.status()} ${request.method()} ${request.resourceType()}`;
            const path = response.url().replace(/^https?:\/\/[^/]+/, '');
            if (ignoredHttp.some((pattern) => pattern.test(`${detail} ${path}`))) return;
            findings.push({ kind: 'http', detail, where: response.url() });
        });

        await use(page);

        if (findings.length > 0) {
            testInfo.annotations.push({
                type: 'js-errors',
                description: findings.map((f) => `${f.kind}: ${f.detail}\n  ${f.where}`).join('\n'),
            });
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
            fs.appendFileSync(
                logFile,
                findings
                    .map((f) => JSON.stringify({ test: testInfo.titlePath.filter(Boolean).join(' > '), ...f }))
                    .join('\n') + '\n',
            );
        }

        // A page that renders correctly and still logs an error is a release
        // failure this suite would otherwise report as a pass.
        expect(
            findings.map((f) => `${f.kind}: ${f.detail} <- ${f.where}`),
            'the page should not have logged a JavaScript error or a failed request',
        ).toEqual([]);
    },
});

export { expect };
