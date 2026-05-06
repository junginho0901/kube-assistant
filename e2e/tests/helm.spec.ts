import { test, expect } from '@playwright/test'

// Helm Releases page — already migrated to WebSocket watch on the
// feature branch. Captures the list view + (if any release exists) the
// detail page.

test.describe('Helm Releases', () => {
  test('list — initial render', async ({ page }) => {
    await page.goto('/helm/releases')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1.text-3xl').first()).toContainText(/helm/i)

    await expect(page).toHaveScreenshot('helm-releases-list.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })

  test('detail — first release if present', async ({ page }) => {
    await page.goto('/helm/releases')
    await page.waitForLoadState('networkidle')

    // Find the first release row link (if any).
    const firstRow = page.locator('tbody tr').first()
    const hasReleases = (await firstRow.count()) > 0

    test.skip(!hasReleases, 'no releases in this cluster — skipping detail snapshot')

    await firstRow.click()
    await page.waitForLoadState('networkidle')
    await expect(page.locator('h1.text-3xl').first()).toBeVisible()

    await expect(page).toHaveScreenshot('helm-release-detail.png', {
      fullPage: true,
      animations: 'disabled',
    })
  })
})
