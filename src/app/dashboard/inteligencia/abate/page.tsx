'use client'
// BI Abate / Produção — dia e hora a hora (slot "producao" do hub de Inteligência).
// Três camadas, padrão do BI Comercial:
//   (1) tradutor fn_ind_producao_hora: lê o ERP de origem (só leitura), deduplica a importação e normaliza
//       dia/hora/turno/papel (abate · produção). Outro ERP entra por UNION ALL no tradutor, nada fixo aqui.
//   (2) porta fn_bi_abate_painel: guarda de empresa + escopo do gestor; devolve tudo pronto num jsonb.
//   (3) esta tela: só desenha. A leitura (frase-resumo) é por regras fixas e determinísticas, sem IA paga.
// A regra de "qual registro conta cabeça" vive em ind_abate_regra e é HIPÓTESE até a validação (selo na tela).
// A aba "Indicadores e metas" mantém o painel genérico do âmbito abate (PainelAmbito), com as Metas.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Factory } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { erroAmigavel } from '@/lib/erroAmigavel'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { PainelAmbito } from '@/components/inteligencia/PainelAmbito'

const C = { esp: '#3D2314', off: '#FAF7F2', gold: '#C8941A', gold2: '#E0B048', verde: '#3f7d4e', amarelo: '#B7791F', vermelho: '#C0392B', bd: '#E7DED3', bg2: '#F0ECE3', m: '#6B5D4F', d: '#9C8E80' }

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('pt-BR', o)
const int = (v: number | null | undefined) => v == null ? '—' : nf({ maximumFractionDigits: 0 }).format(v)
const dec1 = (v: number | null | undefined) => v == null ? '—' : nf({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v)
const ton = (kg: number | null | undefined) => kg == null ? '—' : nf({ maximumFractionDigits: 1 }).format(kg / 1000) + ' t'
const pct = (v: number | null | undefined) => v == null ? '—' : `${v > 0 ? '+' : ''}${nf({ maximumFractionDigits: 0 }).format(v)}%`
const hh = (h: number | null | undefined) => h == null ? '—' : `${String(h).padStart(2, '0')}h`
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const dataBR = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-'); return `${dd}/${m}/${y.slice(2)}` }
const diaSemana = (d: string) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(`${d.slice(0, 10)}T12:00:00`).getDay()]
const variacao = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null || b === 0) ? null : (100 * (a - b)) / b

type PerKey = 'hoje' | 'ontem' | '7' | '30' | 'mes' | 'custom'
type VisaoKey = 'hora' | 'dia' | 'turno' | 'mix' | 'metas'
type Gran = 'dia' | 'semana' | 'mes'
type Situacao = 'acima' | 'no_ritmo' | 'abaixo' | null

type Hora = { hora: number; turno: string | null; cabecas: number; dias: number; cab_media: number | null; kg_carcaca: number; kg: number; dias_producao: number; kg_media: number | null; ritmo_pct: number | null; situacao: Situacao; gargalo: boolean | null; gargalo_producao: boolean | null }
type Dia = { dia: string; cabecas: number; terceiros: number; horas: number; cab_hora: number | null; hora_ini: number | null; hora_fim: number | null; pico: number | null; kg_carcaca: number; peso_medio: number | null; kg: number; horas_producao: number; kg_hora: number | null }
type Turno = { turno: string; hora_ini: number | null; hora_fim: number | null; cabecas: number; dias: number; horas: number; cab_hora: number | null; peso_medio: number | null; kg: number; horas_producao: number; kg_hora: number | null; pct_cabecas: number | null }
type Serie = { per: string; hora: number | null; cabecas: number; kg_carcaca: number; kg: number; cab_hora: number | null; kg_hora: number | null }
type Painel = {
  ok: boolean; erro?: string; mensagem?: string
  periodo: { de: string; ate: string; dias: number }
  granularidade: string
  regra: { validado: boolean; validado_por: string | null; validado_em: string | null; propria_empresa: boolean; turno_fonte: string | null }
  meta: { cab_hora: number | null; fonte: 'regra' | 'metas' | null }
  resumo: {
    cabecas: number; dias_abate: number; cab_dia: number | null; horas_abate: number; cab_hora: number | null; cab_hora_pico: number | null; hora_pico: number | null
    kg_carcaca: number; peso_medio: number | null; terceiros: number; femeas: number; machos: number
    kg_produzido: number; un_produzidas: number; produtos: number; horas_producao: number; kg_hora: number | null; kg_por_cabeca: number | null
    gargalo_hora: number | null; gargalo_hora_producao: number | null
  }
  anterior: { de: string; ate: string; cabecas: number; dias_abate: number; cab_hora: number | null; peso_medio: number | null; kg_produzido: number; kg_hora: number | null }
  conferencia: { cab_producao: number; cab_miudos: number | null; diferenca: number | null }
  horas: Hora[]; dias: Dia[]; turnos: Turno[]
  sexo: { sexo: string; cabecas: number; peso_medio: number | null }[]
  mix: { cod: string; produto: string; kg: number; un: number; pct: number | null }[]
  mix_turno: { turno: string; cod: string; produto: string; kg: number; pct: number | null }[]
  serie: Serie[]
}

