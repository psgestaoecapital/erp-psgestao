'use client'

// BI de Gente — 100% AGREGADO (diretriz LGPD CEO): SÓ gráficos e indicadores por
// setor/faixa/período. ZERO nome/matrícula de colaborador (dado pessoal fica só na tela
// de Ponto, operacional e gateada). Hierárquico por escopo (setoresPermitidos).
// Reusa fn_ponto_bi_agregado — usa só o agregado por_departamento; nunca por_colaborador.
import { useEffect, useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const MUT = 'rgba(61,35,20,0.55)'
const RED = '#A32D2D'
const RED_BG = '#FCEBEB'

type Tom = 'verde' | 'amarelo' | 'vermelho'
const SEMAFORO: Record<Tom, { fg: string; bg: string; dot: string }> = {
  verde: { fg: '#3B6D11', bg: '#EAF3DE', dot: '🟢' },
  amarelo: { fg: '#854F0B', bg: '#FAEEDA', dot: '🟡' },
  vermelho: { fg: '#A32D2D', bg: '#FCEBEB', dot: '🔴' },
}
const h1 = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}h`
const fmtD = (d: string | null) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—')
const inp: React.CSSProperties = { padding: '9px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: ESP, background: '#FFF', boxSizing: 'border-box' }

type HeFaixas = { f1: number; f2: number; f3: number; f4: number; dsr: number; feriado: number }
type BiTotais = {
  horas_trabalhadas: number; horas_extras: number; faltas: number; faltas_pct: number
  afastados_qtd: number; afastados_horas: number; folga_dsr: number
  noturno: number; banco: number; headcount: number; headcount_ativo: number
  he_faixas?: HeFaixas; admissoes?: number
}
type BiDepto = { departamento: string; trabalhadas: number; extras: number; faltas: number; faltas_pct: number; afastados_qtd: number; folga_dsr: number; headcount: number; noturno?: number; banco?: number; admissoes?: number }
// por_colaborador (nominal) NÃO é consumido no BI — LGPD. Só o agregado por_departamento.
type BiResult = { totais: BiTotais; por_departamento: BiDepto[] }

type SetorSortKey = 'extras' | 'faltas_pct' | 'headcount' | 'noturno'

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

export default function PainelGente({ companyId, dataIni, dataFim, setoresPermitidos }: {
  companyId: string | null; dataIni: string; dataFim: string
  setoresPermitidos: string[] | null   // null = vê tudo (bypass); senão só esses setores
}) {
  const [bi, setBi] = useState<BiResult | null>(null)
  const [loadingBi, setLoadingBi] = useState(true)
  const [erroBi, setErroBi] = useState<string | null>(null)
  const [depto, setDepto] = useState('')
  const [sortKey, setSortKey] = useState<SetorSortKey>('extras')

  useEffect(() => {
    if (!companyId) return
    let ignore = false
    const run = async () => {
      setLoadingBi(true); setErroBi(null)
      try {
        const alvos: (string | null)[] = depto ? [depto] : setoresPermitidos ? setoresPermitidos : [null]
        if (setoresPermitidos && alvos.length === 0) { if (!ignore) { setBi(mesclarBi([])); setLoadingBi(false) } return }
        const results = await Promise.all(alvos.map((alvo) =>
          supabase.rpc('fn_ponto_bi_agregado', { p_company_id: companyId, p_data_ini: dataIni, p_data_fim: dataFim, p_departamento: alvo })
        ))
        if (ignore) return
        const err = results.find((r) => r.error)
        if (err?.error) { setErroBi(err.error.message); setBi(null); setLoadingBi(false); return }
        const parts = results.map((r) => r.data as BiResult).filter(Boolean)
        setBi(parts.length === 1 && !setoresPermitidos ? parts[0] : mesclarBi(parts))
        setLoadingBi(false)
      } catch (e) {
        if (!ignore) { setErroBi(e instanceof Error ? e.message : String(e)); setBi(null); setLoadingBi(false) }
      }
    }
    void run()
    return () => { ignore = true }
  }, [companyId, dataIni, dataFim, depto, setoresPermitidos])

  const totais = bi?.totais
  const pctExtras = totais && totais.horas_trabalhadas > 0 ? (totais.horas_extras / totais.horas_trabalhadas) * 100 : 0
  // dropdown de setor: escopo (se houver) ou os setores que vieram no agregado
  const departamentos = useMemo(() => {
    if (setoresPermitidos) return [...setoresPermitidos].sort((a, b) => a.localeCompare(b, 'pt-BR'))
    const s = new Set<string>()
    for (const d of bi?.por_departamento ?? []) if (d.departamento) s.add(d.departamento)
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [bi, setoresPermitidos])
  const rankingSetores = useMemo(() => {
    const arr = [...(bi?.por_departamento ?? [])]
    return arr.sort((a, b) => {
      if (sortKey === 'faltas_pct') return (b.faltas_pct ?? 0) - (a.faltas_pct ?? 0)
      if (sortKey === 'headcount') return (b.headcount ?? 0) - (a.headcount ?? 0)
      if (sortKey === 'noturno') return (b.noturno ?? 0) - (a.noturno ?? 0)
      return (b.extras ?? 0) - (a.extras ?? 0)
    })
  }, [bi, sortKey])
  const barras = useMemo(() => (bi?.por_departamento ?? []).slice().sort((a, b) => b.extras - a.extras).slice(0, 12).map((d) => ({ nome: d.departamento, extras: d.extras })), [bi])

  const tomExtras: Tom = pctExtras > 12 ? 'vermelho' : pctExtras > 8 ? 'amarelo' : 'verde'
  const tomFaltas: Tom = !totais ? 'verde' : totais.faltas_pct > 10 ? 'vermelho' : totais.faltas_pct > 5 ? 'amarelo' : 'verde'

  return (
    <section style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: ESP }}>📊 Indicadores de Gente</span>
        <span style={{ fontSize: 11, color: MUT }}>agregado por setor · {fmtD(dataIni)} → {fmtD(dataFim)}</span>
        {setoresPermitidos && <span style={{ fontSize: 10, background: '#FAEEDA', color: '#854F0B', padding: '2px 8px', borderRadius: 8, fontWeight: 700 }}>escopo: {setoresPermitidos.length} setor(es)</span>}
      </div>
      <div style={{ fontSize: 10, color: MUT, marginBottom: 12, fontStyle: 'italic' }}>🔒 BI agregado (LGPD) — sem nomes. Jornada individual fica no Ponto Eletrônico.</div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={depto} onChange={(e) => setDepto(e.target.value)} style={{ ...inp, minWidth: 180 }}>
          <option value="">Todos os setores ({departamentos.length})</option>
          {departamentos.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {erroBi ? (
        <div style={{ background: RED_BG, color: RED, padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>Não foi possível carregar o painel: {erroBi}</div>
      ) : loadingBi ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUT }}>Carregando painel…</div>
      ) : !totais || totais.headcount === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: MUT }}>
          Nenhuma hora no período/setor. {setoresPermitidos ? 'Você vê só os setores do seu escopo.' : 'Ajuste o período e sincronize o ponto.'}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
            <KpiSemaforo tom="verde" titulo="Horas trabalhadas" valor={h1(totais.horas_trabalhadas)} contexto={`${totais.headcount_ativo} trabalhando no período`} />
            <KpiSemaforo tom={tomExtras} titulo="Horas extras" valor={h1(totais.horas_extras)} contexto={`${pctExtras.toFixed(1)}% sobre as trabalhadas`} />
            <KpiSemaforo tom={tomFaltas} titulo="Faltas / Atrasos" valor={`${totais.faltas_pct.toFixed(1)}%`} contexto={`${h1(totais.faltas)} · ausência pontual`} />
            <KpiSemaforo tom="verde" titulo="Afastados" valor={String(totais.afastados_qtd)} contexto="pessoas · INSS / licença / atestado longo" />
            <KpiSemaforo tom="verde" titulo="Folga / DSR" valor={h1(totais.folga_dsr)} contexto="descanso escalado · não é falta" />
            <KpiSemaforo tom="verde" titulo="Adicional noturno" valor={h1(totais.noturno)} contexto="horas em período noturno" />
            <KpiSemaforo tom="verde" titulo="Banco de horas" valor={h1(totais.banco)} contexto="saldo acumulado no período" />
            <KpiSemaforo tom="verde" titulo="Admissões no período" valor={String(totais.admissoes ?? 0)} contexto="entradas (data de admissão)" />
          </div>

          {totais.he_faixas && (totais.he_faixas.f1 + totais.he_faixas.f2 + totais.he_faixas.f3 + totais.he_faixas.f4 + totais.he_faixas.dsr + totais.he_faixas.feriado) > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6 }}>Horas extras por faixa</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={[
                  { nome: 'Faixa 1', h: totais.he_faixas.f1 }, { nome: 'Faixa 2', h: totais.he_faixas.f2 },
                  { nome: 'Faixa 3', h: totais.he_faixas.f3 }, { nome: 'Faixa 4', h: totais.he_faixas.f4 },
                  { nome: 'DSR', h: totais.he_faixas.dsr }, { nome: 'Feriado', h: totais.he_faixas.feriado },
                ]} margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: ESP }} />
                  <YAxis tick={{ fontSize: 10, fill: MUT }} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}h`, 'Horas extras'] as [string, string]} />
                  <Bar dataKey="h" radius={[4, 4, 0, 0]}>{[0, 1, 2, 3, 4, 5].map((i) => <Cell key={i} fill={GOLD} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {barras.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 6 }}>Horas extras por setor {barras.length === 12 ? '(top 12)' : ''}</div>
              <ResponsiveContainer width="100%" height={Math.max(140, barras.length * 30)}>
                <BarChart data={barras} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <XAxis type="number" tick={{ fontSize: 10, fill: MUT }} />
                  <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 10, fill: ESP }} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}h`, 'Horas extras'] as [string, string]} />
                  <Bar dataKey="extras" radius={[0, 4, 4, 0]}>{barras.map((_, i) => <Cell key={i} fill={GOLD} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Ranking POR SETOR (agregado · sem nomes) */}
          <div style={{ overflowX: 'auto', border: `0.5px solid ${LINE}`, borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 640 }}>
              <thead style={{ background: BG }}>
                <tr>
                  <Th>Setor</Th>
                  <ThSort ativo={sortKey === 'headcount'} onClick={() => setSortKey('headcount')}>Pessoas</ThSort>
                  <Th>Trabalhadas</Th>
                  <ThSort ativo={sortKey === 'extras'} onClick={() => setSortKey('extras')}>Extras</ThSort>
                  <ThSort ativo={sortKey === 'faltas_pct'} onClick={() => setSortKey('faltas_pct')}>Faltas %</ThSort>
                  <ThSort ativo={sortKey === 'noturno'} onClick={() => setSortKey('noturno')}>Noturno</ThSort>
                  <Th>Banco</Th>
                </tr>
              </thead>
              <tbody>
                {rankingSetores.map((d) => (
                  <tr key={d.departamento} style={{ borderTop: `0.5px solid ${LINE}` }}>
                    <Td><b>{d.departamento}</b></Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums', color: MUT }}>{d.headcount}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums' }}>{h1(d.trabalhadas)}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: d.extras > 0 ? GOLD : MUT }}>{h1(d.extras)}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums' }}>{(d.faltas_pct ?? 0).toFixed(1)}%</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums' }}>{h1(d.noturno ?? 0)}</Td>
                    <Td style={{ fontVariantNumeric: 'tabular-nums', color: MUT }}>{d.banco != null ? h1(d.banco) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 10, color: MUT, margin: '6px 2px 0' }}>Detalhe por pessoa (nomes) só no Ponto Eletrônico (operacional, acesso restrito).</p>
        </>
      )}

      {/* TIER 2 — indicadores do catálogo ainda sem base de dado (empty-state honesto) */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, marginBottom: 8 }}>Ainda sem base de dado</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
          <SemDados titulo="📈 Histórico de HE / absenteísmo" falta="requer ≥2 períodos (hoje 1 semana; enche a cada sync)" />
          <SemDados titulo="🔄 Turnover por setor" falta="requer data de desligamento (só há admissão)" />
          <SemDados titulo="❄️ Pausas térmicas NR-36" falta="requer regra NR-36 + marcações de intervalo" />
          <SemDados titulo="⏱️ Infrações inter/intrajornada" falta="requer regra NR-36/acordo + marcações par-a-par" />
          <SemDados titulo="💵 Custo de mão de obra" falta="requer valor-hora" />
        </div>
      </div>
    </section>
  )
}

function SemDados({ titulo, falta }: { titulo: string; falta: string }) {
  return (
    <div style={{ background: BG, border: `1px dashed ${LINE}`, borderRadius: 10, padding: '14px 14px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: ESP, marginBottom: 6 }}>{titulo}</div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#854F0B', background: '#FAEEDA', display: 'inline-block', padding: '2px 8px', borderRadius: 6 }}>SEM DADOS DISPONÍVEIS</div>
      <div style={{ fontSize: 11, color: MUT, marginTop: 8, fontStyle: 'italic' }}>{falta}</div>
    </div>
  )
}

function KpiSemaforo({ tom, titulo, valor, contexto, nota }: { tom: Tom; titulo: string; valor: string; contexto: string; nota?: string }) {
  const s = SEMAFORO[tom]
  return (
    <div style={{ background: s.bg, borderRadius: 10, padding: '12px 14px', border: `0.5px solid ${LINE}` }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 9 }}>{s.dot}</span> {titulo}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: s.fg, fontVariantNumeric: 'tabular-nums', margin: '2px 0' }}>{valor}</div>
      <div style={{ fontSize: 11, color: MUT }}>{contexto}</div>
      {nota && <div style={{ fontSize: 10, color: MUT, marginTop: 3, fontStyle: 'italic' }}>{nota}</div>}
    </div>
  )
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: MUT, whiteSpace: 'nowrap' }}>{children}</th>
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: '10px 14px', color: ESP, ...style }}>{children}</td>
}
function ThSort({ children, ativo, onClick }: { children: React.ReactNode; ativo: boolean; onClick: () => void }) {
  return (
    <th onClick={onClick} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: ativo ? GOLD : MUT, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children} {ativo ? '↓' : ''}
    </th>
  )
}
