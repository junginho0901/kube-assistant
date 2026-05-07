import { defineConfig, devices } from '@playwright/test'

// E2E config — runs against the kind cluster's gateway (port 8000).
// Snapshots are committed-equivalent baselines that the refactor PRs
// must not change. The baseline pass is captured on `main`; subsequent
// runs on a feature branch must match pixel-for-pixel (within
// maxDiffPixels tolerance for sub-pixel font rendering / animation
// frames that survived the wait).
export default defineConfig({
  testDir: './tests',
  fullyParallel: false, // single-cluster; serialize to keep K8s state stable
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',

  expect: {
    // Animation / 1px sub-pixel rounding is the main diff source.
    // 100 pixel tolerance is empirically below "any meaningful UI change".
    toHaveScreenshot: {
      maxDiffPixels: 100,
      // Animations are explicitly disabled per-test via `animations: 'disabled'`.
      threshold: 0.2,
    },
  },

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:30080',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Avoid running into self-signed cert errors on kind.
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: '.auth/user.json',
        // Copy 버튼 검증 (ai-chat.spec) 을 위해 clipboard 접근 허용
        permissions: ['clipboard-read', 'clipboard-write'],
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
})
