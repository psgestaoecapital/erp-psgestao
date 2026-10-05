'use client'
// RELATÓRIO DE DOCUMENTOS (P&M, PM-K). Documentos comerciais da agência: propostas/orçamentos e contratos de fee.
// Valores do DOCUMENTO vêm da P&M; o realizado financeiro (faturado/recebido) é LIDO do GE (erp_receber), só leitura:
// esta tela nunca lança nem altera financeiro. 25 colunas configuráveis, separadas para TELA e PDF (máx. 11 no PDF).
// Preferências por usuário ficam no navegador. Tema Espresso.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { exportarExcel, exportarPDF, type Coluna } from '@/lib/export/relatorioLista'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'; const BORDA = '#E7DED3'; const TEXTM = '#6b5444'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const dataBR = (iso: string | null | undefined) => { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
const inp: CSSProperties = { padding: '8px 10px', fontSize: 13, border: `1px solid ${BORDA}`, borderRadius: 8, background: '#fff', color: ESPRESSO, outline: 'none' }
const MAX_PDF = 11
const LS_KEY = 'pm_relatorio_documentos_cols_v1'

type Linha = {
  id: string; tipo: 'Proposta' | 'Contrato de fee'; numero: string; cliente: string; titulo: string; situacao: string
  emissao: string | null; inicio: string | null; fim: string | null; aprovacao: string | null; vencimentoDia: number | null
  responsavel: string; condicao: string; parcelas: number | null; periodicidade: string; origem: string; observacao: string
  valorDoc: number; desconto: number; valorFaturar: number
  clientePagaAgencia: number; comissaoVendas: number; ganhoLiquido: number; ganhoPct: number
  faturado: number; recebido: number; saldoReceber: number; veiculacoes: number
}
type Col = { key: keyof Linha; header: string; tipo: 'texto' | 'moeda' | 'data' | 'numero'; tela: boolean; pdf: boolean }

const COLS: Col[] = [
  { key: 'tipo', header: 'Tipo', tipo: 'texto', tela: true, pdf: true },
  { key: 'numero', header: 'Número', tipo: 'texto', tela: true, pdf: true },
  { key: 'cliente', header: 'Cliente', tipo: 'texto', tela: true, pdf: true },
  { key: 'titulo', header: 'Título / objeto', tipo: 'texto', tela: true, pdf: false },
  { key: 'situacao', header: 'Situação', tipo: 'texto', tela: true, pdf: true },
  { key: 'emissao', header: 'Emissão', tipo: 'data', tela: true, pdf: true },
  { key: 'inicio', header: 'Início', tipo: 'data', tela: false, pdf: false },
  { key: 'fim', header: 'Fim', tipo: 'data', tela: false, pdf: false },
  { key: 'aprovacao', header: 'Aprovação', tipo: 'data', tela: false, pdf: false },
  { key: 'vencimentoDia', header: 'Dia de vencimento', tipo: 'numero', tela: false, pdf: false },
  { key: 'responsavel', header: 'Responsável', tipo: 'texto', tela: false, pdf: false },
  { key: 'condicao', header: 'Condição de pagamento', tipo: 'texto', tela: false, pdf: false },
  { key: 'parcelas', header: 'Parcelas', tipo: 'numero', tela: false, pdf: false },
  { key: 'periodicidade', header: 'Periodicidade', tipo: 'texto', tela: false, pdf: false },
  { key: 'valorDoc', header: 'Valor do documento', tipo: 'moeda', tela: true, pdf: true },
  { key: 'desconto', header: 'Desconto', tipo: 'moeda', tela: false, pdf: false },
  { key: 'valorFaturar', header: 'Valor a faturar', tipo: 'moeda', tela: true, pdf: true },
  { key: 'clientePagaAgencia', header: 'Cliente paga à agência', tipo: 'moeda', tela: true, pdf: true },
  { key: 'comissaoVendas', header: 'Comissão de vendas', tipo: 'moeda', tela: true, pdf: true },
  { key: 'ganhoLiquido', header: 'Ganho líquido', tipo: 'moeda', tela: true, pdf: true },
  { key: 'ganhoPct', header: 'Ganho %', tipo: 'numero', tela: false, pdf: false },
  { key: 'faturado', header: 'Faturado (GE)', tipo: 'moeda', tela: true, pdf: false },
  { key: 'recebido', header: 'Recebido (GE)', tipo: 'moeda', tela: false, pdf: false },
  { key: 'saldoReceber', header: 'Saldo a receber (GE)', tipo: 'moeda', tela: false, pdf: false },
  { key: 'origem', header: 'Origem', tipo: 'texto', tela: false, pdf: false },
]

