'use client'

// HB1 · Resultado por obra (fatia 2) — lê v_obra_resultado (receita serviço + material, custo material + viagens,
// previsto × realizado). Só leitura. 3 estados: erro / vazio (ensina) / dados. Linha "Consolidado" no fim. Excel (CSV) e PDF (impressão do navegador).
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { fmtR, fmtPct as fmtPctBase } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', VERM = '#B91C1C'

type Linha = {
  obra_id: string; numero: string; nome: string; status: string
  custo_previsto: number; receita_prevista: number; receita_servico: number; receita_material: number
  custo_material: number; custo_viagens: number; margem_realizada: number
  custo_mao_obra?: number; custo_rateio?: number; margem_alocada?: number
  faturado?: number
}

// Drilldown por item de escopo (fn_obra_escopo): orçamento → contrato → medição → custo, item a item.
type EscopoItem = {
  id: string; ordem: number; descricao: string; unidade: string | null
  quantidade_contratada: number; quantidade_medida: number; pct_medido: number
  preco_unitario: number; valor_contratado: number; valor_medido: number; custo_unitario_previsto: number
}
type EscopoResp = {
  ok: boolean; erro?: string; itens?: EscopoItem[]; total_itens?: number
  valor_contratado?: number; valor_medido?: number; valor_a_medir?: number; custo_previsto?: number; pct_fisico?: number
}
type EstadoEscopo = { loading: boolean; erro: string; dados: EscopoResp | null }

const n = (v: unknown) => Number(v ?? 0)
// Receita realizada: medição + material da view; se a view ainda não tem nada, usa o faturado (NFS-e autorizada, fn_obras_receita).
const receita = (l: Linha) => (n(l.receita_servico) + n(l.receita_material)) || n(l.faturado)
const custo = (l: Linha) => n(l.custo_material) + n(l.custo_viagens) + n(l.custo_mao_obra) + n(l.custo_rateio)
// Sem receita não há margem: mostrar -custo como prejuízo seria alarme falso (falta lançar a medição, não estouro de custo).
const semMedicao = (l: Linha) => receita(l) <= 0
const margem = (l: Linha) => (semMedicao(l) ? 0 : receita(l) - custo(l))
const pctPrevisto = (l: Linha) => (n(l.receita_prevista) > 0 ? Math.min(100, (receita(l) / n(l.receita_prevista)) * 100) : null)
// Margem % sobre a receita realizada. Sem receita ainda → null (mostra "—"), para não dividir por zero.
// Sem receita a margem % não existe: "N/A" ("—" parece dado que falhou ao carregar).
const fmtPct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? 'N/A' : fmtPctBase(v))
const margemPct = (rec: number, marg: number) => (rec > 0 ? (marg / rec) * 100 : null)
// Situação pela margem % (alerta de desvio, PDCA gap #10): saudável ≥ 10%, baixa 0–10%, negativa < 0.
// Sem medição não classifica (cinza), para não virar alarme falso de prejuízo.
const AMBAR = '#B45309'
const situacaoObra = (l: Linha): { rot: string; cor: string } => {
  if (semMedicao(l)) return { rot: 'Sem medição', cor: MUT }
  const p = margemPct(receita(l), margem(l))
  if (p == null || p < 0) return { rot: 'Margem negativa', cor: VERM }
  return p < 10 ? { rot: 'Margem baixa', cor: AMBAR } : { rot: 'Margem saudável', cor: VERDE }
}
// Mesmo critério de situacaoObra, mas como chave estável para contar/filtrar (alerta de desvio de margem).
const bucketMargem = (l: Linha): 'saudavel' | 'baixa' | 'negativa' | 'sem' => {
  if (semMedicao(l)) return 'sem'
  const p = margemPct(receita(l), margem(l))
  if (p == null || p < 0) return 'negativa'
  return p < 10 ? 'baixa' : 'saudavel'
}
const POR_PAGINA = 20
const cockpit = (obraId: string) => `/dashboard/projetos/obras/${obraId}/cockpit`

