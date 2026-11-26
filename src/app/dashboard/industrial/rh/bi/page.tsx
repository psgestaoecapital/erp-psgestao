// src/app/dashboard/industrial/rh/bi/page.tsx
// Indústria · RH — "Painel de RH" (CEO 25/11, RH em 5 itens). Reúne em ABAS o que antes eram itens de menu:
//   Painel (BI de RH) · Lotação e remuneração variável · Custo por setor e cargo.
// "Custo por setor e cargo" veio da tela Pessoas (ajuste do Eng. Chefe 25/11): o CEO colocou o custo da mão
// de obra no Painel de RH. A rota antiga /dashboard/industrial/mao-obra redireciona pra ?aba=custo.
// A aba vive no ?aba= da URL, para o redirect da rota antiga (/inteligencia/rh, /mao-obra) cair na aba certa.
// RD-26: reusa os componentes existentes. RD-95: "?" por aba. RD-30: nada apagado — a rota antiga redireciona.
'use client'
import { Suspense } from 'react'
import { AbasRH, useAbaRH, CASCA_RH_BG, type AbaRH } from '@/components/rh/AbasRH'
import { BiRhView } from '@/components/rh/BiRhView'
import { MaoObraCustoView } from '@/components/rh/MaoObraCustoView'
// Aba "Lotação e remuneração variável": a View foi extraída de /inteligencia/rh (ajuste do Eng. Chefe 25/11,
// como as outras abas) para RhHubView; a rota /inteligencia/rh agora redireciona pra ?aba=lotacao (RD-30).
import { RhHubView } from '@/components/rh/RhHubView'

const ROTA = '/dashboard/industrial/rh/bi'
const ABAS: AbaRH[] = [
  { chave: 'painel', rotulo: 'Painel', ajuda: 'industrial.rh.painel.aba.painel' },
  { chave: 'lotacao', rotulo: 'Lotação e remuneração variável', ajuda: 'industrial.rh.painel.aba.lotacao' },
  { chave: 'custo', rotulo: 'Custo por setor e cargo', ajuda: 'industrial.rh.painel.aba.custo' },
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
      {aba === 'lotacao' && <RhHubView />}
      {aba === 'custo' && <MaoObraCustoView />}
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
