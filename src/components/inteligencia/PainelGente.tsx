'use client'

// SALA DE COMANDO · GENTE — dashboard executivo (patamar DRH global).
// INVIOLÁVEL: 100% AGREGADO (LGPD, zero nome/matrícula) · hierárquico (escopo/RBAC) ·
// honesto (SEM DADOS quando não há base).
//
// FONTE CANÔNICA (cura da contradição entre telas · 13/07): o HEADLINE (horas
// trabalhadas, extras, headcount) e a tabela por-setor vêm de fn_ponto_bi_dia_agregado
// (lê ind_ponto_dia — MESMA fonte do /industrial/ponto, filtrável por data). Assim as
// duas telas mostram o MESMO número. Extras aqui = worked − escala do turno (excedente
// operacional, por dia). As métricas que SÓ o provedor fecha (noturno, banco, faltas,
// afastados, HE-CLT por faixa) continuam de fn_ponto_bi_agregado — rotuladas como
// "fechamento do provedor (período)", nunca como o headline. Série: fn_ponto_bi_serie.
// Nenhum dado pessoal chega ao client: só somatórios por setor/faixa/dia.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  PieChart, Pie, XAxis, YAxis, Tooltip, Cell, CartesianGrid, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'

// ── Paleta PS premium ────────────────────────────────────────────────
const ESP = '#3D2314'        // espresso
const BG = '#FAF7F2'         // off-white
const GOLD = '#C8941A'       // dourado
const CREAM = '#F2EBDF'      // cream
const LINE = '#E7DECF'       // linha
const MUT = 'rgba(61,35,20,0.55)'
const S_VERDE = '#2E7D5B'
const S_AMBAR = '#C8941A'
const S_VERM = '#B23B3B'
const RED_BG = '#FCEBEB'

type Tom = 'verde' | 'amarelo' | 'vermelho'
const TOM_COR: Record<Tom, string> = { verde: S_VERDE, amarelo: S_AMBAR, vermelho: S_VERM }
const TOM_DOT: Record<Tom, string> = { verde: '🟢', amarelo: '🟡', vermelho: '🔴' }
const TOM_BG: Record<Tom, string> = { verde: '#EAF3DE', amarelo: '#FAEEDA', vermelho: RED_BG }

