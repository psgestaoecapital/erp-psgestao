'use client'

// Barra de abas das telas de RH da Indústria (CEO 25/11 — RH em 5 itens: cada item junta telas antigas em abas).
// A aba atual vive no ?aba= da URL, para o redirect da rota antiga cair direto na aba certa (link salvo não quebra).
// Design system PS premium (RD-96): tipografia legível, espaçamento generoso, estados claros. "?" por aba (RD-95).
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', BG = '#FAF7F2'

export type AbaRH = { chave: string; rotulo: string; ajuda?: string }

// Lê a aba atual do ?aba= (cai na primeira aba válida se vier vazio/desconhecido).
export function useAbaRH(abas: AbaRH[], padrao?: string): string {
  const sp = useSearchParams()
  const atual = sp.get('aba')
  if (atual && abas.some((a) => a.chave === atual)) return atual
  return padrao && abas.some((a) => a.chave === padrao) ? padrao : (abas[0]?.chave ?? '')
}

export function AbasRH({ abas, atual, rota }: { abas: AbaRH[]; atual: string; rota?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const irPara = (chave: string) => router.replace(`${pathname}?aba=${chave}`, { scroll: false })
  return (
    <nav role="tablist" aria-label="Seções" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: `1px solid ${LINE}`, marginBottom: 16 }}>
      {abas.map((a) => {
        const on = a.chave === atual
        return (
          <div key={a.chave} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <button role="tab" aria-selected={on} type="button" onClick={() => irPara(a.chave)}
              style={{
                appearance: 'none', cursor: 'pointer', background: on ? '#FFF' : 'transparent',
                border: `1px solid ${on ? LINE : 'transparent'}`, borderBottom: on ? `2px solid ${GOLD}` : '2px solid transparent',
                borderRadius: '10px 10px 0 0', padding: '9px 14px', fontSize: 13, fontWeight: on ? 700 : 600,
                color: on ? ESP : MUT, marginBottom: -1,
              }}>
              {a.rotulo}
            </button>
            {a.ajuda ? <AjudaCampo chave={a.ajuda} rota={rota} /> : null}
          </div>
        )
      })}
    </nav>
  )
}

export const CASCA_RH_BG = BG
