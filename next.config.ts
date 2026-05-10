import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // playwright-core + chromium-min sao binarios nativos —
  // nao podem ser bundlados pelo Turbopack (PR M.A.7.5.2)
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium-min'],
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
}

export default nextConfig
