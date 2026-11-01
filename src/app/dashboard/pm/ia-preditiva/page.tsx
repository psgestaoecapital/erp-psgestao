'use client'
// IA PREDITIVA (P&M). Tira a tela do preview (RD-98 p1): antecipa problemas da operação a partir de DADO REAL (RD-38) —
// jobs atrasados / em risco de atraso (prazo × ritmo), horas estouradas, margem em risco e sobrecarga de equipe.
// Cada previsão abre o registro real (job / painel da pessoa). Leitura pura (fn_pm_previsoes). "?" (RD-95) em cada
// indicador/filtro/ação. Escopo por company_id. Tema Espresso (RD-99). Code: code-desenvolvedor-3.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const YELLOW = '#7A5A0F'; const RED = '#7A1F1F'

type Previsao = { categoria: 'atraso' | 'horas' | 'margem' | 'sobrecarga'; severidade: 'alto' | 'medio'; titulo: string; detalhe: string; ref_tipo: string; ref_id: string; rota: string }
type Resposta = { ok: boolean; gerado_em?: string; resumo: { total: number; alto: number; medio: number }; previsoes: Previsao[] }

const CATS: { v: Previsao['categoria'] | 'todas'; l: string; ajuda?: string }[] = [
  { v: 'todas', l: 'Todas' },
  { v: 'atraso', l: 'Atraso', ajuda: 'pm.ia_preditiva.atraso' },
  { v: 'horas', l: 'Horas', ajuda: 'pm.ia_preditiva.horas' },
  { v: 'margem', l: 'Margem', ajuda: 'pm.ia_preditiva.margem' },
  { v: 'sobrecarga', l: 'Sobrecarga', ajuda: 'pm.ia_preditiva.sobrecarga' },
]
const AJUDA_CAT: Record<Previsao['categoria'], string> = {
  atraso: 'pm.ia_preditiva.atraso', horas: 'pm.ia_preditiva.horas', margem: 'pm.ia_preditiva.margem', sobrecarga: 'pm.ia_preditiva.sobrecarga',
}
const EMOJI: Record<Previsao['categoria'], string> = { atraso: '⏰', horas: '⏱️', margem: '📉', sobrecarga: '👥' }

export default function IaPreditivaPage() {
  const router = useRouter()
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [resp, setResp] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Previsao['categoria'] | 'todas'>('todas')

  const carregar = useCallback(async () => {
    if (!empresa) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_pm_previsoes', { p_company_id: empresa })
    if (error) { setErro(error.message); setResp(null) } else { setResp(data as Resposta) }
    setLoading(false)
  }, [empresa])

  useEffect(() => { void carregar() }, [carregar])

  const lista = useMemo(() => (resp?.previsoes ?? []).filter((p) => filtro === 'todas' || p.categoria === filtro), [resp, filtro])

  const abrir = useCallback((p: Previsao) => {
    const chave = p.ref_tipo === 'pessoa' ? 'pessoa' : 'job'
    router.push(`${p.rota}?${chave}=${p.ref_id}`)
  }, [router])

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🔮 P&amp;M · Produção</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0', display: 'inline-flex', alignItems: 'center' }}>Previsões<AjudaCampo chave="pm.ia_preditiva.tela" /></h1>
          <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Alertas ANTES do problema: atraso, horas estouradas, margem em risco e sobrecarga — do dado real dos jobs. Clique para abrir o registro.</p>
        </header>

        {/* Resumo */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px,1fr))', gap: 10, marginBottom: 12 }}>
          <Kpi l="Previsões" v={String(resp?.resumo.total ?? 0)} ajuda="pm.ia_preditiva.resumo" testid="iapred-total" />
          <Kpi l="Severidade alta" v={String(resp?.resumo.alto ?? 0)} cor={RED} ajuda="pm.ia_preditiva.severidade" testid="iapred-alto" />
          <Kpi l="Severidade média" v={String(resp?.resumo.medio ?? 0)} cor={YELLOW} ajuda="pm.ia_preditiva.severidade" testid="iapred-medio" />
        </div>

        {/* Filtro por tipo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: TEXTM, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>Filtrar por tipo<AjudaCampo chave="pm.ia_preditiva.filtro" /></span>
          {CATS.map((c) => (
            <button key={c.v} type="button" onClick={() => setFiltro(c.v)} data-testid={`iapred-filtro-${c.v}`} aria-pressed={filtro === c.v}
              style={{ border: `1px solid ${filtro === c.v ? ESPRESSO : BORDA}`, background: filtro === c.v ? ESPRESSO : '#fff', color: filtro === c.v ? '#fff' : ESPRESSO, borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', minHeight: 36 }}>
              {c.l}
            </button>
          ))}
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Analisando os jobs…</div>
          : erro ? <div style={{ padding: 20, color: RED, background: '#fff', border: `1px solid ${RED}`, borderRadius: 12 }}>Não foi possível gerar as previsões: {erro}</div>
          : lista.length === 0 ? (
            <div data-testid="iapred-vazio" style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              {resp && resp.resumo.total > 0 ? 'Nenhuma previsão deste tipo.' : 'Nenhum risco previsto agora — operação no ritmo. (Confira se os jobs têm prazo e horas estimadas.)'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {lista.map((p, i) => {
                const cor = p.severidade === 'alto' ? RED : YELLOW
                return (
                  <div key={`${p.ref_id}-${i}`} data-testid={`iapred-item-${p.categoria}`}
                    style={{ background: '#fff', border: `1px solid ${BORDA}`, borderLeft: `4px solid ${cor}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 22, lineHeight: '26px' }} aria-hidden>{EMOJI[p.categoria]}</div>
                    <div style={{ flex: '1 1 260px', minWidth: 220 }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>{p.titulo}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', color: '#fff', background: cor, borderRadius: 999, padding: '2px 8px' }}>{p.severidade}</span>
                        <AjudaCampo chave={AJUDA_CAT[p.categoria]} />
                      </div>
                      <div style={{ fontSize: 13, color: TEXTM, marginTop: 3 }}>{p.detalhe}</div>
                    </div>
                    <button type="button" onClick={() => abrir(p)} data-testid={`iapred-abrir-${p.ref_id}`}
                      style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: `1px solid ${ESPRESSO}`, color: ESPRESSO, borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer', minHeight: 38, alignSelf: 'center' }}>
                      Abrir →<AjudaCampo chave="pm.ia_preditiva.abrir" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
      </div>
    </div>
  )
}

function Kpi({ l, v, cor, ajuda, testid }: { l: string; v: string; cor?: string; ajuda?: string; testid?: string }) {
  return <div data-testid={testid} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700, display: 'inline-flex', alignItems: 'center' }}>{l}{ajuda && <AjudaCampo chave={ajuda} />}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: cor ?? ESPRESSO, marginTop: 2 }}>{v}</div>
  </div>
}