type Pref = Record<string, { tela: boolean; pdf: boolean }>
const prefInicial = (): Pref => Object.fromEntries(COLS.map((c) => [c.key, { tela: c.tela, pdf: c.pdf }]))
const num = (v: unknown) => Number(v ?? 0) || 0

export default function RelatorioDocumentosPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true); const [erro, setErro] = useState<string | null>(null)
  const [pref, setPref] = useState<Pref>(prefInicial)
  const [config, setConfig] = useState(false)
  const [fTipo, setFTipo] = useState(''); const [fCliente, setFCliente] = useState(''); const [fSit, setFSit] = useState('')
  const [fDe, setFDe] = useState(''); const [fAte, setFAte] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s) setPref({ ...prefInicial(), ...(JSON.parse(s) as Pref) }) } catch { /* sem storage: usa o padrão */ }
  }, [])
  const salvarPref = (p: Pref) => { setPref(p); try { localStorage.setItem(LS_KEY, JSON.stringify(p)) } catch { /* ignora */ } }

  useEffect(() => {
    if (!empresa) { setLoading(false); return }
    let vivo = true
    ;(async () => {
      setLoading(true); setErro(null)
      const [p, c, cl, rec, com] = await Promise.all([
        supabase.from('agency_propostas').select('id, numero, titulo, cliente_id, status, valor_total, desconto, valor_final, condicao_pagamento, data_aprovacao, created_at, contrato_id')
          .eq('company_id', empresa).is('deleted_at', null).order('created_at', { ascending: false }).limit(1000),
        supabase.from('erp_contratos').select('id, numero, cliente_nome, nome, objeto, status, valor_atual, valor_mensal, data_inicio, data_fim, dia_vencimento, periodicidade, condicao_pagamento, numero_parcelas, total_faturado, origem, created_at, responsavel, proposta_id')
          .eq('company_id', empresa).is('excluido_em', null).order('created_at', { ascending: false }).limit(1000),
        supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa),
        supabase.from('erp_receber').select('contrato_id, valor, valor_pago').eq('company_id', empresa).not('contrato_id', 'is', null).is('deleted_at', null).limit(20000),
        supabase.from('agency_comissao').select('proposta_id, valor_comissao').eq('company_id', empresa).limit(5000),
      ])
      if (!vivo) return
      const falha = [p, c, cl, rec, com].find((r) => r.error)
      if (falha?.error) { setErro(falha.error.message); setLoading(false); return }
      const nomeCli = new Map((cl.data ?? []).map((x: { id: string; nome: string; nome_fantasia: string | null }) => [x.id, x.nome_fantasia || x.nome]))
      const fat = new Map<string, { f: number; r: number }>()
      for (const r of (rec.data ?? []) as { contrato_id: string; valor: number; valor_pago: number }[]) {
        const a = fat.get(r.contrato_id) ?? { f: 0, r: 0 }; a.f += num(r.valor); a.r += num(r.valor_pago); fat.set(r.contrato_id, a)
      }
      const comPorProposta = new Map<string, number>()
      for (const x of (com.data ?? []) as { proposta_id: string | null; valor_comissao: number }[]) {
        if (x.proposta_id) comPorProposta.set(x.proposta_id, (comPorProposta.get(x.proposta_id) ?? 0) + num(x.valor_comissao))
      }
      const out: Linha[] = []
      const propostasComContrato = new Set<string>()
      for (const k of (c.data ?? []) as { proposta_id: string | null }[]) if (k.proposta_id) propostasComContrato.add(k.proposta_id)
      for (const k of (c.data ?? []) as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const g = fat.get(k.id) ?? { f: num(k.total_faturado), r: 0 }
        const valor = num(k.valor_atual) || num(k.valor_mensal)
        const comissao = k.proposta_id ? (comPorProposta.get(k.proposta_id) ?? 0) : 0
        out.push({
          id: k.id, tipo: 'Contrato de fee', numero: k.numero ?? '', cliente: k.cliente_nome ?? '', titulo: k.objeto || k.nome || '',
          situacao: k.status ?? '', emissao: k.created_at, inicio: k.data_inicio, fim: k.data_fim, aprovacao: null,
          vencimentoDia: k.dia_vencimento, responsavel: k.responsavel ?? '', condicao: k.condicao_pagamento ?? '', parcelas: k.numero_parcelas,
          periodicidade: k.periodicidade ?? '', origem: k.origem ?? '', observacao: '',
          valorDoc: valor, desconto: 0, valorFaturar: valor, clientePagaAgencia: valor, comissaoVendas: comissao, ganhoLiquido: valor - comissao,
          ganhoPct: valor ? ((valor - comissao) / valor) * 100 : 0, faturado: g.f, recebido: g.r, saldoReceber: Math.max(g.f - g.r, 0), veiculacoes: 0,
        })
      }
      for (const k of (p.data ?? []) as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (propostasComContrato.has(k.id)) continue // já aparece como contrato de fee (evita contar duas vezes)
        const valor = num(k.valor_final) || num(k.valor_total)
        const comissao = comPorProposta.get(k.id) ?? 0
        out.push({
          id: k.id, tipo: 'Proposta', numero: k.numero ?? '', cliente: nomeCli.get(k.cliente_id) ?? '', titulo: k.titulo ?? '',
          situacao: k.status ?? '', emissao: k.created_at, inicio: null, fim: null, aprovacao: k.data_aprovacao,
          vencimentoDia: null, responsavel: '', condicao: k.condicao_pagamento ?? '', parcelas: null, periodicidade: '', origem: 'proposta', observacao: '',
          valorDoc: valor, desconto: num(k.desconto), valorFaturar: valor, clientePagaAgencia: valor, comissaoVendas: comissao, ganhoLiquido: valor - comissao,
          ganhoPct: valor ? ((valor - comissao) / valor) * 100 : 0, faturado: 0, recebido: 0, saldoReceber: 0, veiculacoes: 0,
        })
      }
      setLinhas(out); setLoading(false)
    })()
    return () => { vivo = false }
  }, [empresa])

  const situacoes = useMemo(() => Array.from(new Set(linhas.map((l) => l.situacao).filter(Boolean))).sort(), [linhas])
  const filtradas = useMemo(() => linhas.filter((l) =>
    (!fTipo || l.tipo === fTipo) && (!fSit || l.situacao === fSit) &&
    (!fCliente || l.cliente.toLowerCase().includes(fCliente.toLowerCase())) &&
    (!fDe || (l.emissao ?? '').slice(0, 10) >= fDe) && (!fAte || (l.emissao ?? '').slice(0, 10) <= fAte)), [linhas, fTipo, fSit, fCliente, fDe, fAte])

  const tot = useMemo(() => filtradas.reduce((a, l) => ({
    valor: a.valor + l.valorDoc, faturar: a.faturar + l.valorFaturar, com: a.com + l.comissaoVendas, ganho: a.ganho + l.ganhoLiquido, fat: a.fat + l.faturado, rec: a.rec + l.recebido,
  }), { valor: 0, faturar: 0, com: 0, ganho: 0, fat: 0, rec: 0 }), [filtradas])
  const ganhoMedio = filtradas.length ? tot.ganho / filtradas.length : 0

  const colsTela = COLS.filter((c) => pref[c.key]?.tela)
  const colsPdf = COLS.filter((c) => pref[c.key]?.pdf)
  const fmt = (c: Col, v: unknown): string => {
    if (v == null || v === '') return '—'
    if (c.tipo === 'moeda') return brl(Number(v))
    if (c.tipo === 'data') return dataBR(String(v))
    if (c.key === 'ganhoPct') return `${Number(v).toFixed(1)}%`
    return String(v)
  }

  function alternar(key: string, alvo: 'tela' | 'pdf') {
    const atual = pref[key] ?? { tela: false, pdf: false }
    if (alvo === 'pdf' && !atual.pdf && colsPdf.length >= MAX_PDF) { setMsg(`O PDF aceita no máximo ${MAX_PDF} colunas.`); return }
    setMsg(null); salvarPref({ ...pref, [key]: { ...atual, [alvo]: !atual[alvo] } })
  }

  const colunasExport = (cols: Col[]): Coluna<Linha>[] => cols.map((c) => ({
    header: c.header, tipo: c.tipo === 'numero' ? 'numero' : c.tipo, align: c.tipo === 'moeda' || c.tipo === 'numero' ? 'right' : 'left', total: c.tipo === 'moeda',
    peso: c.key === 'cliente' || c.key === 'titulo' ? 2 : 1,
    get: (l) => { const v = l[c.key]; return v == null ? null : (v as string | number) },
  }))
  const meta = () => ({
    titulo: 'Relatório de Documentos', empresa: selInfo.nome ?? '', emitidoEmISO: new Date().toISOString(),
    filtros: [fTipo && `Tipo: ${fTipo}`, fSit && `Situação: ${fSit}`, fCliente && `Cliente: ${fCliente}`, fDe && `De: ${dataBR(fDe)}`, fAte && `Até: ${dataBR(fAte)}`].filter(Boolean).join(' · ') || 'Sem filtros',
    kpis: [{ label: 'Valor dos documentos', valor: tot.valor, qtd: filtradas.length }, { label: 'Ganho líquido', valor: tot.ganho }],
  })
  const baixarPdf = async () => { if (!colsPdf.length) { setMsg('Marque ao menos uma coluna para o PDF.'); return } await exportarPDF(meta(), colunasExport(colsPdf), filtradas) }
  const baixarExcel = () => { exportarExcel(meta(), colunasExport(colsTela.length ? colsTela : COLS), filtradas) }

  const kpi = (l: string, v: string) => (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '10px 14px', minWidth: 150 }}>
      <div style={{ fontSize: 11, color: TEXTM }}>{l}</div><div style={{ fontSize: 17, fontWeight: 700, color: ESPRESSO }}>{v}</div>
    </div>
  )

  return (
    <div style={{ padding: 20, background: OFFWHITE, minHeight: '100vh', color: ESPRESSO }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Relatório de Documentos</h1>
      <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 14px' }}>Propostas e contratos de fee. O realizado (faturado/recebido) é lido do Financeiro (GE) — esta tela só consulta.</p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {kpi('Documentos', String(filtradas.length))}{kpi('Valor dos documentos', brl(tot.valor))}{kpi('Valor a faturar', brl(tot.faturar))}
        {kpi('Comissão de vendas', brl(tot.com))}{kpi('Ganho líquido', brl(tot.ganho))}{kpi('Ganho médio por documento', brl(ganhoMedio))}
        {kpi('Faturado (GE)', brl(tot.fat))}{kpi('Recebido (GE)', brl(tot.rec))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select aria-label="Tipo" style={inp} value={fTipo} onChange={(e) => setFTipo(e.target.value)}><option value="">Todos os tipos</option><option>Proposta</option><option>Contrato de fee</option></select>
        <select aria-label="Situação" style={inp} value={fSit} onChange={(e) => setFSit(e.target.value)}><option value="">Todas as situações</option>{situacoes.map((s) => <option key={s}>{s}</option>)}</select>
        <input aria-label="Cliente" style={inp} placeholder="Cliente" value={fCliente} onChange={(e) => setFCliente(e.target.value)} />
        <input aria-label="Emissão de" type="date" style={inp} value={fDe} onChange={(e) => setFDe(e.target.value)} />
        <input aria-label="Emissão até" type="date" style={inp} value={fAte} onChange={(e) => setFAte(e.target.value)} />
        <button style={{ ...inp, cursor: 'pointer' }} onClick={() => setConfig((v) => !v)}>Colunas ({colsTela.length} na tela · {colsPdf.length}/{MAX_PDF} no PDF)</button>
        <button style={{ ...inp, cursor: 'pointer', background: DOURADO, color: '#fff', border: 'none' }} onClick={() => void baixarPdf()}>PDF</button>
        <button style={{ ...inp, cursor: 'pointer' }} onClick={baixarExcel}>Excel</button>
      </div>

      {config && (
        <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))', gap: 6 }}>
            {COLS.map((c) => (
              <div key={c.key} style={{ display: 'flex', gap: 10, fontSize: 13, alignItems: 'center' }}>
                <span style={{ flex: 1 }}>{c.header}</span>
                <label><input type="checkbox" checked={!!pref[c.key]?.tela} onChange={() => alternar(c.key, 'tela')} /> tela</label>
                <label><input type="checkbox" checked={!!pref[c.key]?.pdf} onChange={() => alternar(c.key, 'pdf')} /> PDF</label>
              </div>
            ))}
          </div>
          <button style={{ ...inp, cursor: 'pointer', marginTop: 8 }} onClick={() => salvarPref(prefInicial())}>Restaurar padrão</button>
        </div>
      )}
      {msg && <div role="status" style={{ fontSize: 13, color: '#8A5A08', marginBottom: 8 }}>{msg}</div>}
      {erro && <div role="alert" style={{ fontSize: 13, color: '#7A1F1F', marginBottom: 8 }}>Não foi possível carregar: {erro}</div>}

      <div style={{ overflowX: 'auto', background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: OFFWHITE }}>{colsTela.map((c) => (
            <th key={c.key} style={{ textAlign: c.tipo === 'moeda' || c.tipo === 'numero' ? 'right' : 'left', padding: '8px 10px', borderBottom: `1px solid ${BORDA}`, whiteSpace: 'nowrap' }}>{c.header}</th>))}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={Math.max(colsTela.length, 1)} style={{ padding: 16, color: TEXTM }}>Carregando…</td></tr>}
            {!loading && !filtradas.length && <tr><td colSpan={Math.max(colsTela.length, 1)} style={{ padding: 16, color: TEXTM }}>Nenhum documento encontrado.</td></tr>}
            {filtradas.map((l) => (
              <tr key={`${l.tipo}-${l.id}`}>{colsTela.map((c) => (
                <td key={c.key} style={{ padding: '7px 10px', borderBottom: `1px solid ${BORDA}`, textAlign: c.tipo === 'moeda' || c.tipo === 'numero' ? 'right' : 'left', whiteSpace: c.key === 'titulo' ? 'normal' : 'nowrap' }}>{fmt(c, l[c.key])}</td>))}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
