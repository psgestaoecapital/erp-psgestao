// src/app/veiculo/[token]/page.tsx
// Rota PÚBLICA (sem auth) — o cliente abre pelo link wa.me e vê o HISTÓRICO do seu veículo.
// Espelha /os/[token] (Onda 2). Middleware (src/middleware.ts) só protege /api/dev/*, então /veiculo/* é público.
//
// SEGURANÇA (decisão do CEO · Pilar 2 / LGPD):
//  - foto vem de bucket PRIVADO → URL assinada AQUI NO SERVIDOR com service role (supabaseAdmin); TTL 1h.
//    O service role NUNCA vai pro browser. Se o cliente voltar depois, a página recarrega e reassina.
//  - noindex/nofollow.
//  - token inválido/expirado/revogado → página NEUTRA; NUNCA revela se o veículo existe.
//  - 🔒 SEM VALORES: fn_veiculo_publico_obter não devolve preço/valor. Só o que foi feito, quando, com quanto km.
import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import VeiculoPublico, { type VisitaPub } from './VeiculoPublico'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Histórico do veículo', robots: { index: false, follow: false } }

const BUCKET = 'oficina-recepcao'
const ESP = '#3D2314', BG = '#FAF7F2', ESP60 = 'rgba(61,35,20,0.55)'

type FotoRaw = { foto_path: string; anotacao?: unknown }
type VisitaRaw = { data: string | null; km: number | null; servicos: string[] | null; defeito: string | null; fotos: FotoRaw[] | null }
type ObterResp = {
  ok?: boolean
  oficina?: string
  veiculo?: { placa?: string | null; marca?: string | null; modelo?: string | null; ano?: number | null; ultimo_km?: number | null }
  visitas?: VisitaRaw[]
}

function Neutra() {
  return (
    <div style={{ minHeight: '100vh', background: BG, color: ESP, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>🔧</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: '10px 0 6px' }}>Este link não está mais disponível</h1>
        <p style={{ fontSize: 14, color: ESP60, lineHeight: 1.5 }}>
          O link do histórico expirou ou foi encerrado. Peça um novo à oficina — é rápido.
        </p>
      </div>
    </div>
  )
}

export default async function VeiculoPublicoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token || token.length < 16) return <Neutra />

  const { data } = await supabaseAdmin.rpc('fn_veiculo_publico_obter', { p_token: token })
  const d = (data ?? null) as ObterResp | null
  if (!d?.ok) return <Neutra />   // inválido/expirado/revogado → neutro (nunca revela existência)

  // assina cada foto no SERVIDOR (service role nunca vai pro browser)
  const visitas: VisitaPub[] = await Promise.all(
    (d.visitas ?? []).map(async (v) => {
      const fotos = await Promise.all(
        (v.fotos ?? []).map(async (f) => {
          const { data: s } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(f.foto_path, 3600)
          return { url: s?.signedUrl ?? null, anotacao: typeof f.anotacao === 'string' ? f.anotacao : null }
        }),
      )
      return {
        data: v.data,
        km: v.km,
        servicos: Array.isArray(v.servicos) ? v.servicos : [],
        defeito: v.defeito ?? null,
        fotos: fotos.filter((x) => x.url),
      }
    }),
  )

  return <VeiculoPublico oficina={d.oficina ?? 'Oficina'} veiculo={d.veiculo ?? {}} visitas={visitas} />
}
