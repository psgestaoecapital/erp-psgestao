// src/app/dashboard/industrial/rh/pessoas/page.tsx
// Indústria · RH — "Pessoas" (CEO 25/11, RH em 5 itens). Esta tela reúne em ABAS o que antes eram itens de menu:
//   Cadastro (ficha de custo, MaoObraTela) · Quadro de pessoal.
// "Custo da mão de obra" saiu daqui (ajuste do Eng. Chefe 25/11): virou a aba "Custo por setor e cargo" do
// Painel de RH (/dashboard/industrial/rh/bi?aba=custo), como o CEO decidiu. A rota antiga redireciona pra lá.
// A aba vive no ?aba= da URL, para o redirect da rota antiga (/rh/quadro) cair direto na aba certa.
// RD-26: reusa os componentes existentes. RD-95: "?" por aba. RD-30: nada apagado — as rotas antigas redirecionam.
'use client'
import { Suspense } from 'react'
import { AbasRH, useAbaRH, CASCA_RH_BG, type AbaRH } from '@/components/rh/AbasRH'
import { MaoObraTela } from '@/components/maoObra/MaoObraTela'
import { QuadroPessoalView } from '@/components/rh/QuadroPessoalView'

const ROTA = '/dashboard/industrial/rh/pessoas'
const ABAS: AbaRH[] = [
  { chave: 'cadastro', rotulo: 'Cadastro', ajuda: 'industrial.rh.pessoas.aba.cadastro' },
  { chave: 'quadro', rotulo: 'Quadro de pessoal', ajuda: 'industrial.rh.pessoas.aba.quadro' },
]

function PessoasInner() {
  const aba = useAbaRH(ABAS, 'cadastro')
  return (
    <div style={{ background: CASCA_RH_BG, minHeight: '100vh' }}>
      <div style={{ padding: '16px clamp(14px, 4vw, 40px) 0' }}>
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          <AbasRH abas={ABAS} atual={aba} rota={ROTA} />
        </div>
      </div>
      {aba === 'cadastro' && <MaoObraTela contexto="industria" />}
      {aba === 'quadro' && <QuadroPessoalView />}
    </div>
  )
}

export default function IndustriaRhPessoasPage() {
  return (
    <Suspense fallback={null}>
      <PessoasInner />
    </Suspense>
  )
}
