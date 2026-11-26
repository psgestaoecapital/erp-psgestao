// src/app/dashboard/industrial/rh/bi/page.tsx
// Indústria · RH — "Painel de RH" (CEO 25/11, RH em 5 itens). Reúne em ABAS o que antes eram 2 itens de menu:
//   Painel (BI de RH) · Lotação e remuneração variável.
// A aba vive no ?aba= da URL, para o redirect da rota antiga (/inteligencia/rh) cair direto na aba certa.
// RD-26: reusa os componentes existentes. RD-95: "?" por aba. RD-30: nada apagado — a rota antiga redireciona.
'use client'
import { Suspense } from 'react'
import { AbasRH, useAbaRH, CASCA_RH_BG, type AbaRH } from '@/components/rh/AbasRH'
import { BiRhView } from '@/components/rh/BiRhView'
// Aba "Lotação e remuneração variável" reúsa a tela viva de /inteligencia/rh (RD-26; padrão de reuso de page
// já usado no repo, ex.: industrial/logistica/frota). A rota /inteligencia/rh segue viva (link salvo não quebra).
import RhHubPage from '@/app/dashboard/inteligencia/rh/page'

const ROTA = '/dashboard/industrial/rh/bi'
const ABAS: AbaRH[] = [
  { chave: 'painel', rotulo: 'Painel', ajuda: 'industrial.rh.painel.aba.painel' },
  { chave: 'lotacao', rotulo: 'Lotação e remuneração variável', ajuda: 'industrial.rh.painel.aba.lotacao' },
]

function PainelRhInner() {
  const aba = useAbaRH(ABAS, 'painel')
  return (
    <div style={{ background: CASCA_RH_BG, minHeight: '100vh' }}>
      <div style={{ padding: '16px clamp(14px, 4vw, 40px) 0' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <AbasRH abas={ABAS} atual={aba} rota={ROTA} />
        </div>
      </div>
      {aba === 'painel' && <BiRhView />}
      {aba === 'lotacao' && <RhHubPage />}
    </div>
  )
}

export default function BiRhPage() {
  return (
    <Suspense fallback={null}>
      <PainelRhInner />
    </Suspense>
  )
}