export default function ResultadoObrasPage() {
  const { companyIds } = useCompanyIds()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState('')
  const [sitFiltro, setSitFiltro] = useState<'' | 'saudavel' | 'baixa' | 'negativa' | 'sem'>('')
  const [pagina, setPagina] = useState(0)
  // Drilldown por item de escopo: quais obras estão abertas e o escopo já carregado (lazy, só ao expandir).
  const [aberta, setAberta] = useState<Set<string>>(new Set())
  const [escopo, setEscopo] = useState<Record<string, EstadoEscopo>>({})

  const alternarItens = useCallback(async (obraId: string) => {
    const abrindo = !aberta.has(obraId)
    setAberta(prev => { const s = new Set(prev); if (abrindo) s.add(obraId); else s.delete(obraId); return s })
    if (!abrindo || escopo[obraId]?.dados || escopo[obraId]?.loading) return
    setEscopo(prev => ({ ...prev, [obraId]: { loading: true, erro: '', dados: null } }))
    try {
      const r = await supabase.rpc('fn_obra_escopo', { p_obra_id: obraId })
      if (r.error) { setEscopo(prev => ({ ...prev, [obraId]: { loading: false, erro: r.error!.message, dados: null } })); return }
      const dados = (r.data ?? null) as EscopoResp | null
      setEscopo(prev => ({ ...prev, [obraId]: { loading: false, erro: dados && dados.ok === false ? (dados.erro ?? 'sem_acesso') : '', dados } }))
    } catch { setEscopo(prev => ({ ...prev, [obraId]: { loading: false, erro: MSG_CARREGAMENTO_FALHOU, dados: null } })) }
  }, [aberta, escopo])

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      // Fonte única do custo por obra: v_obra_resultado_alocado (#2687). Sem ela (ainda não publicada), cai para a v_obra_resultado.
      const ler = (view: string) => comPrazo(
        async () => await supabase.from(view).select('*').in('company_id', companyIds).order('numero', { ascending: false }),
        { ms: 8000, tentativas: 1, label: view },
      )
      let r = await ler('v_obra_resultado_alocado')
      if (r.error) r = await ler('v_obra_resultado')
      if (r.error) { setErro(r.error.message); return }
      const base = (r.data ?? []) as Linha[]
      // Faturado por obra (não bloqueia a tela se falhar).
      const fat = await supabase.rpc('fn_obras_receita', { p_company_ids: companyIds })
      const mapa = new Map<string, number>(((fat.data ?? []) as { obra_id: string; faturado: number }[]).map(x => [x.obra_id, n(x.faturado)]))
      setLinhas(base.map(l => ({ ...l, faturado: mapa.get(l.obra_id) ?? 0 })))
    } catch { setErro(MSG_CARREGAMENTO_FALHOU) } finally { setLoading(false) }
  }, [companyIds])
  useEffect(() => { carregar() }, [carregar])

  const statusLista = useMemo(() => Array.from(new Set(linhas.map(l => l.status).filter(Boolean))).sort(), [linhas])
  // filtradas = busca + situação da obra (status). O resumo e os alertas no topo somam SEMPRE sobre essas, para dar
  // o panorama estável da seleção; o chip de margem (sitFiltro) só afunila a lista/consolidado logo abaixo.
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return linhas.filter(l => (!status || l.status === status) && (!q || `${l.numero} ${l.nome}`.toLowerCase().includes(q)))
  }, [linhas, busca, status])
  const visiveis = useMemo(() => (sitFiltro ? filtradas.filter(l => bucketMargem(l) === sitFiltro) : filtradas), [filtradas, sitFiltro])
  // Paginação da lista (20 por página): o Consolidado soma SEMPRE todas as obras do filtro, não só a página.
  const totalPaginas = Math.max(1, Math.ceil(visiveis.length / POR_PAGINA))
  const paginaAtual = Math.min(pagina, totalPaginas - 1)
  const daPagina = useMemo(() => visiveis.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA), [visiveis, paginaAtual])
  const semReceitaComCusto = filtradas.filter(l => semMedicao(l) && custo(l) > 0).length

  // Resumo consolidado do topo (sobre filtradas, independe do chip de margem).
  const resumo = useMemo(() => filtradas.reduce((a, l) => ({
    receita: a.receita + receita(l), custo: a.custo + custo(l), margem: a.margem + margem(l),
    prevista: a.prevista + n(l.receita_prevista), custoPrev: a.custoPrev + n(l.custo_previsto),
  }), { receita: 0, custo: 0, margem: 0, prevista: 0, custoPrev: 0 }), [filtradas])
  // Contagem por situação de margem (alerta de desvio): quantas obras saudáveis / baixa / negativa / sem medição.
  const contagem = useMemo(() => filtradas.reduce((a, l) => { a[bucketMargem(l)] += 1; return a },
    { saudavel: 0, baixa: 0, negativa: 0, sem: 0 } as Record<'saudavel' | 'baixa' | 'negativa' | 'sem', number>), [filtradas])
  const avancoReceita = resumo.prevista > 0 ? Math.min(100, (resumo.receita / resumo.prevista) * 100) : null
  const avancoCusto = resumo.custoPrev > 0 ? (resumo.custo / resumo.custoPrev) * 100 : null

  const total = useMemo(() => visiveis.reduce((a, l) => ({
    receita: a.receita + receita(l), custo: a.custo + custo(l), margem: a.margem + margem(l),
    prevista: a.prevista + n(l.receita_prevista), custoPrev: a.custoPrev + n(l.custo_previsto),
  }), { receita: 0, custo: 0, margem: 0, prevista: 0, custoPrev: 0 }), [visiveis])

  const baixarCsv = () => {
    const cab = ['Obra', 'Nome', 'Receita serviço', 'Receita material', 'Custo material', 'Custo viagens', 'Mão de obra', 'Custo fixo rateado', 'Situação', 'Margem', 'Margem %', 'Receita prevista', 'Custo previsto']
    const rows = visiveis.map(l => { const p = margemPct(receita(l), margem(l)); return [l.numero, l.nome, l.receita_servico, l.receita_material, l.custo_material, l.custo_viagens, n(l.custo_mao_obra), n(l.custo_rateio), situacaoObra(l).rot, margem(l), p === null ? '' : p.toFixed(1), l.receita_prevista, l.custo_previsto] })
    const csv = [cab, ...rows].map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'resultado-por-obra.csv'; a.click()
  }

  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 12, color: MUT, fontWeight: 600, whiteSpace: 'nowrap' }
  const fixa: React.CSSProperties = { position: 'sticky', left: 0, background: '#fff', zIndex: 1 }
  const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, whiteSpace: 'nowrap' }
  const cor = (v: number) => (v < 0 ? VERM : VERDE)

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: 16, color: ESP }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Link href="/dashboard/projetos/obras" style={{ color: GOLD, fontSize: 13 }}>← Obras</Link>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px' }}>Resultado por obra</h1>
        <p style={{ fontSize: 13, color: MUT, margin: '0 0 12px' }}>Receita (serviço medido + material vendido) menos custo (material, viagens e mão de obra apontada), previsto × realizado.</p>
        {loading && <p data-testid="resultado-carregando">Carregando…</p>}
        {!loading && erro && <p role="alert" style={{ color: VERM }}>{erro} <button onClick={carregar}>Tentar de novo</button></p>}
        {!loading && !erro && linhas.length === 0 && (
          <p data-testid="resultado-vazio">Nenhuma obra ainda. A obra nasce do orçamento aprovado; assim que houver medição, venda de material ou viagem, o resultado aparece aqui.</p>
        )}
        {!loading && !erro && linhas.length > 0 && (
          <>
            {/* Resumo consolidado + alerta de desvio de margem (PDCA aud8 · profundidade HB1). Soma sobre o filtro de busca/situação. */}
            <div data-testid="resultado-resumo" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
              <Kpi rotulo="Receita realizada" chave="projetos.resultado_obra.kpi_receita" valor={fmtR(resumo.receita)} />
              <Kpi rotulo="Custo realizado" chave="projetos.resultado_obra.kpi_custo" valor={fmtR(resumo.custo)} />
              <Kpi rotulo="Margem consolidada" chave="projetos.resultado_obra.kpi_margem" valor={fmtR(resumo.margem)}
                sub={fmtPct(margemPct(resumo.receita, resumo.margem))} subCor={resumo.margem < 0 ? VERM : VERDE} destaque />
              <Kpi rotulo="Avanço financeiro" chave="projetos.resultado_obra.kpi_avanco"
                valor={avancoReceita == null ? 'N/A' : `Receita ${avancoReceita.toFixed(0)}%`}
                sub={avancoCusto == null ? 'Custo N/A' : `Custo ${avancoCusto.toFixed(0)}%`}
                subCor={avancoCusto != null && avancoReceita != null && avancoCusto > avancoReceita ? AMBAR : MUT} />
            </div>
            <div data-testid="resultado-alerta-situacao" className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: MUT, display: 'flex', alignItems: 'center', gap: 2 }}>Situação das obras <AjudaCampo chave="projetos.resultado_obra.alerta_situacao" /></span>
              {([
                { k: 'saudavel', rot: 'Margem saudável', cor: VERDE, nn: contagem.saudavel },
                { k: 'baixa', rot: 'Margem baixa', cor: AMBAR, nn: contagem.baixa },
                { k: 'negativa', rot: 'Margem negativa', cor: VERM, nn: contagem.negativa },
                { k: 'sem', rot: 'Sem medição', cor: MUT, nn: contagem.sem },
              ] as const).map(c => {
                const ativo = sitFiltro === c.k
                return (
                  <button key={c.k} data-testid={`resultado-chip-${c.k}`} disabled={c.nn === 0}
                    onClick={() => { setSitFiltro(ativo ? '' : c.k); setPagina(0) }}
                    aria-pressed={ativo} title={c.nn === 0 ? 'Nenhuma obra nesta situação' : `Ver obras com ${c.rot.toLowerCase()}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, cursor: c.nn === 0 ? 'default' : 'pointer',
                      border: `1px solid ${ativo ? c.cor : LINE}`, background: ativo ? `${c.cor}14` : '#fff', opacity: c.nn === 0 ? 0.45 : 1, fontSize: 12.5, color: ESP }}>
                    <span style={{ width: 8, height: 8, borderRadius: 999, background: c.cor, display: 'inline-block' }} />
                    <strong style={{ fontWeight: 700 }}>{c.nn}</strong> {c.rot}
                  </button>
                )
              })}
              {sitFiltro && <button data-testid="resultado-chip-limpar" onClick={() => { setSitFiltro(''); setPagina(0) }} style={{ border: 'none', background: 'none', color: GOLD, fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>Limpar filtro de situação</button>}
            </div>
            <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <input data-testid="resultado-busca" value={busca} onChange={e => { setBusca(e.target.value); setPagina(0) }} placeholder="Buscar obra por número ou nome" aria-label="Buscar obra" style={{ padding: '6px 10px', border: `1px solid ${LINE}`, borderRadius: 8, minWidth: 220 }} />
              <AjudaCampo chave="projetos.resultado_obra.busca" />
              <select data-testid="resultado-status" value={status} onChange={e => { setStatus(e.target.value); setPagina(0) }} aria-label="Filtrar por situação da obra" style={{ padding: '6px 10px', border: `1px solid ${LINE}`, borderRadius: 8 }}>
                <option value="">Todas as situações</option>
                {statusLista.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <AjudaCampo chave="projetos.resultado_obra.filtro_status" />
            </div>
            {semReceitaComCusto > 0 && (
              <p data-testid="resultado-aviso-sem-receita" style={{ fontSize: 12.5, color: VERM, margin: '0 0 8px' }}>
                {semReceitaComCusto} obra(s) com custo e ainda sem receita: lance a medição ou a venda de material para a margem aparecer.
              </p>
            )}
            {visiveis.length === 0 && <p data-testid="resultado-filtro-vazio" style={{ fontSize: 13, color: MUT }}>Nenhuma obra com esse filtro. Limpe a busca ou escolha “Todas as situações”.</p>}
            <div className="no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button onClick={baixarCsv} style={{ padding: '6px 12px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8 }}>Baixar Excel (CSV)</button>
              <AjudaCampo chave="projetos.resultado_obra.excel" />
              <button data-testid="resultado-pdf" onClick={() => window.print()} style={{ padding: '6px 12px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8 }}>Baixar PDF</button>
              <AjudaCampo chave="projetos.resultado_obra.pdf" />
            </div>
            <style>{'@media print{.no-print{display:none!important}body{background:#fff}}'}</style>
            {totalPaginas > 1 && (
              <div className="no-print" data-testid="resultado-paginacao" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, fontSize: 13 }}>
                <button disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)} style={{ padding: '6px 12px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8, opacity: paginaAtual === 0 ? 0.5 : 1 }}>Anterior</button>
                <span>Página {paginaAtual + 1} de {totalPaginas} · {visiveis.length} obras</span>
                <button disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPagina(paginaAtual + 1)} style={{ padding: '6px 12px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8, opacity: paginaAtual >= totalPaginas - 1 ? 0.5 : 1 }}>Próxima</button>
                <AjudaCampo chave="projetos.resultado_obra.paginacao" />
              </div>
            )}
            {/* celular (< md): um cartão por obra + o consolidado, sem rolagem lateral (HB0 · correção 9). A impressão usa a tabela. */}
            <div className="md:hidden no-print" data-testid="resultado-cartoes" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {daPagina.map(l => (
                <div key={l.obra_id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <CartaoObra obraId={l.obra_id} titulo={`${l.numero} · ${l.nome}`} receita={receita(l)} custo={custo(l)} material={n(l.custo_material)} viagens={n(l.custo_viagens)} maoObra={n(l.custo_mao_obra)} rateio={n(l.custo_rateio)}
                    margem={margem(l)} prevista={n(l.receita_prevista)} custoPrev={n(l.custo_previsto)} sem={semMedicao(l)} pct={pctPrevisto(l)} sit={situacaoObra(l)}
                    aberto={aberta.has(l.obra_id)} onVerItens={() => alternarItens(l.obra_id)} />
                  {aberta.has(l.obra_id) && <DrilldownEscopo mobile estado={escopo[l.obra_id]} onRecarregar={() => alternarItens(l.obra_id)} />}
                </div>
              ))}
              <CartaoObra destaque titulo="Consolidado" receita={total.receita} custo={total.custo} material={visiveis.reduce((a, l) => a + n(l.custo_material), 0)} viagens={visiveis.reduce((a, l) => a + n(l.custo_viagens), 0)} maoObra={visiveis.reduce((a, l) => a + n(l.custo_mao_obra), 0)} rateio={visiveis.reduce((a, l) => a + n(l.custo_rateio), 0)}
                margem={total.margem} prevista={total.prevista} custoPrev={total.custoPrev} />
            </div>
            <style>{'@media print{.resultado-tabela-wrap{display:block!important}}'}</style>
            <div className="hidden md:block resultado-tabela-wrap" style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12 }}>
              <table data-testid="resultado-tabela" style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}>
                  <th style={{ ...th, ...fixa, textAlign: 'left' }}>Obra</th><th style={th}>Receita <AjudaCampo chave="projetos.resultado_obra.receita" /></th><th style={th}>Custo <AjudaCampo chave="projetos.resultado_obra.custo" /></th>
                  <th style={th}>Materiais <AjudaCampo chave="projetos.resultado_obra.custo_material" /></th><th style={th}>Viagens <AjudaCampo chave="projetos.resultado_obra.custo_viagens" /></th>
                  <th style={th}>Mão de obra <AjudaCampo chave="projetos.resultado_obra.mao_obra" /></th><th style={th}>Custo fixo rateado <AjudaCampo chave="projetos.resultado_obra.custo_rateio" /></th><th style={th}>Situação <AjudaCampo chave="projetos.resultado_obra.situacao" /></th><th style={th}>Margem <AjudaCampo chave="projetos.resultado_obra.margem" /></th><th style={th}>Margem % <AjudaCampo chave="projetos.resultado_obra.margem_pct" /></th><th style={th}>Receita prevista <AjudaCampo chave="projetos.resultado_obra.receita_prevista" /></th><th style={th}>Custo previsto <AjudaCampo chave="projetos.resultado_obra.custo_previsto" /></th>
                </tr></thead>
                <tbody>
                  {daPagina.map(l => {
                    const open = aberta.has(l.obra_id)
                    return (
                    <Fragment key={l.obra_id}>
                    <tr style={{ borderBottom: `1px solid ${LINE}` }}>
                      <td style={{ ...td, ...fixa, textAlign: 'left' }}>
                        <button data-testid="resultado-ver-itens" onClick={() => alternarItens(l.obra_id)} aria-expanded={open} title={open ? 'Ocultar itens do escopo' : 'Ver itens do escopo'}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: GOLD, fontSize: 12, padding: '0 6px 0 0', lineHeight: 1 }}>{open ? '▾' : '▸'}</button>
                        <Link href={cockpit(l.obra_id)} style={{ color: GOLD, textDecoration: 'none' }} title="Abrir o cockpit da obra">{l.numero} · {l.nome}</Link>
                      </td>
                      <td style={td}>{fmtR(receita(l))}</td><td style={td}>{fmtR(custo(l))}</td>
                      <td style={td}>{fmtR(n(l.custo_material))}</td><td style={td}>{fmtR(n(l.custo_viagens))}</td>
                      <td style={td}>{fmtR(n(l.custo_mao_obra))}</td><td style={td}>{fmtR(n(l.custo_rateio))}</td>
                      <td data-testid="resultado-situacao" style={{ ...td, color: situacaoObra(l).cor, fontWeight: 600 }}>{situacaoObra(l).rot}</td>
                      {semMedicao(l)
                        ? <td colSpan={2} data-testid="resultado-sem-medicao" style={{ ...td, color: MUT, fontSize: 12 }}>Sem medição ainda — margem indisponível</td>
                        : <><td style={{ ...td, color: cor(margem(l)), fontWeight: 600 }}>{fmtR(margem(l))}</td>
                          <td style={{ ...td, color: cor(margem(l)) }}>{fmtPct(margemPct(receita(l), margem(l)))}</td></>}
                      <td style={td}>{fmtR(n(l.receita_prevista))}<Barra pct={pctPrevisto(l)} /></td><td style={td}>{fmtR(n(l.custo_previsto))}</td>
                    </tr>
                    {open && (
                      <tr data-testid="resultado-itens-linha">
                        <td colSpan={12} style={{ padding: 0, background: '#FBF9F5', borderBottom: `1px solid ${LINE}` }}>
                          <DrilldownEscopo estado={escopo[l.obra_id]} onRecarregar={() => alternarItens(l.obra_id)} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    )
                  })}
                  <tr data-testid="resultado-consolidado" style={{ fontWeight: 700 }}>
                    <td style={{ ...td, ...fixa, textAlign: 'left' }}>Consolidado</td>
                    <td style={td}>{fmtR(total.receita)}</td><td style={td}>{fmtR(total.custo)}</td>
                    <td style={td}>{fmtR(visiveis.reduce((a, l) => a + n(l.custo_material), 0))}</td><td style={td}>{fmtR(visiveis.reduce((a, l) => a + n(l.custo_viagens), 0))}</td>
                    <td style={td}>{fmtR(visiveis.reduce((a, l) => a + n(l.custo_mao_obra), 0))}</td>
                    <td style={td}>{fmtR(visiveis.reduce((a, l) => a + n(l.custo_rateio), 0))}</td><td style={td} />
                    <td style={{ ...td, color: cor(total.margem) }}>{fmtR(total.margem)}</td>
                    <td style={{ ...td, color: cor(total.margem) }}>{fmtPct(margemPct(total.receita, total.margem))}</td>
                    <td style={td}>{fmtR(total.prevista)}</td><td style={td}>{fmtR(total.custoPrev)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Cartão da obra no celular: margem em destaque (verde/vermelho), realizado × previsto em pares. O "?" de cada
// número fica no cartão Consolidado (mesmas chaves da tabela), para não repetir em cada obra.
function CartaoObra({ obraId, titulo, receita, custo, material, viagens, maoObra, rateio, margem, prevista, custoPrev, destaque, sem, pct: pctPrev, sit, aberto, onVerItens }: {
  obraId?: string; titulo: string; receita: number; custo: number; material: number; viagens: number; maoObra: number; rateio: number; margem: number; prevista: number; custoPrev: number; destaque?: boolean; sem?: boolean; pct?: number | null; sit?: { rot: string; cor: string }; aberto?: boolean; onVerItens?: () => void
}) {
  const pct = margemPct(receita, margem)
  const par = (rot: string, v: number, chave?: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 2 }}>{rot}{destaque && chave && <AjudaCampo chave={chave} />}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{fmtR(v)}</div>
    </div>
  )
  return (
    <div data-testid={destaque ? 'resultado-cartao-consolidado' : 'resultado-cartao'} style={{ background: '#fff', border: `1px solid ${destaque ? GOLD : LINE}`, borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        {obraId
          ? <Link href={cockpit(obraId)} style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflowWrap: 'anywhere', color: GOLD, textDecoration: 'none' }} title="Abrir o cockpit da obra">{titulo}</Link>
          : <span style={{ fontWeight: 700, fontSize: 14, minWidth: 0, overflowWrap: 'anywhere' }}>{titulo}</span>}
        {sem ? <span style={{ fontSize: 12, color: MUT }}>sem medição</span> : <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap', color: margem < 0 ? VERM : VERDE }}>{fmtR(margem)}</span>}
      </div>
      <div style={{ fontSize: 11, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>margem{destaque && <AjudaCampo chave="projetos.resultado_obra.margem" />}</span>
        <span style={{ color: sem ? MUT : margem < 0 ? VERM : VERDE }}>· {sem ? 'margem indisponível' : fmtPct(pct)}</span>
        {destaque && <AjudaCampo chave="projetos.resultado_obra.margem_pct" />}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginTop: 10 }}>
        {par('Receita', receita, 'projetos.resultado_obra.receita')}{par('Custo', custo, 'projetos.resultado_obra.custo')}
        {par('Materiais', material, 'projetos.resultado_obra.custo_material')}{par('Viagens', viagens, 'projetos.resultado_obra.custo_viagens')}
        {par('Mão de obra', maoObra, 'projetos.resultado_obra.mao_obra')}{par('Custo fixo rateado', rateio, 'projetos.resultado_obra.custo_rateio')}
        {par('Receita prevista', prevista, 'projetos.resultado_obra.receita_prevista')}{par('Custo previsto', custoPrev, 'projetos.resultado_obra.custo_previsto')}
      </div>
      {sit && <div data-testid="resultado-situacao-cartao" style={{ fontSize: 12, fontWeight: 600, color: sit.cor, marginTop: 8 }}>{sit.rot}</div>}
      {pctPrev != null && <Barra pct={pctPrev} />}
      {obraId && onVerItens && (
        <button data-testid="resultado-ver-itens-cartao" onClick={onVerItens} aria-expanded={!!aberto}
          style={{ marginTop: 10, width: '100%', padding: '8px 10px', border: `1px solid ${LINE}`, background: '#fff', borderRadius: 8, color: GOLD, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          {aberto ? '▾ Ocultar itens do escopo' : '▸ Ver itens do escopo'}
        </button>
      )}
    </div>
  )
}

// Drilldown por item de escopo da obra (fn_obra_escopo): contrato → medição → custo, item a item.
// Sem nova tela (RD-99): abre embaixo da linha/cartão. Só leitura.
const fmtQ = (v: number) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(n(v))
function DrilldownEscopo({ estado, onRecarregar, mobile }: { estado?: EstadoEscopo; onRecarregar: () => void; mobile?: boolean }) {
  const pad = mobile ? 10 : 14
  if (!estado || estado.loading) return <div data-testid="resultado-itens-carregando" style={{ padding: pad, fontSize: 13, color: MUT }}>Carregando itens do escopo…</div>
  if (estado.erro) return (
    <div data-testid="resultado-itens-erro" role="alert" style={{ padding: pad, fontSize: 13, color: VERM }}>
      Não deu para carregar os itens.{' '}
      <button onClick={onRecarregar} style={{ color: GOLD, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Tentar de novo</button>
    </div>
  )
  const d = estado.dados
  const itens = d?.itens ?? []
  const titulo = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>
      Itens do escopo <AjudaCampo chave="projetos.resultado_obra.itens" />
      <span style={{ fontWeight: 400, color: MUT }}>· contrato → medição → custo</span>
    </div>
  )
  if (!itens.length) return (
    <div data-testid="resultado-itens-vazio" style={{ padding: pad }}>
      {titulo}
      <p style={{ fontSize: 13, color: MUT, margin: 0 }}>Esta obra ainda não tem itens de escopo contratados. Os itens nascem do orçamento aprovado que gera a obra.</p>
    </div>
  )
  // celular: lista empilhada (sem rolagem lateral — HB0 correção 9).
  if (mobile) return (
    <div data-testid="resultado-itens-lista" style={{ background: '#FBF9F5', border: `1px solid ${LINE}`, borderRadius: 12, padding: pad }}>
      {titulo}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: MUT, flexWrap: 'wrap', marginBottom: 6 }}>
        <AjudaCampo chave="projetos.resultado_obra.item_qtd_contratada" /><AjudaCampo chave="projetos.resultado_obra.item_qtd_medida" />
        <AjudaCampo chave="projetos.resultado_obra.item_pct_medido" /><AjudaCampo chave="projetos.resultado_obra.item_preco_unit" />
        <AjudaCampo chave="projetos.resultado_obra.item_valor_contratado" /><AjudaCampo chave="projetos.resultado_obra.item_valor_medido" />
        <AjudaCampo chave="projetos.resultado_obra.item_custo_previsto" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {itens.map(it => (
          <div key={it.id} style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{it.descricao || 'Item'} {it.unidade ? <span style={{ color: MUT, fontWeight: 400 }}>({it.unidade})</span> : null}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginTop: 8, fontSize: 12.5 }}>
              <div><span style={{ color: MUT }}>Contratada</span><div>{fmtQ(it.quantidade_contratada)}</div></div>
              <div><span style={{ color: MUT }}>Medida</span><div>{fmtQ(it.quantidade_medida)} <span style={{ color: n(it.pct_medido) >= 100 ? VERDE : MUT }}>({fmtQ(it.pct_medido)}%)</span></div></div>
              <div><span style={{ color: MUT }}>Preço unit.</span><div>{fmtR(it.preco_unitario)}</div></div>
              <div><span style={{ color: MUT }}>Contratado</span><div>{fmtR(it.valor_contratado)}</div></div>
              <div><span style={{ color: MUT }}>Medido</span><div style={{ fontWeight: 600 }}>{fmtR(it.valor_medido)}</div></div>
              <div><span style={{ color: MUT }}>Custo previsto</span><div>{fmtR(n(it.quantidade_contratada) * n(it.custo_unitario_previsto))}</div></div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>Total medido: {fmtR(n(d?.valor_medido))} de {fmtR(n(d?.valor_contratado))} contratados · {fmtQ(n(d?.pct_fisico))}% físico</div>
    </div>
  )
  // desktop: tabela compacta.
  const sth: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11.5, color: MUT, fontWeight: 600, whiteSpace: 'nowrap' }
  const std: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 12.5, whiteSpace: 'nowrap' }
  return (
    <div style={{ padding: 14 }}>
      {titulo}
      <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10 }}>
        <table data-testid="resultado-itens-tabela" style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse' }}>
          <thead><tr style={{ borderBottom: `1px solid ${LINE}` }}>
            <th style={{ ...sth, textAlign: 'left' }}>Item</th>
            <th style={{ ...sth, textAlign: 'left' }}>Un.</th>
            <th style={sth}>Qtd contratada <AjudaCampo chave="projetos.resultado_obra.item_qtd_contratada" /></th>
            <th style={sth}>Qtd medida <AjudaCampo chave="projetos.resultado_obra.item_qtd_medida" /></th>
            <th style={sth}>% medido <AjudaCampo chave="projetos.resultado_obra.item_pct_medido" /></th>
            <th style={sth}>Preço unit. <AjudaCampo chave="projetos.resultado_obra.item_preco_unit" /></th>
            <th style={sth}>Valor contratado <AjudaCampo chave="projetos.resultado_obra.item_valor_contratado" /></th>
            <th style={sth}>Valor medido <AjudaCampo chave="projetos.resultado_obra.item_valor_medido" /></th>
            <th style={sth}>Custo previsto <AjudaCampo chave="projetos.resultado_obra.item_custo_previsto" /></th>
          </tr></thead>
          <tbody>
            {itens.map(it => (
              <tr key={it.id} style={{ borderBottom: `1px solid ${LINE}` }}>
                <td style={{ ...std, textAlign: 'left', whiteSpace: 'normal' }}>{it.descricao || 'Item'}</td>
                <td style={{ ...std, textAlign: 'left' }}>{it.unidade || '—'}</td>
                <td style={std}>{fmtQ(it.quantidade_contratada)}</td>
                <td style={std}>{fmtQ(it.quantidade_medida)}</td>
                <td style={{ ...std, color: n(it.pct_medido) >= 100 ? VERDE : ESP }}>{fmtQ(it.pct_medido)}%</td>
                <td style={std}>{fmtR(it.preco_unitario)}</td>
                <td style={std}>{fmtR(it.valor_contratado)}</td>
                <td style={{ ...std, fontWeight: 600 }}>{fmtR(it.valor_medido)}</td>
                <td style={std}>{fmtR(n(it.quantidade_contratada) * n(it.custo_unitario_previsto))}</td>
              </tr>
            ))}
            <tr data-testid="resultado-itens-total" style={{ fontWeight: 700 }}>
              <td style={{ ...std, textAlign: 'left' }} colSpan={6}>Total ({d?.total_itens ?? itens.length} {(d?.total_itens ?? itens.length) === 1 ? 'item' : 'itens'}) · {fmtQ(n(d?.pct_fisico))}% físico</td>
              <td style={std}>{fmtR(n(d?.valor_contratado))}</td>
              <td style={std}>{fmtR(n(d?.valor_medido))}</td>
              <td style={std}>{fmtR(n(d?.custo_previsto))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Cartão de KPI do resumo consolidado (topo). Rótulo + "?" (RD-95), valor em destaque e um sub opcional (margem % / avanço).
function Kpi({ rotulo, chave, valor, sub, subCor, destaque }: { rotulo: string; chave: string; valor: string; sub?: string; subCor?: string; destaque?: boolean }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${destaque ? GOLD : LINE}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11.5, color: MUT, display: 'flex', alignItems: 'center', gap: 2 }}>{rotulo} <AjudaCampo chave={chave} /></div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, overflowWrap: 'anywhere' }}>{valor}</div>
      {sub != null && <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 2, color: subCor ?? MUT }}>{sub}</div>}
    </div>
  )
}

// Realizado × previsto da receita: barra fina (0–100%).
function Barra({ pct }: { pct: number | null }) {
  if (pct == null) return null
  return (
    <div title={`Realizado: ${pct.toFixed(0)}% do previsto`} data-testid="resultado-barra" style={{ height: 4, background: LINE, borderRadius: 2, marginTop: 4 }}>
      <div style={{ width: `${pct}%`, height: 4, background: GOLD, borderRadius: 2 }} />
    </div>
  )
}
