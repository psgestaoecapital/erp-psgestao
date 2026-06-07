import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // playwright-core + chromium-min sao binarios nativos —
  // nao podem ser bundlados pelo Turbopack (PR M.A.7.5.2)
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium-min'],
  // FIX 28/05: @vercel/nft nao detecta browsers.json (leitura dinamica do
  // playwright-core registry) · forcar inclusao no deployment das rotas Playwright.
  // Sem isso: "Cannot find module .../playwright-core/browsers.json" no boot.
  outputFileTracingIncludes: {
    '/api/screen-watcher/playwright': ['./node_modules/playwright-core/**/*'],
    '/api/gold/auditar-rota': ['./node_modules/playwright-core/**/*'],
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      ],
    }]
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
  poweredByHeader: false,
  compress: true,
  // FIX-NAV-COMMERCE-EM-GE-v1 · redirects 308 permanentes pras rotas canonicas
  // Next.js redirects() preserva query string automaticamente.
  async redirects() {
    return [
      {
        source: '/dashboard/compras',
        destination: '/dashboard/commerce/compras',
        permanent: true,
      },
      {
        source: '/dashboard/estoque',
        destination: '/dashboard/commerce/estoque',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
