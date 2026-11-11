'use client'

// Caixa do grupo — "caixa do dia" (F1, só leitura). Item 5 (P2/Pdois, CEO 11/11).
// Genérico para qualquer grupo econômico (mesmo padrão do DRE consolidado, RD-26):
// resolve os CNPJs do grupo via fn_grupo_empresa e chama fn_fin_caixa_grupo_dia(p_company_ids, p_data).
// Para cada empresa e no total: saldo inicial (fim do dia anterior), entradas, saídas,
// saldo final; e detalhamento por conta bancária. RD-95 "?" em tudo; celular.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

const ROTA = '/dashboard/financeiro/caixa-grupo'

// Design system PS (mesma paleta do DRE consolidado) — RD-96.
const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.60)'
const GREEN = '#166534'
const RED = '#A32D2D'
const CARD = '#FFFFFF'

const brl = (n: number | null | undefined) =>
  (typeof n === 'number' ? n : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const corValor = (n: number) => (n < 0 ? RED : ESP)

type Conta = { conta_id: string | null; nome: string; banco: string | null; saldo_inicial: number; entradas: number; saidas: number; saldo_final: number }
type Empresa = { company_id: string; empresa_nome: string; cnpj: string | null; saldo_inicial: number; entradas: number; saidas: number; saldo_final: number; contas: Conta[] }
type Totais = { saldo_inicial: number; entradas: number; saidas: number; saldo_final: number }
type Resp = { ok: boolean; erro?: string; data: string; grupo: Totais; empresas: Empresa[] }

const hojeISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const addDias = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const dataLonga = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

export default function CaixaGrupoDia() {
  const { sel, companyIds, selInfo, loading: loadingSel } = useCompanyIds()
  const [membros, setMembros] = useState<string[]>([])
  const [grupoNome, setGrupoNome] = useState('')
  const [dia, setDia] = useState<string>(hojeISO())
  const [visao, setVisao] = useState<'consolidado' | 'cnpj'>('consolidado')
  const [resp, setResp] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Resolve o grupo da empresa selecionada (fonte única, genérica) — igual ao DRE consolidado.
  const empresaUnica = sel && sel !== 'consolidado' && !sel.startsWith('group_') ? sel : null
  useEffect(() => {
    let alive = true
    if (empresaUnica) {
      void supabase.rpc('fn_grupo_empresa', { p_company_id: empresaUnica }).then(({ data: g, error }) => {
        if (!alive) return
        const r = g as { ok?: boolean; grupo_nome?: string; company_ids?: string[] } | null
        if (error || !r?.ok) { setMembros([empresaUnica]); setGrupoNome(selInfo.nome); return }
        setMembros(r.company_ids ?? [empresaUnica]); setGrupoNome(r.grupo_nome ?? selInfo.nome)
      })
    } else {
      setMembros(companyIds); setGrupoNome(selInfo.nome)
    }
    return () => { alive = false }
  }, [empresaUnica, companyIds, selInfo.nome])

  const carregar = useCallback(async () => {
    if (!membros.length) { setResp(null); setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_fin_caixa_grupo_dia', { p_company_ids: membros, p_data: dia })
    const r = data as Resp | null
    if (error) { setErro(error.message); setResp(null) }
    else if (!r || r.ok === false) { setErro(r?.erro || 'Sem acesso'); setResp(null) }
    else setResp(r)
    setLoading(false)
  }, [membros, dia])

  useEffect(() => { void carregar() }, [carregar])

  const g = resp?.grupo
  const resumo = useMemo(() => {
    if (!g) return ''
    return `Entrou ${brl(g.entradas)}, saiu ${brl(g.saidas)} — caixa do grupo ${brl(g.saldo_final)}.`
  }, [g])

  // Contas consolidadas (todas as empresas juntas) para a visão consolidada.
  const contasConsolidadas: (Conta & { empresa_nome: string })[] = useMemo(() => {
    if (!resp) return []
    return resp.empresas.flatMap((e) => e.contas.map((c) => ({ ...c, empresa_nome: e.empresa_nome })))
  }, [resp])

  const semEmpresa = !membros.length && !loadingSel

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '20px 16px 48px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <h1 style={{ color: ESP, fontSize: 22, fontWeight: 800, margin: 0 }}>Caixa do grupo</h1>
          {grupoNome && <span style={{ color: MUT, fontSize: 14 }}>{grupoNome}</span>}
        </div>

        {/* Controles: dia + visão */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, margin: '14px 0 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button type="button" aria-label="Dia anterior" onClick={() => setDia((d) => addDias(d, -1))}
              style={btnNav}>‹</button>
            <input type="date" value={dia} onChange={(e) => setDia(e.target.value || hojeISO())}
              style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', color: ESP, background: CARD, fontSize: 14, fontWeight: 600 }} />
            <button type="button" aria-label="Próximo dia" onClick={() => setDia((d) => addDias(d, 1))}
              style={btnNav}>›</button>
            <button type="button" onClick={() => setDia(hojeISO())} style={{ ...btnNav, width: 'auto', padding: '0 12px', fontSize: 13, fontWeight: 700 }}>Hoje</button>
            <AjudaCampo chave="ge.caixa_grupo.data" rota={ROTA} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div role="tablist" aria-label="Visão" style={{ display: 'inline-flex', border: `1px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
              {(['consolidado', 'cnpj'] as const).map((v) => (
                <button key={v} type="button" role="tab" aria-selected={visao === v} onClick={() => setVisao(v)}
                  style={{ padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                    background: visao === v ? GOLD : CARD, color: ESP }}>
                  {v === 'consolidado' ? 'Consolidado' : 'Por CNPJ'}
                </button>
              ))}
            </div>
            <AjudaCampo chave="ge.caixa_grupo.visao" rota={ROTA} />
          </div>
        </div>

        <div style={{ color: MUT, fontSize: 13, marginBottom: 10, textTransform: 'capitalize' }}>{dataLonga(dia)}</div>

        {semEmpresa && <Aviso texto="Selecione uma empresa ou um grupo para ver o caixa do dia." />}
        {erro && <Aviso texto={erro} erro />}
        {loading && !resp && <Aviso texto="Carregando caixa do dia…" />}

        {resp && !loading && (
          <>
            {/* Resumo em texto */}
            <div style={{ background: '#F6EFE2', border: `1px solid ${LINE}`, borderRadius: 10, padding: '12px 16px', color: ESP, fontSize: 14, marginBottom: 16 }}>
              {resumo}
            </div>

            {/* Cards do grupo */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 22 }}>
              <Kpi rotulo="Saldo inicial" valor={g!.saldo_inicial} chave="ge.caixa_grupo.saldo_inicial" />
              <Kpi rotulo="Entradas do dia" valor={g!.entradas} chave="ge.caixa_grupo.entradas" cor={GREEN} prefixo="+" />
              <Kpi rotulo="Saídas do dia" valor={g!.saidas} chave="ge.caixa_grupo.saidas" cor={RED} prefixo="−" />
              <Kpi rotulo="Saldo final" valor={g!.saldo_final} chave="ge.caixa_grupo.saldo_final" destaque />
            </div>

            {visao === 'consolidado' ? (
              <Secao titulo="Contas do grupo">
                <TabelaContas linhas={contasConsolidadas.map((c) => ({ ...c, rotuloConta: `${c.banco ? c.banco + ' · ' : ''}${c.nome} · ${c.empresa_nome}` }))} />
              </Secao>
            ) : (
              resp.empresas.map((e) => (
                <Secao key={e.company_id} titulo={e.empresa_nome} subtitulo={e.cnpj || undefined}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
                    <MiniKpi rotulo="Saldo inicial" valor={e.saldo_inicial} />
                    <MiniKpi rotulo="Entradas" valor={e.entradas} cor={GREEN} />
                    <MiniKpi rotulo="Saídas" valor={e.saidas} cor={RED} />
                    <MiniKpi rotulo="Saldo final" valor={e.saldo_final} destaque />
                  </div>
                  <TabelaContas linhas={e.contas.map((c) => ({ ...c, rotuloConta: `${c.banco ? c.banco + ' · ' : ''}${c.nome}` }))} />
                </Secao>
              ))
            )}
          </>
        )}
      </div>
    </div>
  )
}

const btnNav: CSSProperties = {
  width: 36, height: 36, borderRadius: 8, border: `1px solid ${LINE}`, background: CARD,
  color: ESP, cursor: 'pointer', fontSize: 18, fontWeight: 700, lineHeight: 1,
}

function Aviso({ texto, erro }: { texto: string; erro?: boolean }) {
  return (
    <div style={{ background: erro ? '#FBECEC' : CARD, border: `1px solid ${erro ? '#E6C3C3' : LINE}`, borderRadius: 10, padding: '16px 18px', color: erro ? RED : MUT, fontSize: 14 }}>
      {texto}
    </div>
  )
}

function Kpi({ rotulo, valor, chave, cor, prefixo, destaque }: { rotulo: string; valor: number; chave: string; cor?: string; prefixo?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FBF3E2' : CARD, border: `1px solid ${destaque ? GOLD : LINE}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, color: MUT, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>
        {rotulo}<AjudaCampo chave={chave} rota={ROTA} />
      </div>
      <div style={{ color: cor || corValor(valor), fontSize: 20, fontWeight: 800 }}>
        {prefixo && valor !== 0 ? prefixo + ' ' : ''}{brl(valor)}
      </div>
    </div>
  )
}

function MiniKpi({ rotulo, valor, cor, destaque }: { rotulo: string; valor: number; cor?: string; destaque?: boolean }) {
  return (
    <div style={{ background: destaque ? '#FBF3E2' : BG, border: `1px solid ${destaque ? GOLD : LINE}`, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ color: MUT, fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>{rotulo}</div>
      <div style={{ color: cor || corValor(valor), fontSize: 16, fontWeight: 700 }}>{brl(valor)}</div>
    </div>
  )
}

function Secao({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <h2 style={{ color: ESP, fontSize: 16, fontWeight: 800, margin: 0 }}>{titulo}</h2>
        {subtitulo && <span style={{ color: MUT, fontSize: 12.5 }}>{subtitulo}</span>}
      </div>
      {children}
    </div>
  )
}

function TabelaContas({ linhas }: { linhas: (Conta & { rotuloConta: string })[] }) {
  if (!linhas.length) {
    return <Aviso texto="Nenhuma conta com movimento ou saldo neste dia." />
  }
  return (
    <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 12, background: CARD }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: 560 }}>
        <thead>
          <tr style={{ background: '#F6EFE2', color: ESP }}>
            <th style={th()}>Conta<AjudaCampo chave="ge.caixa_grupo.col.conta" rota={ROTA} /></th>
            <th style={th('right')}>Saldo inicial<AjudaCampo chave="ge.caixa_grupo.col.saldo_inicial" rota={ROTA} /></th>
            <th style={th('right')}>Entradas<AjudaCampo chave="ge.caixa_grupo.col.entradas" rota={ROTA} /></th>
            <th style={th('right')}>Saídas<AjudaCampo chave="ge.caixa_grupo.col.saidas" rota={ROTA} /></th>
            <th style={th('right')}>Saldo final<AjudaCampo chave="ge.caixa_grupo.col.saldo_final" rota={ROTA} /></th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((c, i) => (
            <tr key={(c.conta_id || 'sem') + '-' + i} style={{ borderTop: `1px solid ${LINE}` }}>
              <td style={td()}>{c.rotuloConta}</td>
              <td style={td('right', corValor(c.saldo_inicial))}>{brl(c.saldo_inicial)}</td>
              <td style={td('right', c.entradas ? GREEN : MUT)}>{brl(c.entradas)}</td>
              <td style={td('right', c.saidas ? RED : MUT)}>{brl(c.saidas)}</td>
              <td style={td('right', corValor(c.saldo_final), true)}>{brl(c.saldo_final)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const th = (align: 'left' | 'right' = 'left'): CSSProperties => ({
  textAlign: align, padding: '10px 12px', fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap',
})
const td = (align: 'left' | 'right' = 'left', cor: string = ESP, bold = false): CSSProperties => ({
  textAlign: align, padding: '10px 12px', color: cor, fontWeight: bold ? 700 : 500, whiteSpace: 'nowrap',
})
