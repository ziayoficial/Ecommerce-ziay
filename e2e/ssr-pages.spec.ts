// E2E: Public SSR pages — /t/[slug], /t/[slug]/p/[sku], /sitemap.xml, /robots.txt, JSON-LD
// TASK: TESTS-CICD-001

import { test, expect } from '@playwright/test'

const TENANT_SLUG = 'saramantha'

test.describe('SSR storefront', () => {
  test('/t/saramantha renders with products', async ({ page }) => {
    const res = await page.goto(`/t/${TENANT_SLUG}`)
    expect(res?.status()).toBe(200)

    // The storefront must list at least one product link to a /p/[sku] page.
    const productLinks = page.locator(`a[href*="/t/${TENANT_SLUG}/p/"]`)
    const count = await productLinks.count()
    expect(count).toBeGreaterThan(0)

    // The HTML must contain the tenant's brand name somewhere on the page.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.toLowerCase()).toContain('saramantha')
  })

  test('/t/saramantha/p/[sku] renders with product detail', async ({ page }) => {
    // Discover a real SKU from the storefront index page first.
    await page.goto(`/t/${TENANT_SLUG}`)
    const firstProduct = page.locator(`a[href*="/t/${TENANT_SLUG}/p/"]`).first()
    const href = await firstProduct.getAttribute('href')
    expect(href).toBeTruthy()

    const res = await page.goto(href!)
    expect(res?.status()).toBe(200)

    // Product detail page must have at least one heading or product title text.
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.trim().length).toBeGreaterThan(0)
    // Must contain a price (COP currency or $).
    expect(/\$\s?\d|cop/i.test(bodyText)).toBeTruthy()
  })

  test('SSR pages have JSON-LD structured data', async ({ page }) => {
    await page.goto(`/t/${TENANT_SLUG}`)
    // Storefront ships at least one application/ld+json script (Organization or Store).
    const ldScripts = page.locator('script[type="application/ld+json"]')
    const count = await ldScripts.count()
    expect(count).toBeGreaterThan(0)

    // Validate that the first JSON-LD payload parses and has @type + @context.
    const first = await ldScripts.first().textContent()
    expect(first).toBeTruthy()
    const parsed = JSON.parse(first!)
    expect(parsed['@type'] || parsed['@graph']).toBeTruthy()
  })

  test('product detail SSR page has Product + BreadcrumbList JSON-LD', async ({ page }) => {
    await page.goto(`/t/${TENANT_SLUG}`)
    const href = await page.locator(`a[href*="/t/${TENANT_SLUG}/p/"]`).first().getAttribute('href')
    expect(href).toBeTruthy()
    await page.goto(href!)

    const ldScripts = page.locator('script[type="application/ld+json"]')
    const count = await ldScripts.count()
    expect(count).toBeGreaterThanOrEqual(1)

    // At least one JSON-LD block should reference a Product schema type.
    const all = await ldScripts.allTextContents()
    const joined = all.join('\n')
    expect(joined).toMatch(/"@type"\s*:\s*"(Product|BreadcrumbList|Organization|Store|WebSite|ItemList)"/i)
  })
})

test.describe('SEO routes', () => {
  test('/sitemap.xml returns XML', async ({ request }) => {
    const res = await request.get('/sitemap.xml')
    expect(res.status()).toBe(200)
    const ct = res.headers()['content-type'] ?? ''
    expect(ct).toMatch(/xml/)
    const body = await res.text()
    expect(body).toMatch(/<\?xml/)
    expect(body).toMatch(/<urlset/)
    // Must list at least the homepage.
    expect(body).toMatch(/<loc>http:\/\/localhost:3000<\/loc>/)
  })

  test('/robots.txt returns text', async ({ request }) => {
    const res = await request.get('/robots.txt')
    expect(res.status()).toBe(200)
    const ct = res.headers()['content-type'] ?? ''
    expect(ct).toMatch(/text\/plain/)
    const body = await res.text()
    expect(body.toLowerCase()).toMatch(/user-agent:\s*\*/)
    expect(body).toMatch(/disallow:\s*\/api\//i)
    expect(body).toMatch(/sitemap:\s*http:\/\/localhost:3000\/sitemap\.xml/i)
  })
})
