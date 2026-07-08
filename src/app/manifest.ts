import type { MetadataRoute } from 'next'

// Manifest PWA nativo (Next App Router gera /manifest.webmanifest).
// PWA Fase A: instalavel no celular, abre no rebanho, tema Espresso.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PS Gestão',
    short_name: 'PS Gestão',
    description: 'ERP Inteligente — consulta do rebanho, inclusive offline',
    start_url: '/dashboard/agro/rebanho',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF7F2',
    theme_color: '#3D2314',
    icons: [
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
      { src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
  }
}
