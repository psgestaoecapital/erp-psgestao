'use client'

// LGPD (incidente 0e8add26): o bucket system-screenshots é PRIVADO. As telas guardam o PATH da foto
// (nunca URL pública). Este componente gera uma URL ASSINADA na hora (PS_ADMIN via RLS de storage) para
// exibir. Valor legado (URL http antiga) não abre mais no bucket privado → "imagem indisponível".
// Nunca deixa um quadro quebrado (onError também cai para indisponível).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const BUCKET = 'system-screenshots'

export default function ScreenshotAssinado({
  valor, alt, style, fallbackStyle, fallbackTexto = 'Imagem indisponível',
}: {
  valor: string
  alt: string
  style?: React.CSSProperties
  fallbackStyle?: React.CSSProperties
  fallbackTexto?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [falhou, setFalhou] = useState(false)

  useEffect(() => {
    let vivo = true
    void (async () => {
      if (/^https?:\/\//i.test(valor)) { if (vivo) setFalhou(true); return } // legado: URL pública → não abre no bucket privado
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(valor, 600)
      if (!vivo) return
      if (error || !data?.signedUrl) setFalhou(true)
      else setUrl(data.signedUrl)
    })()
    return () => { vivo = false }
  }, [valor])

  const fb: React.CSSProperties = fallbackStyle ?? {
    width: '100%', padding: '24px 16px', textAlign: 'center', color: '#9C8E80',
    background: '#F0ECE3', borderRadius: 8, fontSize: 12,
  }
  if (falhou) return <div style={fb}>{fallbackTexto}</div>
  if (!url) return <div style={{ ...fb, color: '#9C8E80' }}>Carregando imagem…</div>
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} loading="lazy" onError={() => setFalhou(true)}
      style={style ?? { width: '100%', maxHeight: 420, objectFit: 'contain', background: '#FFFFFF', borderRadius: 8 }} />
  )
}
