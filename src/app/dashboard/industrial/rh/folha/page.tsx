'use client'
// Indústria · RH · Folha (CEO 25/11 — "RH em 5 itens: cada item junta telas antigas em abas").
// Este é o item Folha; sua primeira aba é "Encargos" (padrões do empregador que alimentam o custo da hora).
// As demais abas da Folha entram nas próximas entregas. A aba vive no ?aba= (link salvo não quebra; o redirect
// da rota antiga cai direto na aba certa). Design PS premium (RD-96); "?" por aba (RD-95).
import { Suspense } from 'react'
import { AbasRH, useAbaRH, CASCA_RH_BG, type AbaRH } from '@/components/rh/AbasRH'
import { EncargosFolha } from '@/components/rh/EncargosFolha'

// A ajuda das abas é buscada por rota; a aba "Encargos" reusa a ajuda publicada da Mão de obra.
const AJUDA_ROTA = '/dashboard/projetos/mao-obra'
const ABAS: AbaRH[] = [
  { chave: 'encargos', rotulo: 'Encargos', ajuda: 'projetos.mao_obra.padrao.resumo' },
]

function FolhaConteudo() {
  const aba = useAbaRH(ABAS, 'encargos')
  return (
    <div style={{ background: CASCA_RH_BG, minHeight: '100%' }} className="px-4 sm:px-6 py-5">
      <header className="mb-4">
        <h1 className="text-[20px] font-semibold text-[#3D2314]">Folha</h1>
        <p className="text-[13px] text-[#3D2314]/60 mt-0.5">Encargos do empregador e padrões que alimentam o custo da hora.</p>
      </header>
      <AbasRH abas={ABAS} atual={aba} rota={AJUDA_ROTA} />
      {aba === 'encargos' && <EncargosFolha />}
    </div>
  )
}

export default function FolhaPage() {
  return (
    <Suspense fallback={<div style={{ background: CASCA_RH_BG, minHeight: '100vh', padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.55)', fontSize: 13 }}>Carregando…</div>}>
      <FolhaConteudo />
    </Suspense>
  )
}
