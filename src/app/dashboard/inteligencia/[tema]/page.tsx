'use client'

// Detalhe de tema do BI (industrial e agro) — placeholder honesto (Pilar 3: NUNCA 404). As telas de
// detalhe são SPEC futuro; enquanto não existem, esta rota renderiza "em construção". Onde já há tela
// real (Produção/RH industrial), oferece o atalho. Área-aware no botão "voltar".
import { Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'

const TELA_ATUAL: Record<string, { rota: string; label: string }> = {
  producao: { rota: '/dashboard/industrial/producao', label: 'Abrir Produção (tela atual)' },
  rh: { rota: '/dashboard/industrial/producao?aba=gente', label: 'Abrir Gente (tela atual)' },
}

export default function InteligenciaTemaPage() {
  return (
    <Suspense fallback={<div style={{ background: BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando…</div>}>
      <TemaDetalhe />
    </Suspense>
  )
}

function TemaDetalhe() {
  const router = useRouter()
  const params = useParams<{ tema: string }>()
  const searchParams = useSearchParams()
  const tema = (params?.tema ?? '').toString()
  const area = searchParams.get('area') === 'agro' ? 'agro' : 'industrial'
  const atalho = TELA_ATUAL[tema]

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '28px 20px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button onClick={() => router.push(`/dashboard/inteligencia?area=${area}`)} style={{ background: 'transparent', border: 'none', color: MUT, fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16 }}>
          ← Análise de dados
        </button>

        <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 36 }}>🏗️</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, color: ESP, margin: '10px 0 6px', textTransform: 'capitalize' }}>
            {tema.replace(/[-_]/g, ' ') || 'Tema'}
          </h1>
          <p style={{ fontSize: 13, color: MUT, margin: 0, lineHeight: 1.5 }}>
            A análise detalhada deste tema está <b>em construção</b>. O hub já acende o card quando a fonte tem
            dado; a tela de detalhe entra na próxima fase.
          </p>

          {atalho && (
            <button onClick={() => router.push(atalho.rota)} style={{ marginTop: 18, background: GOLD, color: '#3D2314', border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {atalho.label} →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
