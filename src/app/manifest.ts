import type { MetadataRoute } from 'next'

// Manifest PWA nativo (Next App Router gera /manifest.webmanifest).
// start_url NEUTRO (CEO 12/11): /app decide o destino pelo papel/área do usuário
// (vendedor/comercial → painel de vendas; Agro → rebanho; demais → início da área;
// sem login → /login e volta pro destino). Antes era fixo no rebanho, então um
// vendedor que instalasse abria no Agro.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'PS Gestão',
    short_name: 'PS Gestão',
    description: 'ERP Inteligente — seu painel de vendas, o rebanho e a gestão no celular, inclusive offline',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF7F2',
    theme_color: '#3D2314',
    icons: [
      // 192 e 512 (any + maskable) para o Android oferecer "Instalar app".
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
      { src: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
    ],
  }
}