const PERIODOS: { k: PerKey; rot: string }[] = [
  { k: 'hoje', rot: 'Hoje' }, { k: 'ontem', rot: 'Ontem' }, { k: '7', rot: '7 dias' },
  { k: '30', rot: '30 dias' }, { k: 'mes', rot: 'Este mês' }, { k: 'custom', rot: 'De–até' },
]
const VISOES: { k: VisaoKey; rot: string }[] = [
  { k: 'hora', rot: 'Hora a hora' }, { k: 'dia', rot: 'Dia a dia' }, { k: 'turno', rot: 'Turnos' },
  { k: 'mix', rot: 'Mix de produção' }, { k: 'metas', rot: 'Indicadores e metas' },
]
const COR_SIT: Record<Exclude<Situacao, null>, { cor: string; rot: string; icone: string }> = {
  acima: { cor: C.verde, rot: 'Acima da régua', icone: '▲' },
  no_ritmo: { cor: C.amarelo, rot: 'Até 15% abaixo', icone: '●' },
  abaixo: { cor: C.vermelho, rot: 'Mais de 15% abaixo', icone: '▼' },
}

const card: CSSProperties = { background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 14, padding: 16 }
const chip = (ativo: boolean): CSSProperties => ({ padding: '6px 14px', minHeight: 34, borderRadius: 999, fontSize: 13, cursor: 'pointer', border: `1px solid ${ativo ? C.gold : C.bd}`, background: ativo ? C.gold : '#fff', color: ativo ? '#fff' : C.esp, fontWeight: ativo ? 600 : 400, whiteSpace: 'nowrap' })
const th: CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 12, color: C.m, fontWeight: 600, borderBottom: `1px solid ${C.bd}`, whiteSpace: 'nowrap' }
const td: CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, color: C.esp, borderBottom: `1px solid ${C.bg2}`, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }

// ───────────── leitura determinística (frase-resumo + achados) ─────────────
function leitura(p: Painel): { frase: string; achados: string[] } {
  const r = p.resumo
  if (!r.cabecas && !r.kg_produzido) return { frase: 'Nenhum abate nem produção registrados neste período.', achados: [] }
  const ref = p.meta.cab_hora ?? r.cab_hora
  const partes: string[] = []
  partes.push(`${int(r.cabecas)} cabeças em ${r.dias_abate} dia${r.dias_abate === 1 ? '' : 's'} de abate (${dec1(r.cab_dia)} por dia)`)
  if (r.cab_hora != null) {
    partes.push(p.meta.cab_hora != null
      ? `ritmo de ${dec1(r.cab_hora)} cab/h contra meta de ${dec1(p.meta.cab_hora)} (${r.cab_hora >= p.meta.cab_hora ? 'na meta' : `${pct(variacao(r.cab_hora, p.meta.cab_hora))}`})`
      : `ritmo de ${dec1(r.cab_hora)} cab/h`)
  }
  if (r.kg_produzido) partes.push(`${ton(r.kg_produzido)} produzidas a ${int(r.kg_hora)} kg/h`)
  const frase = partes.join(', ') + '.'
  const achados: string[] = []
  const g = p.horas.find((h) => h.gargalo)
  if (g && g.cab_media != null && ref) achados.push(`O gargalo do abate é às ${hh(g.hora)}: média de ${dec1(g.cab_media)} cab/h, ${int(100 - (100 * g.cab_media) / ref)}% abaixo da régua.`)
  if (r.hora_pico != null) achados.push(`A hora mais forte é ${hh(r.hora_pico)}, com ${dec1(r.cab_hora_pico)} cab/h em média.`)
  const gp = p.horas.find((h) => h.gargalo_producao)
  if (gp) achados.push(`Na produção, a hora mais fraca da linha é ${hh(gp.hora)} (${int(gp.kg_media)} kg/h em média).`)
  const dv = variacao(r.cabecas, p.anterior.cabecas)
  if (dv != null && Math.abs(dv) >= 5) achados.push(`Cabeças ${dv > 0 ? 'subiram' : 'caíram'} ${pct(Math.abs(dv)).replace('+', '')} contra o período anterior (${int(p.anterior.cabecas)}).`)
  const ts = p.turnos.filter((t) => t.cabecas > 0 && t.cab_hora != null).sort((a, b) => (b.cab_hora ?? 0) - (a.cab_hora ?? 0))
  if (ts.length >= 2) achados.push(`${ts[0].turno} roda a ${dec1(ts[0].cab_hora)} cab/h e ${ts[ts.length - 1].turno} a ${dec1(ts[ts.length - 1].cab_hora)} cab/h.`)
  const fracos = p.dias.filter((d) => d.cabecas > 0 && d.cab_hora != null && ref && d.cab_hora < 0.85 * ref)
  if (fracos.length && p.dias.length > 1) achados.push(`${fracos.length} dia${fracos.length === 1 ? '' : 's'} com ritmo mais de 15% abaixo da régua (o pior: ${dataBR(fracos.sort((a, b) => (a.cab_hora ?? 0) - (b.cab_hora ?? 0))[0].dia)}).`)
  if (r.terceiros > 0) achados.push(`${int(r.terceiros)} cabeças (${dec1((100 * r.terceiros) / r.cabecas)}%) são abate de terceiros.`)
  return { frase, achados }
}

