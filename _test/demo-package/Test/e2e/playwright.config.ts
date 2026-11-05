import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL;

if (!baseURL) {
    throw new Error(
        'No store to test: set PLAYWRIGHT_BASE_URL, e.g. https://app.mageos.test/ (see .env.example).',
    );
}

export default defineConfig({
    testDir: '.',
    // A cold Magento page can take a while on a shared runner; everything here
    // is deliberately slower than a Playwright default.
    timeout: 120_000,
    expect: { timeout: 20_000 },
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI
        ? [['github'], ['list'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL,
        // Warden serves the environment under its own certificate authority,
        // which is not installed on a GitHub runner.
        ignoreHTTPSErrors: true,
        navigationTimeout: 90_000,
        actionTimeout: 20_000,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
