cd e2e
npm install -D @playwright/test
npx playwright install
npm install -D dotenv
npx playwright test hello-magento.spec.ts