// ───────────── peças de tela ─────────────
function Kpi({ titulo, chave, valor, sub, situacao, delta }: { titulo: string; chave: string; valor: string; sub?: ReactNode; situacao?: Situacao; delta?: number | null }) {
  const s = situacao ? COR_SIT[situacao] : null
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6, borderTop: `3px solid ${s ? s.cor : C.gold}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.m, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {titulo}<AjudaCampo chave={chave} />
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: C.esp, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
      {s && <div style={{ fontSize: 12, color: s.cor, fontWeight: 600 }}>{s.icone} {s.rot}</div>}
      {delta != null && <div style={{ fontSize: 12, color: C.m }}>{pct(delta)} vs período anterior <AjudaCampo chave="industria.bi_abate.comparativo" /></div>}
      {sub && <div style={{ fontSize: 12, color: C.d }}>{sub}</div>}
    </div>
  )
}

function Titulo({ children, chave }: { children: ReactNode; chave: string }) {
  return <h3 style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 12px', fontSize: 15, color: C.esp, fontWeight: 700 }}>{children}<AjudaCampo chave={chave} /></h3>
}

function Legenda() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: C.m, marginTop: 8 }}>
      {(Object.keys(COR_SIT) as Exclude<Situacao, null>[]).map((k) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: COR_SIT[k].cor }} />{COR_SIT[k].icone} {COR_SIT[k].rot}
        </span>
      ))}
    </div>
  )
}

function DicaGrafico({ active, payload, label, linhas }: { active?: boolean; payload?: { payload: Record<string, unknown> }[]; label?: string | number; linhas: (d: Record<string, unknown>) => string[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: '#fff', border: `1px solid ${C.bd}`, borderRadius: 10, padding: '8px 12px', fontSize: 12, color: C.esp, boxShadow: '0 4px 14px rgba(61,35,20,.12)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {linhas(d).map((l) => <div key={l}>{l}</div>)}
    </div>
  )
}

// ───────────── visões ─────────────
function VisaoHora({ p }: { p: Painel }) {
  const ref = p.meta.cab_hora ?? p.resumo.cab_hora
  const dadosAb = p.horas.filter((h) => h.cab_media != null).map((h) => ({ ...h, rot: hh(h.hora) }))
  const dadosPr = p.horas.filter((h) => h.kg_media != null).map((h) => ({ ...h, rot: hh(h.hora) }))
  // mapa dia × hora: a série vem por (dia, hora) quando a granularidade é "hora"
  const mapa = useMemo(() => {
    const dias = [...new Set(p.serie.filter((s) => s.hora != null).map((s) => s.per))].sort()
    const horas = [...new Set(p.serie.filter((s) => s.hora != null && s.cabecas > 0).map((s) => s.hora as number))].sort((a, b) => a - b)
    const val = new Map(p.serie.map((s) => [`${s.per}|${s.hora}`, s.cabecas]))
    const max = Math.max(1, ...p.serie.map((s) => s.cabecas))
    return { dias, horas, val, max }
  }, [p.serie])
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <Titulo chave="industria.bi_abate.cab_hora">Cabeças por hora do dia (média dos dias com abate)</Titulo>
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={dadosAb} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bg2} />
              <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: C.m }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: C.bg2 }} content={(t) => <DicaGrafico {...(t as object)} linhas={(d) => [
                `${dec1(d.cab_media as number)} cab/h em média`, `${int(d.cabecas as number)} cabeças em ${d.dias} dia(s)`,
                `${d.ritmo_pct ?? '—'}% da régua`, ...(d.gargalo ? ['Gargalo do abate'] : [])]} />} />
              {ref != null && <ReferenceLine y={ref} stroke={C.esp} strokeDasharray="4 4" label={{ value: `${p.meta.cab_hora != null ? 'meta' : 'média'} ${dec1(ref)}`, position: 'insideTopRight', fontSize: 11, fill: C.m }} />}
              <Bar dataKey="cab_media" radius={[4, 4, 0, 0]} maxBarSize={34}>
                {dadosAb.map((h) => <Cell key={h.hora} fill={h.situacao ? COR_SIT[h.situacao].cor : C.gold} stroke={h.gargalo ? C.esp : undefined} strokeWidth={h.gargalo ? 2 : 0} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <Legenda />
      </div>

      <div style={card}>
        <Titulo chave="industria.bi_abate.kg_hora">Kg produzidos por hora do dia (média)</Titulo>
        <div style={{ height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={dadosPr} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bg2} />
              <XAxis dataKey="rot" tick={{ fontSize: 12, fill: C.m }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: C.m }} axisLine={false} tickLine={false} tickFormatter={(v: number) => int(v)} />
              <Tooltip cursor={{ fill: C.bg2 }} content={(t) => <DicaGrafico {...(t as object)} linhas={(d) => [
                `${int(d.kg_media as number)} kg/h em média`, `${int(d.kg as number)} kg em ${d.dias_producao} dia(s)`, ...(d.gargalo_producao ? ['Hora mais fraca da produção'] : [])]} />} />
              <Bar dataKey="kg_media" radius={[4, 4, 0, 0]} maxBarSize={34}>
                {dadosPr.map((h) => <Cell key={h.hora} fill={h.gargalo_producao ? C.vermelho : C.gold} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {mapa.dias.length > 0 && mapa.horas.length > 0 && (
        <div style={card}>
          <Titulo chave="industria.bi_abate.mapa">Mapa dia × hora (cabeças)</Titulo>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 2 }}>
              <thead><tr><th style={{ ...th, textAlign: 'left', border: 'none' }}>Dia</th>{mapa.horas.map((h) => <th key={h} style={{ ...th, border: 'none', textAlign: 'center', padding: '4px 2px' }}>{hh(h)}</th>)}</tr></thead>
              <tbody>
                {mapa.dias.map((d) => (
                  <tr key={d}>
                    <td style={{ ...td, textAlign: 'left', border: 'none', fontSize: 12 }}>{diaSemana(d)} {dataBR(d)}</td>
                    {mapa.horas.map((h) => {
                      const v = mapa.val.get(`${d}|${h}`) ?? 0
                      const a = v ? 0.15 + 0.85 * (v / mapa.max) : 0
                      return <td key={h} title={`${dataBR(d)} ${hh(h)}: ${int(v)} cabeças`} style={{ width: 34, height: 26, minWidth: 30, borderRadius: 4, textAlign: 'center', fontSize: 11, background: v ? `rgba(200,148,26,${a.toFixed(2)})` : C.off, color: a > 0.6 ? '#fff' : C.esp, fontVariantNumeric: 'tabular-nums' }}>{v ? int(v) : ''}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={card}>
        <Titulo chave="industria.bi_abate.gargalo">Tabela hora a hora</Titulo>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Hora</th><th style={{ ...th, textAlign: 'left' }}>Turno</th><th style={th}>Cabeças</th><th style={th}>Dias</th>
              <th style={th}>Cab/h média</th><th style={th}>% da régua</th><th style={{ ...th, textAlign: 'left' }}>Situação</th><th style={th}>Kg produzidos</th><th style={th}>Kg/h média</th>
            </tr></thead>
            <tbody>
              {p.horas.map((h) => (
                <tr key={h.hora} style={{ background: h.gargalo ? '#FBEDEB' : undefined }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{hh(h.hora)}{h.gargalo ? ' · gargalo' : ''}</td>
                  <td style={{ ...td, textAlign: 'left', color: C.m }}>{h.turno ?? '—'}</td>
                  <td style={td}>{int(h.cabecas)}</td><td style={td}>{h.dias || '—'}</td><td style={td}>{dec1(h.cab_media)}</td>
                  <td style={td}>{h.ritmo_pct == null ? '—' : `${h.ritmo_pct}%`}</td>
                  <td style={{ ...td, textAlign: 'left', color: h.situacao ? COR_SIT[h.situacao].cor : C.d, fontWeight: 600 }}>{h.situacao ? `${COR_SIT[h.situacao].icone} ${COR_SIT[h.situacao].rot}` : '—'}</td>
                  <td style={td}>{int(h.kg)}</td><td style={td}>{int(h.kg_media)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function VisaoDia({ p, gran, setGran }: { p: Painel; gran: Gran; setGran: (g: Gran) => void }) {
  const ref = p.meta.cab_hora ?? p.resumo.cab_hora
  const serie = p.serie.map((s) => ({ ...s, rot: gran === 'mes' ? s.per.slice(5, 7) + '/' + s.per.slice(2, 4) : (gran === 'semana' ? 'sem ' : '') + dataBR(s.per).slice(0, 5) }))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <Titulo chave="industria.bi_abate.cabecas">Cabeças abatidas por {gran === 'dia' ? 'dia' : gran === 'semana' ? 'semana' : 'mês'}</Titulo>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.m }}>
            Agrupar por <AjudaCampo chave="industria.bi_abate.granularidade" />
            <select value={gran} onChange={(e) => setGran(e.target.value as Gran)} style={{ padding: '6px 10px', minHeight: 34, borderRadius: 8, border: `1px solid ${C.bd}`, color: C.esp, background: '#fff', fontSize: 13 }}>
              <option value="dia">Dia</option><option value="semana">Semana</option><option value="mes">Mês</option>
            </select>
          </label>
        </div>
        <div style={{ height: 250 }}>
          <ResponsiveContainer>
            <BarChart data={serie} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={C.bg2} />
              <XAxis dataKey="rot" tick={{ fontSize: 11, fill: C.m }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 12, fill: C.m }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: C.bg2 }} content={(t) => <DicaGrafico {...(t as object)} linhas={(d) => [
                `${int(d.cabecas as number)} cabeças`, `${dec1(d.cab_hora as number)} cab/h`, `${int(d.kg as number)} kg produzidos`]} />} />
              <Bar dataKey="cabecas" fill={C.gold} radius={[4, 4, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={card}>
        <Titulo chave="industria.bi_abate.comparativo">Dia contra dia</Titulo>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Dia</th><th style={th}>Cabeças</th><th style={th}>Terceiros</th><th style={th}>Horas</th><th style={th}>Início–fim</th>
              <th style={th}>Cab/h</th><th style={th}>Pico na hora</th><th style={th}>Peso médio</th><th style={th}>Kg produzidos</th><th style={th}>Kg/h</th>
            </tr></thead>
            <tbody>
              {p.dias.map((d) => {
                const fraco = ref != null && d.cab_hora != null && d.cab_hora < 0.85 * ref
                return (
                  <tr key={d.dia}>
                    <td style={{ ...td, textAlign: 'left', fontWeight: 600 }}>{diaSemana(d.dia)} {dataBR(d.dia)}</td>
                    <td style={td}>{int(d.cabecas)}</td><td style={td}>{d.terceiros ? int(d.terceiros) : '—'}</td><td style={td}>{d.horas || '—'}</td>
                    <td style={td}>{d.hora_ini == null ? '—' : `${hh(d.hora_ini)}–${hh(d.hora_fim)}`}</td>
                    <td style={{ ...td, color: fraco ? C.vermelho : C.esp, fontWeight: fraco ? 700 : 400 }}>{fraco ? '▼ ' : ''}{dec1(d.cab_hora)}</td>
                    <td style={td}>{int(d.pico)}</td><td style={td}>{dec1(d.peso_medio)}</td><td style={td}>{int(d.kg)}</td><td style={td}>{int(d.kg_hora)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function VisaoTurno({ p }: { p: Painel }) {
  const fonte = p.regra.turno_fonte ?? ''
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {fonte.includes('faixa_hora') && (
        <div style={{ ...card, background: C.off, fontSize: 13, color: C.m }}>
          O sistema de origem não envia o turno e o cadastro de turnos não tem horário. A separação abaixo é por faixa de hora (manhã até 12h, tarde até 18h, noite depois). Cadastre o horário dos turnos para ela ficar exata.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {p.turnos.map((t) => (
          <div key={t.turno} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontWeight: 700, color: C.esp, marginBottom: 4 }}>{t.turno}<AjudaCampo chave="industria.bi_abate.turno" /></div>
            <div style={{ fontSize: 12, color: C.d, marginBottom: 10 }}>{t.hora_ini == null ? '—' : `${hh(t.hora_ini)} a ${hh(t.hora_fim)}`}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
              <div><div style={{ color: C.m, fontSize: 11 }}>Cabeças</div><b>{int(t.cabecas)}</b> <span style={{ color: C.d }}>({dec1(t.pct_cabecas)}%)</span></div>
              <div><div style={{ color: C.m, fontSize: 11 }}>Cab/h</div><b>{dec1(t.cab_hora)}</b></div>
              <div><div style={{ color: C.m, fontSize: 11 }}>Peso médio</div><b>{dec1(t.peso_medio)} kg</b></div>
              <div><div style={{ color: C.m, fontSize: 11 }}>Kg/h produção</div><b>{int(t.kg_hora)}</b></div>
              <div><div style={{ color: C.m, fontSize: 11 }}>Kg produzidos</div><b>{ton(t.kg)}</b></div>
              <div><div style={{ color: C.m, fontSize: 11 }}>Horas com abate</div><b>{int(t.horas)}</b></div>
            </div>
          </div>
        ))}
      </div>
      {p.mix_turno.length > 0 && (
        <div style={card}>
          <Titulo chave="industria.bi_abate.mix">Mix por turno (5 maiores produtos de cada)</Titulo>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
            {[...new Set(p.mix_turno.map((m) => m.turno))].map((tn) => (
              <div key={tn}>
                <div style={{ fontWeight: 700, fontSize: 13, color: C.esp, marginBottom: 6 }}>{tn}</div>
                {p.mix_turno.filter((m) => m.turno === tn).map((m) => <BarraMix key={m.cod} rot={m.produto} pct={m.pct} valor={`${int(m.kg)} kg`} />)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BarraMix({ rot, pct: v, valor }: { rot: string; pct: number | null; valor: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: C.esp }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rot}>{rot}</span>
        <span style={{ color: C.m, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{valor} · {dec1(v)}%</span>
      </div>
      <div style={{ height: 6, background: C.bg2, borderRadius: 4, marginTop: 3 }}><div style={{ width: `${Math.min(100, v ?? 0)}%`, height: 6, background: C.gold, borderRadius: 4 }} /></div>
    </div>
  )
}

function VisaoMix({ p }: { p: Painel }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
      <div style={card}>
        <Titulo chave="industria.bi_abate.mix">Produtos com mais kg produzidos</Titulo>
        {p.mix.length === 0 ? <div style={{ color: C.d, fontSize: 13 }}>Sem produção registrada no período.</div>
          : p.mix.map((m) => <BarraMix key={m.cod} rot={m.produto} pct={m.pct} valor={`${int(m.kg)} kg`} />)}
        <div style={{ fontSize: 12, color: C.d, marginTop: 6 }}>{int(p.resumo.produtos)} produtos no período · {ton(p.resumo.kg_produzido)} no total</div>
      </div>
      <div style={card}>
        <Titulo chave="industria.bi_abate.peso_medio">Abate por sexo</Titulo>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>Sexo</th><th style={th}>Cabeças</th><th style={th}>%</th><th style={th}>Peso médio</th></tr></thead>
          <tbody>
            {p.sexo.map((s) => (
              <tr key={s.sexo}>
                <td style={{ ...td, textAlign: 'left' }}>{s.sexo === 'F' ? 'Fêmeas' : s.sexo === 'M' ? 'Machos' : 'Não informado'}</td>
                <td style={td}>{int(s.cabecas)}</td><td style={td}>{dec1(p.resumo.cabecas ? (100 * s.cabecas) / p.resumo.cabecas : null)}</td><td style={td}>{dec1(s.peso_medio)} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ───────────── tela ─────────────
export default function AbateBIPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null
  const hojeISO = iso(new Date())
  const [per, setPer] = useState<PerKey>('7')
  const [deC, setDeC] = useState(hojeISO)
  const [ateC, setAteC] = useState(hojeISO)
  const [visao, setVisao] = useState<VisaoKey>('hora')
  const [gran, setGran] = useState<Gran>('dia')
  const [dados, setDados] = useState<Painel | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const intervalo = useMemo(() => {
    const hoje = new Date(); const ate = iso(hoje)
    const menos = (n: number) => { const d = new Date(hoje); d.setDate(d.getDate() - n); return iso(d) }
    if (per === 'hoje') return { de: ate, ate }
    if (per === 'ontem') return { de: menos(1), ate: menos(1) }
    if (per === '30') return { de: menos(29), ate }
    if (per === 'mes') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), ate }
    if (per === 'custom') return { de: deC <= ateC ? deC : ateC, ate: deC <= ateC ? ateC : deC }
    return { de: menos(6), ate }
  }, [per, deC, ateC])

  // A grade dia × hora só existe na visão hora a hora; nas outras a série segue o "Agrupar por".
  const granPedida = visao === 'hora' ? 'hora' : gran
  const carregar = useCallback(async () => {
    if (!empresa || visao === 'metas') return
    setCarregando(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_bi_abate_painel', { p_company_id: empresa, p_dt_ini: intervalo.de, p_dt_fim: intervalo.ate, p_granularidade: granPedida })
    setCarregando(false)
    if (error) { setErro(erroAmigavel(error)); setDados(null); return }
    const p = data as Painel
    if (!p?.ok) { setErro(p?.mensagem ?? 'Sem acesso ao abate desta empresa.'); setDados(null); return }
    setDados(p)
  }, [empresa, intervalo, granPedida, visao])
  // adia um tique: troca rápida de período/visão cancela a busca anterior antes de ela começar
  useEffect(() => { const t = setTimeout(() => { void carregar() }, 0); return () => clearTimeout(t) }, [carregar])

  const lr = useMemo(() => (dados ? leitura(dados) : null), [dados])
  const r = dados?.resumo
  const ref = dados ? (dados.meta.cab_hora ?? null) : null
  const sitRitmo: Situacao = r?.cab_hora != null && ref != null ? (r.cab_hora >= ref ? 'acima' : r.cab_hora >= 0.85 * ref ? 'no_ritmo' : 'abaixo') : null

  return (
    <div style={{ background: C.off, minHeight: '100vh', padding: '20px clamp(12px, 3vw, 32px) 48px', color: C.esp }}>
      {/* cabeçalho */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Factory size={22} color={C.gold} />
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Abate e produção · dia e hora a hora</h1>
          </div>
          <div style={{ fontSize: 13, color: C.m, marginTop: 4 }}>Cabeças, ritmo, gargalo, peso médio e mix, direto do sistema de produção (só leitura).</div>
        </div>
        {dados && !dados.regra.validado && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, background: '#FFF6E5', border: `1px solid ${C.gold2}`, color: C.amarelo, fontSize: 12, fontWeight: 600 }}>
            ● Contagem de cabeças em validação <AjudaCampo chave="industria.bi_abate.conferencia" />
          </div>
        )}
      </div>

      {/* filtros: período e visão numa linha só, acima de tudo */}
      <div style={{ ...card, display: 'grid', gap: 12, marginBottom: 16, padding: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.m, fontWeight: 600, marginRight: 4 }}>Período <AjudaCampo chave="industria.bi_abate.periodo" /></span>
          {PERIODOS.map((x) => <button key={x.k} type="button" onClick={() => setPer(x.k)} style={chip(per === x.k)}>{x.rot}</button>)}
          {per === 'custom' && (
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.m }}>
                De <AjudaCampo chave="industria.bi_abate.periodo" />
                <input type="date" value={deC} max={hojeISO} onChange={(e) => setDeC(e.target.value)} style={{ padding: '5px 8px', minHeight: 34, borderRadius: 8, border: `1px solid ${C.bd}`, color: C.esp }} />
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.m }}>
                até <AjudaCampo chave="industria.bi_abate.periodo" />
                <input type="date" value={ateC} max={hojeISO} onChange={(e) => setAteC(e.target.value)} style={{ padding: '5px 8px', minHeight: 34, borderRadius: 8, border: `1px solid ${C.bd}`, color: C.esp }} />
              </label>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.m, fontWeight: 600, marginRight: 4 }}>Visão <AjudaCampo chave="industria.bi_abate.visao" /></span>
          {VISOES.map((x) => <button key={x.k} type="button" onClick={() => setVisao(x.k)} style={chip(visao === x.k)}>{x.rot}</button>)}
        </div>
      </div>

      {visao === 'metas' ? (
        <PainelAmbito
          ambito="abate"
          titulo="Indicadores e metas do abate"
          subtitulo="Cabeças · carcaça · arrobas · rastreio — com as metas do âmbito"
          icone={<Factory size={20} />}
          tiers={[
            { titulo: 'Rendimento de carcaça (REN)', motivo: 'Aguardando o peso vivo na recepção/compra — sem ele o % carcaça/vivo não fecha.' },
            { titulo: 'Recepção (QPA · TDP · TCR · OBA)', motivo: 'Aguardando os dados de entrada de gado (curral, jejum, mortes).' },
          ]}
        />
      ) : !empresa ? (
        <div style={{ ...card, textAlign: 'center', color: C.m }}>Escolha uma empresa no seletor do topo para ver o abate dela.</div>
      ) : erro ? (
        <div style={{ ...card, borderColor: C.vermelho, color: C.vermelho, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <span>{erro}</span>
          <button type="button" onClick={() => void carregar()} style={chip(true)}>Tentar de novo</button>
        </div>
      ) : !dados ? (
        <div style={{ ...card, textAlign: 'center', color: C.m }}>{carregando ? 'Carregando o abate do período…' : 'Sem dados.'}</div>
      ) : (
        <div style={{ display: 'grid', gap: 16, opacity: carregando ? 0.55 : 1, transition: 'opacity .2s' }}>
          {/* leitura */}
          <div style={{ ...card, background: C.esp, color: '#fff', borderColor: C.esp }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: C.gold2, fontWeight: 700, marginBottom: 6 }}>
              Leitura de {dataBR(dados.periodo.de)} a {dataBR(dados.periodo.ate)}
            </div>
            <div style={{ fontSize: 17, lineHeight: 1.45, fontWeight: 600 }}>{lr?.frase}</div>
            {!!lr?.achados.length && (
              <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 14, lineHeight: 1.6, color: '#F3E9DA' }}>
                {lr.achados.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}
          </div>

          {/* indicadores */}
          {r && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
              <Kpi titulo="Cabeças" chave="industria.bi_abate.cabecas" valor={int(r.cabecas)} delta={variacao(r.cabecas, dados.anterior.cabecas)} sub={`${dec1(r.cab_dia)} por dia · ${r.dias_abate} dia(s)`} />
              <Kpi titulo="Cab/h" chave="industria.bi_abate.cab_hora" valor={dec1(r.cab_hora)} situacao={sitRitmo} delta={variacao(r.cab_hora, dados.anterior.cab_hora)}
                sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{ref != null ? `Meta ${dec1(ref)} cab/h` : 'Sem meta cadastrada'}<AjudaCampo chave="industria.bi_abate.meta" /></span>} />
              <Kpi titulo="Gargalo do abate" chave="industria.bi_abate.gargalo" valor={hh(r.gargalo_hora)} sub={r.hora_pico != null ? `Pico às ${hh(r.hora_pico)} (${dec1(r.cab_hora_pico)} cab/h)` : undefined} />
              <Kpi titulo="Kg/h produção" chave="industria.bi_abate.kg_hora" valor={int(r.kg_hora)} delta={variacao(r.kg_hora, dados.anterior.kg_hora)} sub={`${ton(r.kg_produzido)} em ${r.horas_producao} h`} />
              <Kpi titulo="Peso médio" chave="industria.bi_abate.peso_medio" valor={`${dec1(r.peso_medio)} kg`} delta={variacao(r.peso_medio, dados.anterior.peso_medio)} sub={`${ton(r.kg_carcaca)} de carcaça`} />
              <Kpi titulo="Kg por cabeça" chave="industria.bi_abate.kg_por_cabeca" valor={dec1(r.kg_por_cabeca)} sub="Produção ÷ cabeças do período" />
              <Kpi titulo="Conferência" chave="industria.bi_abate.conferencia"
                valor={dados.conferencia.diferenca == null ? '—' : dados.conferencia.diferenca === 0 ? 'Bate' : `${dados.conferencia.diferenca > 0 ? '+' : ''}${int(dados.conferencia.diferenca)}`}
                sub={`Romaneio ${int(dados.conferencia.cab_producao)} · miúdos ${int(dados.conferencia.cab_miudos)}`} />
            </div>
          )}

          {visao === 'hora' && <VisaoHora p={dados} />}
          {visao === 'dia' && <VisaoDia p={dados} gran={gran} setGran={setGran} />}
          {visao === 'turno' && <VisaoTurno p={dados} />}
          {visao === 'mix' && <VisaoMix p={dados} />}
        </div>
      )}
    </div>
  )
}