const h1 = (n: number) => `${(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`
const n0 = (n: number) => (n ?? 0).toLocaleString('pt-BR')
const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`
const fmtD = (d: string | null) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—')
const addDaysISO = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }

// ── Tipos (só agregados) ─────────────────────────────────────────────
type HeFaixas = { f1: number; f2: number; f3: number; f4: number; dsr: number; feriado: number }
type BiTotais = {
  horas_trabalhadas: number; horas_extras: number; faltas: number; faltas_pct: number
  afastados_qtd: number; afastados_horas: number; folga_dsr: number
  noturno: number; banco: number; headcount: number; headcount_ativo: number
  he_faixas?: HeFaixas; admissoes?: number
}
type BiDepto = { departamento: string; trabalhadas: number; extras: number; faltas: number; faltas_pct: number; afastados_qtd: number; folga_dsr: number; headcount: number; noturno?: number; banco?: number; admissoes?: number }
type BiResult = { totais: BiTotais; por_departamento: BiDepto[] }
type SeriePonto = { periodo_inicio: string; periodo_fim: string; trabalhadas: number; extras: number; faltas: number; faltas_pct: number; extras_pct: number; noturno: number; banco: number; headcount: number }

// ── Merge de escopo (setores) ────────────────────────────────────────
function mesclarBi(parts: BiResult[]): BiResult {
  const hf: HeFaixas = { f1: 0, f2: 0, f3: 0, f4: 0, dsr: 0, feriado: 0 }
  const t: BiTotais = { horas_trabalhadas: 0, horas_extras: 0, faltas: 0, faltas_pct: 0, afastados_qtd: 0, afastados_horas: 0, folga_dsr: 0, noturno: 0, banco: 0, headcount: 0, headcount_ativo: 0, he_faixas: hf, admissoes: 0 }
  const por_departamento: BiDepto[] = []
  for (const p of parts) {
    if (!p) continue
    const pt = p.totais
    if (pt) {
      t.horas_trabalhadas += pt.horas_trabalhadas ?? 0; t.horas_extras += pt.horas_extras ?? 0
      t.faltas += pt.faltas ?? 0; t.afastados_qtd += pt.afastados_qtd ?? 0; t.afastados_horas += pt.afastados_horas ?? 0
      t.folga_dsr += pt.folga_dsr ?? 0; t.noturno += pt.noturno ?? 0; t.banco += pt.banco ?? 0
      t.headcount += pt.headcount ?? 0; t.headcount_ativo += pt.headcount_ativo ?? 0
      t.admissoes = (t.admissoes ?? 0) + (pt.admissoes ?? 0)
      if (pt.he_faixas) { hf.f1 += pt.he_faixas.f1 ?? 0; hf.f2 += pt.he_faixas.f2 ?? 0; hf.f3 += pt.he_faixas.f3 ?? 0; hf.f4 += pt.he_faixas.f4 ?? 0; hf.dsr += pt.he_faixas.dsr ?? 0; hf.feriado += pt.he_faixas.feriado ?? 0 }
    }
    por_departamento.push(...(p.por_departamento ?? []))
  }
  t.faltas_pct = (t.horas_trabalhadas + t.faltas) > 0 ? (t.faltas / (t.horas_trabalhadas + t.faltas)) * 100 : 0
  return { totais: t, por_departamento }
}
function mesclarSerie(parts: SeriePonto[][]): SeriePonto[] {
  const m = new Map<string, SeriePonto>()
  for (const arr of parts) for (const p of arr ?? []) {
    const k = `${p.periodo_inicio}|${p.periodo_fim}`
    const e = m.get(k)
    if (!e) m.set(k, { ...p })
    else { e.trabalhadas += p.trabalhadas; e.extras += p.extras; e.faltas += p.faltas; e.noturno += p.noturno; e.banco += p.banco; e.headcount += p.headcount }
  }
  const out = [...m.values()].map((p) => ({
    ...p,
    faltas_pct: (p.trabalhadas + p.faltas) > 0 ? +(p.faltas / (p.trabalhadas + p.faltas) * 100).toFixed(1) : 0,
    extras_pct: p.trabalhadas > 0 ? +(p.extras / p.trabalhadas * 100).toFixed(1) : 0,
  }))
  return out.sort((a, b) => a.periodo_inicio.localeCompare(b.periodo_inicio) || a.periodo_fim.localeCompare(b.periodo_fim))
}

// ── Fonte canônica (ind_ponto_dia) — headline + por-setor ────────────
type CanonTot = { horas_trabalhadas: number; horas_extras: number; infracoes: number; headcount: number; dias_com_registro: number }
type CanonDepto = { departamento: string; horas_trabalhadas: number; horas_extras: number; infracoes: number; headcount: number }
type CanonDia = { data: string; horas_trabalhadas: number; horas_extras: number; infracoes: number; presentes: number; batidas: number }
type CanonRet = { ok?: boolean; totais?: CanonTot; por_departamento?: CanonDepto[]; por_dia?: CanonDia[] }

// mescla N chamadas (um alvo por setor do escopo) num único canônico
function mesclarCanon(parts: CanonRet[]): { tot: CanonTot; deptos: Map<string, CanonDepto>; dia: Map<string, CanonDia> } {
  const tot: CanonTot = { horas_trabalhadas: 0, horas_extras: 0, infracoes: 0, headcount: 0, dias_com_registro: 0 }
  const deptos = new Map<string, CanonDepto>()
  const dia = new Map<string, CanonDia>()
  for (const p of parts) {
    if (!p?.totais) continue
    tot.horas_trabalhadas += p.totais.horas_trabalhadas ?? 0
    tot.horas_extras += p.totais.horas_extras ?? 0
    tot.infracoes += p.totais.infracoes ?? 0
    tot.headcount += p.totais.headcount ?? 0
    tot.dias_com_registro += p.totais.dias_com_registro ?? 0
    for (const d of p.por_departamento ?? []) deptos.set(d.departamento, d)
    for (const d of p.por_dia ?? []) {
      const e = dia.get(d.data)
      if (!e) dia.set(d.data, { ...d })
      else { e.horas_trabalhadas += d.horas_trabalhadas; e.horas_extras += d.horas_extras; e.infracoes += d.infracoes; e.presentes += d.presentes; e.batidas += d.batidas }
    }
  }
  return { tot, deptos, dia }
}

// ── Atrasos (ind_ponto_dia shift + ind_ponto_marcacao · CLT · agregado) ──
type AtrasoTot = { ocorrencias_manha: number; ocorrencias_pos_almoco: number; minutos_manha: number; minutos_pos_almoco: number; pessoas_com_atraso: number; dias_avaliados: number }
type AtrasoDepto = { setor: string; oc_manha: number; oc_pos: number; min_total: number; pessoas: number }
type AtrasoRet = { ok?: boolean; totais?: AtrasoTot; por_departamento?: AtrasoDepto[]; tolerancia?: { marcacao_min: number; dia_min: number } }

function mesclarAtrasos(parts: AtrasoRet[]): { tot: AtrasoTot; deptos: AtrasoDepto[]; tol?: { marcacao_min: number; dia_min: number } } {
  const tot: AtrasoTot = { ocorrencias_manha: 0, ocorrencias_pos_almoco: 0, minutos_manha: 0, minutos_pos_almoco: 0, pessoas_com_atraso: 0, dias_avaliados: 0 }
  const deptos: AtrasoDepto[] = []
  let tol
  for (const p of parts) {
    if (!p?.totais) continue
    tol = p.tolerancia ?? tol
    tot.ocorrencias_manha += p.totais.ocorrencias_manha ?? 0
    tot.ocorrencias_pos_almoco += p.totais.ocorrencias_pos_almoco ?? 0
    tot.minutos_manha += p.totais.minutos_manha ?? 0
    tot.minutos_pos_almoco += p.totais.minutos_pos_almoco ?? 0
    tot.pessoas_com_atraso += p.totais.pessoas_com_atraso ?? 0
    tot.dias_avaliados += p.totais.dias_avaliados ?? 0
    deptos.push(...(p.por_departamento ?? []))
  }
  deptos.sort((a, b) => b.min_total - a.min_total)
  return { tot, deptos, tol }
}

// escala de cor verde→âmbar→vermelho (0=bom, 1=ruim)
function corEscala(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio))
  const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t))
  const rgb = r < 0.5 ? mix([46, 125, 91], [200, 148, 26], r / 0.5) : mix([200, 148, 26], [178, 59, 59], (r - 0.5) / 0.5)
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
}

type HeatMetric = { key: keyof BiDepto | 'extras_pct'; label: string; worseHigh: boolean; fmt: (d: BiDepto) => string; val: (d: BiDepto) => number }
const HEAT_METRICS: HeatMetric[] = [
  { key: 'trabalhadas', label: 'Trabalhadas', worseHigh: false, fmt: (d) => h1(d.trabalhadas), val: (d) => d.trabalhadas },
  { key: 'extras_pct', label: 'HE %', worseHigh: true, fmt: (d) => pct(d.trabalhadas > 0 ? d.extras / d.trabalhadas * 100 : 0), val: (d) => d.trabalhadas > 0 ? d.extras / d.trabalhadas * 100 : 0 },
  { key: 'faltas_pct', label: 'Faltas %', worseHigh: true, fmt: (d) => pct(d.faltas_pct), val: (d) => d.faltas_pct ?? 0 },
  { key: 'noturno', label: 'Noturno', worseHigh: true, fmt: (d) => h1(d.noturno ?? 0), val: (d) => d.noturno ?? 0 },
  { key: 'banco', label: 'Banco', worseHigh: true, fmt: (d) => h1(d.banco ?? 0), val: (d) => Math.abs(d.banco ?? 0) },
]

export default function PainelGente({ companyId, dataIni, dataFim, setoresPermitidos }: {
  companyId: string | null; dataIni: string; dataFim: string
  setoresPermitidos: string[] | null   // null = vê tudo (bypass); senão só esses setores
}) {
  const [bi, setBi] = useState<BiResult | null>(null)
  const [biPrev, setBiPrev] = useState<BiResult | null>(null)
  const [serie, setSerie] = useState<SeriePonto[]>([])
  const [porDia, setPorDia] = useState<CanonDia[]>([])   // série por DIA (drill-down · ind_ponto_dia)
  const [canon, setCanon] = useState<{ tot: CanonTot; deptos: CanonDepto[] } | null>(null)  // canônico (janela do usuário)
  const [atrasos, setAtrasos] = useState<{ tot: AtrasoTot; deptos: AtrasoDepto[]; tol?: { marcacao_min: number; dia_min: number } } | null>(null)
  const [periodoProvedor, setPeriodoProvedor] = useState<{ ini: string; fim: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [depto, setDepto] = useState('')            // filtro global de setor (select + clique)
  const [heatMostrarBanco] = useState(true)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true); setErro(null)
    try {
      const alvos: (string | null)[] = depto ? [depto] : setoresPermitidos ? setoresPermitidos : [null]
      if (setoresPermitidos && !depto && alvos.length === 0) { setBi(mesclarBi([])); setBiPrev(null); setSerie([]); setLoading(false); return }
      // janela anterior de mesmo comprimento (para deltas)
      const len = Math.max(0, Math.round((new Date(dataFim + 'T00:00:00').getTime() - new Date(dataIni + 'T00:00:00').getTime()) / 86400000))
      const prevFim = addDaysISO(dataIni, -1)
      const prevIni = addDaysISO(prevFim, -len)
      const rpc = (ini: string, fim: string, alvo: string | null) => supabase.rpc('fn_ponto_bi_agregado', { p_company_id: companyId, p_data_ini: ini, p_data_fim: fim, p_departamento: alvo })
      const rpcDia = (ini: string, fim: string, alvo: string | null) => supabase.rpc('fn_ponto_bi_dia_agregado', { p_company_id: companyId, p_data_ini: ini, p_data_fim: fim, p_departamento: alvo })
      const rpcSerie = (alvo: string | null) => supabase.rpc('fn_ponto_bi_serie', { p_company_id: companyId, p_data_ini: dataIni, p_data_fim: dataFim, p_departamento: alvo })
      const rpcAtraso = (alvo: string | null) => supabase.rpc('fn_ponto_atrasos', { p_company_id: companyId, p_data_ini: dataIni, p_data_fim: dataFim, p_departamento: alvo })

      const [cur, prev, ser, curDia, prevDia, atr] = await Promise.all([
        Promise.all(alvos.map((a) => rpc(dataIni, dataFim, a))),
        Promise.all(alvos.map((a) => rpc(prevIni, prevFim, a))),
        Promise.all(alvos.map((a) => rpcSerie(a))),
        Promise.all(alvos.map((a) => rpcDia(dataIni, dataFim, a))),
        Promise.all(alvos.map((a) => rpcDia(prevIni, prevFim, a))),
        Promise.all(alvos.map((a) => rpcAtraso(a))),
      ])
      const err = [...cur, ...prev, ...ser, ...curDia, ...prevDia, ...atr].find((r) => r.error)
      if (err?.error) { setErro(err.error.message); setBi(null); setLoading(false); return }
      const curP = cur.map((r) => r.data as BiResult).filter(Boolean)
      const prevP = prev.map((r) => r.data as BiResult).filter(Boolean)
      const serP = ser.map((r) => (r.data as SeriePonto[]) ?? [])
      // PROVEDOR (fechamento) — HE-CLT por faixa, noturno, banco, faltas, afastados.
      // É período FECHADO do IO Point, NÃO recorta pela janela do usuário → fica rotulado à parte.
      setBi(curP.length ? (curP.length === 1 && !setoresPermitidos ? curP[0] : mesclarBi(curP)) : null)
      setBiPrev(prevP.length ? (prevP.length === 1 && !setoresPermitidos ? prevP[0] : mesclarBi(prevP)) : null)
      // CANÔNICO (ind_ponto_dia) — horas/headcount/infrações da JANELA do usuário (filtrável).
      const canonCur = mesclarCanon(curDia.map((r) => (r.data as CanonRet) ?? {}))
      setCanon({ tot: canonCur.tot, deptos: [...canonCur.deptos.values()] })
      setSerie(mesclarSerie(serP))
      setPorDia([...canonCur.dia.values()].sort((a, b) => a.data.localeCompare(b.data)))
      setAtrasos(mesclarAtrasos(atr.map((r) => (r.data as AtrasoRet) ?? {})))
      // período REAL do fechamento do provedor (span dos registros armazenados) — pro rótulo honesto
      const { data: perProv } = await supabase.from('ind_ponto_horas')
        .select('periodo_inicio, periodo_fim').eq('company_id', companyId)
        .order('periodo_inicio', { ascending: true }).limit(1000)
      if (perProv && perProv.length) {
        const ini = perProv.reduce((m, r) => r.periodo_inicio && r.periodo_inicio < m ? r.periodo_inicio : m, perProv[0].periodo_inicio as string)
        const fim = perProv.reduce((m, r) => r.periodo_fim && r.periodo_fim > m ? r.periodo_fim : m, perProv[0].periodo_fim as string)
        setPeriodoProvedor({ ini, fim })
      } else setPeriodoProvedor(null)
      setLoading(false)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e)); setBi(null); setLoading(false)
    }
  }, [companyId, dataIni, dataFim, depto, setoresPermitidos])

  useEffect(() => { let ok = true; void (async () => { if (ok) await carregar() })(); return () => { ok = false } }, [carregar])

  const totais = bi?.totais
  const deptos = bi?.por_departamento ?? []
  const cTot = canon?.tot                                   // canônico (janela do usuário · ind_ponto_dia)
  const cDeptos = canon?.deptos ?? []
  const provPer = periodoProvedor ? `${fmtD(periodoProvedor.ini)} – ${fmtD(periodoProvedor.fim)}` : 'período sincronizado'
  const pctExtras = totais && totais.horas_trabalhadas > 0 ? (totais.horas_extras / totais.horas_trabalhadas) * 100 : 0
  const pctExtrasPrev = biPrev?.totais && biPrev.totais.horas_trabalhadas > 0 ? (biPrev.totais.horas_extras / biPrev.totais.horas_trabalhadas) * 100 : null

  // dropdown de setor: escopo (se houver) ou setores do agregado
  const departamentos = useMemo(() => {
    if (setoresPermitidos) return [...setoresPermitidos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const s = new Set<string>(); for (const d of deptos) if (d.departamento) s.add(d.departamento)
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [deptos, setoresPermitidos])

  // Semáforo geral — estado num relance
  const setoresCriticos = useMemo(() => deptos.filter((d) => (d.faltas_pct ?? 0) > 10 || (d.trabalhadas > 0 && d.extras / d.trabalhadas * 100 > 12)), [deptos])
  const tomGeral: Tom = useMemo(() => {
    if (!totais || totais.headcount === 0) return 'verde'
    if (setoresCriticos.length >= 2 || totais.faltas_pct > 10 || pctExtras > 12) return 'vermelho'
    if (setoresCriticos.length >= 1 || totais.faltas_pct > 5 || pctExtras > 8) return 'amarelo'
    return 'verde'
  }, [totais, setoresCriticos, pctExtras])
  // 🚨 RD-46: ausência de dado NUNCA é verde. Se falhou/carregando/vazio, a saúde é INDEFINIDA
  // (nunca "Saudável"). O bug: falhou o load e o semáforo mostrava 🟢 "0 setores críticos".
  const saudeIndefinida = loading || !!erro || (!totais && !canon)

  // Séries por métrica p/ sparkline
  const sparkOf = useCallback((sel: (p: SeriePonto) => number) => serie.map((p, i) => ({ i, v: +sel(p).toFixed(2) })), [serie])

  const rankingBarras = useMemo(() => deptos.slice().sort((a, b) => b.extras - a.extras).slice(0, 12).map((d) => ({ nome: d.departamento, extras: +d.extras.toFixed(1) })), [deptos])
  const headcountArea = useMemo(() => deptos.slice().sort((a, b) => b.headcount - a.headcount).slice(0, 12).map((d) => ({ nome: d.departamento, headcount: d.headcount })), [deptos])
  const semaforoSetores = useMemo(() => deptos.map((d) => {
    const ep = d.trabalhadas > 0 ? d.extras / d.trabalhadas * 100 : 0
    const tom: Tom = (d.faltas_pct ?? 0) > 10 || ep > 12 ? 'vermelho' : (d.faltas_pct ?? 0) > 5 || ep > 8 ? 'amarelo' : 'verde'
    return { ...d, extras_pct: ep, tom }
  }).sort((a, b) => (b.faltas_pct ?? 0) + (b.extras_pct) - ((a.faltas_pct ?? 0) + a.extras_pct)), [deptos])

  // Camada 5 · fadiga/excesso HE (CALCULADO — temos dado)
  const setoresFadiga = useMemo(() => semaforoSetores.filter((d) => d.extras_pct > 15 && d.headcount > 0), [semaforoSetores])

  const heFaixas = totais?.he_faixas
  const heTotalFaixas = heFaixas ? heFaixas.f1 + heFaixas.f2 + heFaixas.f3 + heFaixas.f4 + heFaixas.dsr + heFaixas.feriado : 0
  const donutData = heFaixas ? [
    { nome: 'Faixa 1 (50%)', v: heFaixas.f1, cor: GOLD },
    { nome: 'Faixa 2', v: heFaixas.f2, cor: '#B9832E' },
    { nome: 'Faixa 3', v: heFaixas.f3, cor: '#9C6B1C' },
    { nome: 'Faixa 4', v: heFaixas.f4, cor: '#7A5214' },
    { nome: 'DSR (100%)', v: heFaixas.dsr, cor: S_VERM },
    { nome: 'Feriado', v: heFaixas.feriado, cor: '#8A2F2F' },
  ].filter((x) => x.v > 0) : []

  const exportarCSV = useCallback(() => {
    const head = ['Setor', 'Pessoas', 'Trabalhadas(h)', 'Extras(h)', 'HE%', 'Faltas%', 'Noturno(h)', 'Banco(h)', 'Afastados']
    const linhas = deptos.map((d) => [d.departamento, d.headcount, d.trabalhadas, d.extras, d.trabalhadas > 0 ? (d.extras / d.trabalhadas * 100).toFixed(1) : '0', (d.faltas_pct ?? 0).toFixed(1), d.noturno ?? 0, d.banco ?? 0, d.afastados_qtd ?? 0])
    const csv = [head, ...linhas].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `sala-comando-gente_${dataIni}_${dataFim}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }, [deptos, dataIni, dataFim])

  const semDados = (!cTot || cTot.dias_com_registro === 0) && (!totais || totais.headcount === 0)

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* ═══ FAIXA DE COMANDO (espresso) ═══ */}
      <section style={{ background: ESP, borderRadius: 14, padding: '18px 20px', color: BG }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.5, color: GOLD, fontWeight: 700 }}>🎛️ Sala de Comando · Gente</div>
            <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, margin: '3px 0 0', color: '#FFF' }}>Indicadores de pessoas</h2>
            <div style={{ fontSize: 12, color: 'rgba(250,247,242,0.7)', marginTop: 3 }}>
              {fmtD(dataIni)} → {fmtD(dataFim)} · {setoresPermitidos ? `escopo: ${setoresPermitidos.length} setor(es)` : 'todos os setores'} · 🔒 agregado (LGPD, sem nomes)
            </div>
          </div>
          {/* Semáforo de saúde geral — assinatura 1. RD-46: nunca verde sobre dado ausente. */}
          {saudeIndefinida ? (
            <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(250,247,242,0.4)', borderRadius: 12, padding: '10px 16px', minWidth: 210 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(250,247,242,0.6)' }}>Saúde geral</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                <span style={{ fontSize: 18 }}>{loading ? '⏳' : '⚠️'}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: '#E8DCC8' }}>{loading ? 'Calculando…' : 'Não foi possível calcular'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(250,247,242,0.75)' }}>{loading ? 'aguarde' : 'ajuste o período ou tente de novo — ausência de dado não é boa notícia'}</div>
            </div>
          ) : (
            <div style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${TOM_COR[tomGeral]}`, borderRadius: 12, padding: '10px 16px', minWidth: 210 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(250,247,242,0.6)' }}>Saúde geral</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0' }}>
                <span style={{ fontSize: 18 }}>{TOM_DOT[tomGeral]}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: TOM_COR[tomGeral] === S_AMBAR ? '#E8B94A' : TOM_COR[tomGeral] === S_VERM ? '#E08A8A' : '#7FD1A8' }}>
                  {tomGeral === 'verde' ? 'Saudável' : tomGeral === 'amarelo' ? 'Atenção' : 'Crítico'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(250,247,242,0.75)' }}>{setoresCriticos.length} setor(es) crítico(s)</div>
            </div>
          )}
        </div>
        {/* Filtros globais ao vivo */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(250,247,242,0.6)' }}>Filtro global:</span>
          <select value={depto} onChange={(e) => setDepto(e.target.value)} style={{ ...inp, minWidth: 200 }}>
            <option value="">Todos os setores ({departamentos.length})</option>
            {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          {depto && <button onClick={() => setDepto('')} style={{ ...inp, cursor: 'pointer', background: CREAM, fontWeight: 600 }}>✕ limpar</button>}
          <button onClick={exportarCSV} disabled={semDados} style={{ ...inp, cursor: semDados ? 'not-allowed' : 'pointer', background: semDados ? '#7a6a5c' : GOLD, color: '#fff', fontWeight: 700, opacity: semDados ? 0.5 : 1 }}>⬇ Exportar CSV</button>
        </div>
      </section>

      {erro ? (
        <div style={{ background: RED_BG, color: S_VERM, padding: '12px 16px', borderRadius: 10, fontSize: 13 }}>Não foi possível carregar: {erro}</div>
      ) : loading ? (
        <div style={{ padding: 48, textAlign: 'center', color: MUT, fontSize: 13, background: '#FFF', borderRadius: 12, border: `0.5px solid ${LINE}` }}>Carregando Sala de Comando…</div>
      ) : semDados ? (
        <div style={{ padding: 48, textAlign: 'center', color: MUT, fontSize: 13, background: '#FFF', borderRadius: 12, border: `0.5px solid ${LINE}` }}>
          Nenhuma hora no período/setor. {setoresPermitidos ? 'Você vê só os setores do seu escopo.' : 'Ajuste o período e sincronize o ponto.'}
        </div>
      ) : (
        <>
          {/* ═══ CAMADA 1a · CANÔNICO (janela do usuário · ind_ponto_dia) ═══ */}
          {/* MESMA fonte do /industrial/ponto → os números batem. Filtrável por data. */}
          <div>
            <SecHdr titulo={`Jornada · ${fmtD(dataIni)} → ${fmtD(dataFim)}`} nota="Marcação diária (ind_ponto_dia) — mesma fonte do Ponto Eletrônico. Filtrável por data." />
            {cTot && cTot.dias_com_registro > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Kpi titulo="Horas trabalhadas" valor={h1(cTot.horas_trabalhadas)} cur={cTot.horas_trabalhadas} betterLower={false} sufixo="h" ctx="worked_time somado por dia" />
                <Kpi titulo="Headcount (com batida)" valor={n0(cTot.headcount)} cur={cTot.headcount} betterLower={false} ctx="pessoas que registraram ponto no período" />
                <Kpi titulo="Infrações de jornada" valor={n0(cTot.infracoes)} cur={cTot.infracoes} betterLower tomForce={cTot.infracoes > 0 ? 'vermelho' : 'verde'} ctx="dias com jornada acima do limite legal" />
              </div>
            ) : (
              <MiniVazio texto="Sem marcação diária no período. Sincronize o ponto (dia a dia) no Ponto Eletrônico." />
            )}
          </div>

          {/* Drill-down por DIA (canônico · ind_ponto_dia) — LGPD: agregado, sem nomes */}
          {porDia.length > 0 && (
            <Card titulo="Jornada dia a dia" nota="Marcação diária (ind_ponto_dia) — mesma fonte do headline acima. Clique num dia para abrir por setor. 🔒 agregado, sem nomes.">
              <DrillDia porDia={porDia} companyId={companyId!} depto={depto} />
            </Card>
          )}

          {/* ATRASOS (shift do IO Point + batidas · CLT · agregado, sem nomes) */}
          {atrasos && (atrasos.tot.ocorrencias_manha + atrasos.tot.ocorrencias_pos_almoco) > 0 && (
            <Card titulo="Atrasos" nota={`Início do turno (shift do IO Point) vs 1ª batida. Tolerância CLT: ${atrasos.tol?.marcacao_min ?? 5}min/marcação, teto ${atrasos.tol?.dia_min ?? 10}min/dia (excedeu, conta tudo). Manhã (transporte) × pós-almoço (disciplina) separados. 🔒 sem nomes.`}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
                <MiniKpi label="Atrasos manhã" valor={n0(atrasos.tot.ocorrencias_manha)} sub={`${n0(atrasos.tot.minutos_manha)} min · transporte`} cor={atrasos.tot.ocorrencias_manha > 0 ? S_AMBAR : undefined} />
                <MiniKpi label="Atrasos pós-almoço" valor={n0(atrasos.tot.ocorrencias_pos_almoco)} sub={`${n0(atrasos.tot.minutos_pos_almoco)} min · disciplina`} cor={atrasos.tot.ocorrencias_pos_almoco > 0 ? S_AMBAR : undefined} />
                <MiniKpi label="Pessoas" valor={n0(atrasos.tot.pessoas_com_atraso)} sub="com atraso no período" />
                <MiniKpi label="Dias avaliados" valor={n0(atrasos.tot.dias_avaliados)} sub="dias-colaborador" />
              </div>
              {atrasos.deptos.length > 0 && (
                <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 520 }}>
                    <thead style={{ background: BG }}>
                      <tr><Th>Setor</Th><Th>Atrasos manhã</Th><Th>Atrasos pós-almoço</Th><Th>Min. total</Th><Th>Pessoas</Th></tr>
                    </thead>
                    <tbody>
                      {atrasos.deptos.slice(0, 12).map((d) => (
                        <tr key={d.setor} style={{ borderTop: `0.5px solid ${LINE}` }}>
                          <Td><b>{d.setor}</b></Td>
                          <Td>{d.oc_manha}</Td>
                          <Td>{d.oc_pos}</Td>
                          <Td style={{ fontWeight: 700, color: d.min_total > 0 ? S_AMBAR : MUT }}>{n0(d.min_total)} min</Td>
                          <Td style={{ color: MUT }}>{d.pessoas}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* ═══ CAMADA 1b · FECHAMENTO DO PROVEDOR (período do IO Point) ═══ */}
          {/* HE-CLT por faixa, noturno, banco, faltas, afastados: só o provedor fecha. NÃO recorta pela
              janela do usuário → período do provedor explícito, nunca fingindo ser o filtro selecionado. */}
          {totais && totais.headcount > 0 && (
            <div>
              <SecHdr titulo="Fechamento do provedor" tag={`período do IO Point: ${provPer}`}
                nota="HE-CLT, adicional noturno, banco, faltas e afastados vêm do fechamento legal do provedor. Não recorta pela janela acima — o período real do provedor está no rótulo." />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <Kpi titulo="HE-CLT (por faixa)" valor={h1(totais.horas_extras)} cur={pctExtras} prev={pctExtrasPrev ?? undefined} betterLower deltaFmt={pct} tomForce={pctExtras > 12 ? 'vermelho' : pctExtras > 8 ? 'amarelo' : 'verde'} ctx={`${pct(pctExtras)} sobre trabalhadas (provedor)`} />
                <Kpi titulo="Absenteísmo" valor={pct(totais.faltas_pct)} spark={sparkOf((p) => p.faltas_pct)} cur={totais.faltas_pct} prev={biPrev?.totais.faltas_pct} betterLower deltaFmt={pct} tomForce={totais.faltas_pct > 10 ? 'vermelho' : totais.faltas_pct > 5 ? 'amarelo' : 'verde'} ctx={`${h1(totais.faltas)} · ausência pontual`} />
                <Kpi titulo="Afastados" valor={n0(totais.afastados_qtd)} cur={totais.afastados_qtd} prev={biPrev?.totais.afastados_qtd} betterLower ctx="INSS / licença / atestado" />
                <Kpi titulo="Adicional noturno" valor={h1(totais.noturno)} spark={sparkOf((p) => p.noturno)} cur={totais.noturno} prev={biPrev?.totais.noturno} betterLower={false} sufixo="h" ctx="horas em período noturno" />
                <Kpi titulo="Banco de horas" valor={h1(totais.banco)} spark={sparkOf((p) => p.banco)} cur={totais.banco} prev={biPrev?.totais.banco} betterLower={false} sufixo="h" ctx="saldo acumulado" />
                <Kpi titulo="Headcount (fechamento)" valor={n0(totais.headcount)} cur={totais.headcount} betterLower={false} ctx={`${totais.headcount_ativo} ativos · base do provedor`} />
                <Kpi titulo="Admissões" valor={n0(totais.admissoes ?? 0)} cur={totais.admissoes ?? 0} prev={biPrev?.totais.admissoes} betterLower={false} ctx="entradas no período" />
              </div>
            </div>
          )}

          {/* ═══ CAMADA 2 · Tendência & Composição ═══ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card titulo="Tendência · HE e absenteísmo por janela" nota="1 ponto por sync — a curva cresce a cada sincronização do ponto.">
              {serie.length === 0 ? <MiniVazio texto="Série nasce no primeiro sync." /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={serie.map((p) => ({ nome: fmtD(p.periodo_fim), HE: p.extras, Absent: p.faltas_pct }))} margin={{ left: 4, right: 10, top: 8, bottom: 4 }}>
                    <CartesianGrid stroke={LINE} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="nome" tick={{ fontSize: 10, fill: MUT }} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10, fill: MUT }} width={40} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: MUT }} width={40} unit="%" />
                    <Tooltip formatter={(v, n) => [n === 'Absent' ? pct(Number(v)) : h1(Number(v)), n === 'Absent' ? 'Absenteísmo' : 'Horas extras'] as [string, string]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line yAxisId="l" type="monotone" dataKey="HE" name="Horas extras" stroke={GOLD} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                    <Line yAxisId="r" type="monotone" dataKey="Absent" name="Absenteísmo" stroke={S_VERM} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Card>
            <Card titulo="HE-CLT por faixa" nota={`Fechamento legal do IO Point · ${provPer}${heTotalFaixas > 0 ? ` · total ${h1(heTotalFaixas)}` : ''}. HE por faixa/DSR/feriado — o cálculo que vai pra folha.`}>
              {donutData.length === 0 ? <MiniVazio texto="Sem HE por faixa no fechamento do provedor." /> : (
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={donutData} dataKey="v" nameKey="nome" innerRadius={52} outerRadius={82} paddingAngle={2} isAnimationActive={false}>
                      {donutData.map((d, i) => <Cell key={i} fill={d.cor} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [h1(Number(v)), n as string] as [string, string]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>

          {/* ═══ CAMADA 3 · Estratificação (assinaturas) ═══ */}
          <Card titulo="Mapa de calor · setor × métrica" nota="Clique numa célula para filtrar o painel por aquele setor.">
            <Heatmap deptos={deptos} onPick={(s) => setDepto(s)} selecionado={depto} mostrarBanco={heatMostrarBanco} />
          </Card>

          <Card titulo="Semáforo por setor" nota="Clique num setor para filtrar todo o painel.">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8 }}>
              {semaforoSetores.map((d) => {
                const ativo = depto === d.departamento
                const maxRef = Math.max(1, ...semaforoSetores.map((x) => x.extras_pct))
                return (
                  <button key={d.departamento} onClick={() => setDepto(ativo ? '' : d.departamento)} title={`HE ${pct(d.extras_pct)} · Faltas ${pct(d.faltas_pct ?? 0)} · ${d.headcount} pessoas`}
                    style={{ textAlign: 'left', cursor: 'pointer', background: ativo ? TOM_BG[d.tom] : '#FFF', border: `1px solid ${ativo ? TOM_COR[d.tom] : LINE}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: ESP, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{TOM_DOT[d.tom]} {d.departamento}</span>
                      <span style={{ fontSize: 11, color: MUT, whiteSpace: 'nowrap' }}>{d.headcount}p</span>
                    </div>
                    <div style={{ fontSize: 11, color: MUT, margin: '3px 0 5px' }}>HE {pct(d.extras_pct)} · Faltas {pct(d.faltas_pct ?? 0)}</div>
                    <div style={{ height: 6, background: CREAM, borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, d.extras_pct / maxRef * 100)}%`, height: '100%', background: TOM_COR[d.tom] }} />
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* ═══ CAMADA 4 · Ranking & distribuição ═══ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
            <Card titulo="Ranking · horas extras por setor" nota={rankingBarras.length === 12 ? 'top 12' : undefined}>
              <ResponsiveContainer width="100%" height={Math.max(160, rankingBarras.length * 28)}>
                <BarChart data={rankingBarras} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: MUT }} />
                  <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 10, fill: ESP }} />
                  <Tooltip formatter={(v) => [h1(Number(v)), 'Horas extras'] as [string, string]} />
                  <Bar dataKey="extras" radius={[0, 4, 4, 0]} isAnimationActive={false}>{rankingBarras.map((_, i) => <Cell key={i} fill={GOLD} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card titulo="Distribuição · headcount por setor" nota="pessoas com registro no período">
              <ResponsiveContainer width="100%" height={Math.max(160, headcountArea.length * 28)}>
                <AreaChart data={headcountArea} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <defs><linearGradient id="hcGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor={GOLD} stopOpacity={0.25} /><stop offset="100%" stopColor={GOLD} stopOpacity={0.85} /></linearGradient></defs>
                  <XAxis type="number" tick={{ fontSize: 10, fill: MUT }} />
                  <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 10, fill: ESP }} />
                  <Tooltip formatter={(v) => [n0(Number(v)), 'Pessoas'] as [string, string]} />
                  <Area dataKey="headcount" fill="url(#hcGrad)" stroke={GOLD} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Ranking POR SETOR (tabela agregada) */}
          <Card titulo="Detalhe agregado por setor" nota="Detalhe por pessoa (nomes) só no Ponto Eletrônico — acesso restrito.">
            <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 680 }}>
                <thead style={{ background: BG }}>
                  <tr><Th>Setor</Th><Th>Pessoas</Th><Th>Trabalhadas</Th><Th>Extras</Th><Th>HE %</Th><Th>Faltas %</Th><Th>Noturno</Th><Th>Banco</Th></tr>
                </thead>
                <tbody>
                  {semaforoSetores.map((d) => (
                    <tr key={d.departamento} onClick={() => setDepto(depto === d.departamento ? '' : d.departamento)} style={{ borderTop: `0.5px solid ${LINE}`, cursor: 'pointer', background: depto === d.departamento ? BG : undefined }}>
                      <Td><b>{TOM_DOT[d.tom]} {d.departamento}</b></Td>
                      <Td style={{ color: MUT }}>{d.headcount}</Td>
                      <Td>{h1(d.trabalhadas)}</Td>
                      <Td style={{ fontWeight: 700, color: d.extras > 0 ? GOLD : MUT }}>{h1(d.extras)}</Td>
                      <Td>{pct(d.extras_pct)}</Td>
                      <Td>{pct(d.faltas_pct ?? 0)}</Td>
                      <Td>{h1(d.noturno ?? 0)}</Td>
                      <Td style={{ color: MUT }}>{d.banco != null ? h1(d.banco) : '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ═══ CAMADA 5 · Alerta calculado + SEM DADOS honesto ═══ */}
          <Card titulo="⚠️ Excesso de HE / risco de fadiga (SST)" nota="Setores com HE acima de 15% da jornada — sinal de sobrecarga.">
            {setoresFadiga.length === 0 ? (
              <div style={{ fontSize: 13, color: S_VERDE, fontWeight: 600 }}>🟢 Nenhum setor acima do limiar de fadiga no período.</div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {setoresFadiga.map((d) => (
                  <div key={d.departamento} style={{ background: RED_BG, border: `1px solid ${S_VERM}`, borderRadius: 10, padding: '8px 12px' }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: S_VERM }}>🔴 {d.departamento}</div>
                    <div style={{ fontSize: 11, color: MUT }}>HE {pct(d.extras_pct)} · {d.headcount} pessoas</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 8 }}>Ainda sem base de dado</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
              <SemDados titulo="🔄 Turnover por setor" falta="requer data de desligamento (hoje só há admissão)" />
              <SemDados titulo="❄️ Pausas térmicas NR-36" falta="requer regra NR-36 + marcações de intervalo por dia" />
              <SemDados titulo="💵 Custo de mão de obra" falta="requer valor-hora por setor/função (é GE, não ponto)" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Heatmap setor × métrica ─────────────────────────────────────────
function Heatmap({ deptos, onPick, selecionado, mostrarBanco }: { deptos: BiDepto[]; onPick: (s: string) => void; selecionado: string; mostrarBanco: boolean }) {
  const metrics = mostrarBanco ? HEAT_METRICS : HEAT_METRICS.filter((m) => m.key !== 'banco')
  const linhas = deptos.slice().sort((a, b) => b.extras - a.extras)
  const faixa = new Map<string, { min: number; max: number }>()
  for (const m of metrics) {
    const vals = linhas.map((d) => m.val(d))
    faixa.set(String(m.key), { min: Math.min(...vals, 0), max: Math.max(...vals, 0.0001) })
  }
  if (linhas.length === 0) return <MiniVazio texto="Sem setores no período." />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 3, minWidth: 520 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', fontSize: 10, color: MUT, fontWeight: 700, padding: '2px 8px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Setor</th>
            {metrics.map((m) => <th key={String(m.key)} style={{ fontSize: 10, color: MUT, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map((d) => (
            <tr key={d.departamento}>
              <td style={{ fontSize: 12, color: ESP, fontWeight: selecionado === d.departamento ? 700 : 500, padding: '2px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.departamento}</td>
              {metrics.map((m) => {
                const v = m.val(d); const f = faixa.get(String(m.key))!
                const ratioRaw = (v - f.min) / (f.max - f.min || 1)
                const ratio = m.worseHigh ? ratioRaw : 0.15 + ratioRaw * 0.25 // métrica neutra: tons suaves
                const cor = corEscala(m.worseHigh ? ratio : ratio)
                return (
                  <td key={String(m.key)} onClick={() => onPick(selecionado === d.departamento ? '' : d.departamento)} title={`${d.departamento} · ${m.label}: ${m.fmt(d)}`}
                    style={{ cursor: 'pointer', background: cor, color: '#FFF', fontSize: 11, fontWeight: 600, textAlign: 'center', padding: '8px 10px', borderRadius: 6, minWidth: 66, outline: selecionado === d.departamento ? `2px solid ${ESP}` : 'none' }}>
                    {m.fmt(d)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Drill-down por DIA (ind_ponto_dia) → por setor. LGPD: agregado, sem nomes ──
function DrillDia({ porDia, companyId, depto }: { porDia: CanonDia[]; companyId: string; depto: string }) {
  const [aberto, setAberto] = useState<string | null>(null)
  const [setores, setSetores] = useState<Record<string, CanonDepto[]>>({})
  const [carregando, setCarregando] = useState<string | null>(null)
  const fmtDia = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', weekday: 'short' })
  const maxH = Math.max(1, ...porDia.map((d) => d.horas_trabalhadas))

  async function abrir(data: string) {
    if (aberto === data) { setAberto(null); return }
    setAberto(data)
    if (!setores[data]) {
      setCarregando(data)
      const { data: r } = await supabase.rpc('fn_ponto_bi_dia_agregado', { p_company_id: companyId, p_data_ini: data, p_data_fim: data, p_departamento: depto || null })
      const ret = r as CanonRet | null
      setSetores((s) => ({ ...s, [data]: (ret?.por_departamento ?? []).slice().sort((a, b) => b.horas_trabalhadas - a.horas_trabalhadas) }))
      setCarregando(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {porDia.map((d) => {
        const ab = aberto === d.data
        return (
          <div key={d.data} style={{ border: `0.5px solid ${LINE}`, borderRadius: 8, overflow: 'hidden' }}>
            <button type="button" onClick={() => abrir(d.data)} aria-expanded={ab}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', background: ab ? BG : '#FFF', border: 'none', cursor: 'pointer', textAlign: 'left', font: 'inherit', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: ESP, minWidth: 116, textTransform: 'capitalize' }}>{fmtDia(d.data)}</span>
              <div style={{ flex: 1, minWidth: 90, height: 8, background: CREAM, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, d.horas_trabalhadas / maxH * 100)}%`, height: '100%', background: GOLD }} />
              </div>
              <span style={{ fontSize: 12.5, color: ESP, fontWeight: 600, minWidth: 62, textAlign: 'right' }}>{h1(d.horas_trabalhadas)}</span>
              {d.horas_extras > 0 && <span style={{ fontSize: 11, color: GOLD, fontWeight: 600 }}>+{h1(d.horas_extras)}</span>}
              <span style={{ fontSize: 11, color: MUT }}>{d.presentes}p</span>
              {d.infracoes > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: S_VERM, background: RED_BG, padding: '2px 6px', borderRadius: 4 }}>⚠ {d.infracoes}</span>}
              <span style={{ fontSize: 13, color: MUT, transform: ab ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>›</span>
            </button>
            {ab && (
              <div style={{ borderTop: `0.5px solid ${LINE}`, padding: '8px 12px 10px', background: BG }}>
                {carregando === d.data ? (
                  <div style={{ fontSize: 12, color: MUT }}>Carregando setores…</div>
                ) : !setores[d.data] || setores[d.data].length === 0 ? (
                  <div style={{ fontSize: 12, color: MUT }}>Sem setores neste dia.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>
                      <th style={{ textAlign: 'left', fontSize: 10, color: MUT, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase' }}>Setor</th>
                      <th style={{ textAlign: 'right', fontSize: 10, color: MUT, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase' }}>Horas</th>
                      <th style={{ textAlign: 'right', fontSize: 10, color: MUT, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase' }}>Extras</th>
                      <th style={{ textAlign: 'right', fontSize: 10, color: MUT, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase' }}>Pessoas</th>
                    </tr></thead>
                    <tbody>
                      {setores[d.data].map((s) => (
                        <tr key={s.departamento} style={{ borderTop: `0.5px solid ${LINE}` }}>
                          <td style={{ padding: '4px 6px', color: ESP }}>{s.departamento}</td>
                          <td style={{ padding: '4px 6px', color: ESP, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{h1(s.horas_trabalhadas)}</td>
                          <td style={{ padding: '4px 6px', textAlign: 'right', color: s.horas_extras > 0 ? GOLD : MUT, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{h1(s.horas_extras)}</td>
                          <td style={{ padding: '4px 6px', color: MUT, textAlign: 'right' }}>{s.headcount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── KPI premium ──────────────────────────────────────────────────────
function Kpi({ titulo, valor, ctx, spark, cur, prev, betterLower, deltaFmt, sufixo, tomForce }: {
  titulo: string; valor: string; ctx: string; spark?: { i: number; v: number }[]
  cur: number; prev?: number; betterLower: boolean; deltaFmt?: (n: number) => string; sufixo?: string; tomForce?: Tom
}) {
  const temPrev = prev != null && isFinite(prev)
  const delta = temPrev ? cur - (prev as number) : null
  const melhora = delta == null ? null : betterLower ? delta < 0 : delta > 0
  const corDelta = delta == null || delta === 0 ? MUT : melhora ? S_VERDE : S_VERM
  const seta = delta == null || delta === 0 ? '' : delta > 0 ? '▲' : '▼'
  const dfmt = deltaFmt ?? ((n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${sufixo ?? ''}`)
  const barra = tomForce ? TOM_COR[tomForce] : GOLD
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: '14px 15px', borderTop: `3px solid ${barra}` }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>{titulo}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, margin: '4px 0 2px' }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: ESP, fontVariantNumeric: 'tabular-nums' }}>{valor}</span>
        {spark && spark.length > 1 && (
          <ResponsiveContainer width={72} height={30}>
            <LineChart data={spark}><Line type="monotone" dataKey="v" stroke={barra} strokeWidth={2} dot={false} isAnimationActive={false} /></LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {delta != null ? (
          <span style={{ fontSize: 11, fontWeight: 700, color: corDelta }}>{seta} {dfmt(Math.abs(delta))}</span>
        ) : (
          <span style={{ fontSize: 10, color: MUT, fontStyle: 'italic' }}>sem período anterior</span>
        )}
        <span style={{ fontSize: 11, color: MUT }}>· {ctx}</span>
      </div>
    </div>
  )
}

function MiniKpi({ label, valor, sub, cor }: { label: string; valor: string; sub?: string; cor?: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '11px 13px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESP, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2, marginTop: 2 }}>{valor}</div>
      {sub && <div style={{ fontSize: 11, color: MUT, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
function SecHdr({ titulo, nota, tag }: { titulo: string; nota?: string; tag?: string }) {
  return (
    <div style={{ margin: '2px 0 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', color: ESP }}>{titulo}</span>
        {tag && <span style={{ fontSize: 10, fontWeight: 700, color: '#854F0B', background: '#FAEEDA', padding: '2px 8px', borderRadius: 6 }}>{tag}</span>}
      </div>
      {nota && <div style={{ fontSize: 11, color: MUT, marginTop: 3, fontStyle: 'italic' }}>{nota}</div>}
    </div>
  )
}
function Card({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: nota ? 2 : 10 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{titulo}</span>
      </div>
      {nota && <div style={{ fontSize: 11, color: MUT, marginBottom: 10, fontStyle: 'italic' }}>{nota}</div>}
      {children}
    </section>
  )
}
function MiniVazio({ texto }: { texto: string }) {
  return <div style={{ padding: 28, textAlign: 'center', color: MUT, fontSize: 12, border: `1px dashed ${LINE}`, borderRadius: 10 }}>{texto}</div>
}
function SemDados({ titulo, falta }: { titulo: string; falta: string }) {
  return (
    <div style={{ background: BG, border: `1px dashed ${LINE}`, borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#854F0B', background: '#FAEEDA', display: 'inline-block', padding: '2px 8px', borderRadius: 6 }}>SEM DADOS DISPONÍVEIS</div>
      <div style={{ fontSize: 11, color: MUT, marginTop: 8, fontStyle: 'italic' }}>{falta}</div>
    </div>
  )
}
function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 14px', color: ESP, fontVariantNumeric: 'tabular-nums', ...style }}>{children}</td>
}
