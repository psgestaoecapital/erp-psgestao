// src/app/os/[token]/page.tsx
// Rota PÚBLICA (sem auth) — o cliente abre pelo link wa.me e aprova o diagnóstico item a item (DVI).
// Middleware (src/middleware.ts) só protege /api/dev/*, então /os/* é público.
//
// SEGURANÇA (decisão do CEO · Pilar 2 / LGPD):
//  - a foto vem de bucket PRIVADO → a URL é assinada AQUI NO SERVIDOR com service role (supabaseAdmin);
//    o service role NUNCA vai pro browser. TTL 1h; se o cliente voltar depois, a página recarrega e reassina.
//  - noindex/nofollow (o Google não pode indexar orçamento de cliente).
//  - token inválido/expirado/revogado → página NEUTRA; NUNCA revela se a OS existe (impede varredura).
//  - fn_os_publico_obter devolve só o necessário (sem CPF/telefone/endereço/histórico).
import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import DviPublico, { type ItemPub, type FotoPub } from './DviPublico'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Orçamento da oficina', robots: { index: false, follow: false } }

const BUCKET = 'oficina-recepcao'
const ESP = '#3D2314', BG = '#FAF7F2', ESP60 = 'rgba(61,35,20,0.55)'

type ObterResp = {
  ok?: boolean
  oficina?: string
  os?: { numero?: string | null; placa?: string | null; marca?: string | null; modelo?: string | null; km?: number | null }
  itens?: ItemPub[]
  fotos?: { item_id: string | null; foto_path: string; anotacao?: unknown }[]
}

function Neutra() {
  return (
    <div style={{ minHeight: '100vh', background: BG, color: ESP, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔧</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '10px 0 6px' }}>Este link não está mais disponível</h1>
        <p style={{ fontSize: 14, color: ESP60, lineHeight: 1.5 }}>
          O link do orçamento expirou ou foi encerrado. Peça um novo à oficina — é rápido.
        </p>
      </div>
    </div>
  )
}

export default async function OsPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 16) return <Neutra />

  const { data } = await supabaseAdmin.rpc('fn_os_publico_obter', { p_token: token })
  const d = (data ?? null) as ObterResp | null
  if (!d?.ok) return <Neutra />   // inválido/expirado/revogado → neutro (nunca revela existência)

  // assina cada foto no SERVIDOR (service role nunca vai pro browser)
  const fotos: FotoPub[] = await Promise.all(
    (d.fotos ?? []).map(async (f) => {
      const { data: s } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(f.foto_path, 3600)
      return { item_id: f.item_id, url: s?.signedUrl ?? null }
    }),
  )

  return (
    <DviPublico
      oficina={d.oficina ?? 'Oficina'}
      os={d.os ?? {}}
      itens={d.itens ?? []}
      fotos={fotos}
      token={token}
    />
  )
}
