'use client'
// Aba Codes · "Pronto e validado por vertical ao longo dos dias" (CEO 22/11, caixa e7cf025c).
// É um gráfico NOVO, LOGO ABAIXO do de colunas (BarrasQualidadeVertical) — não o substitui (complemento CEO 22/11 11:18).
// Linha por vertical: X = dias, Y = % de requisitos ESSENCIAIS que um AUDITOR já validou (não o construído do dev).
// Abaixo, a tabela "Qual priorizar": % hoje, ritmo de 7 dias, previsão de 100% e essenciais faltando; a vertical que
// mais precisa de reforço (muitos faltando, pouco ritmo) vai em dourado. Fonte: fn_vertical_progresso_serie. Só leitura.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F', OURO = '#B98900'
const ROTA = '/dashboard/dev/codes'
// Paleta PS com tons distinguíveis (uma cor por vertical).
const CORES = ['#B98900', '#166534', '#1D4ED8', '#B91C1C', '#7C3AED', '#0E7490', '#C2410C', '#3D2314', '#DB2777', '#4D7C0F']
// Rótulo curto por slug do blueprint (hub_projetos, ehs… diferem dos slugs do gráfico de colunas).
const NOME: Record<string, string> = {
  hub_projetos: 'Hub', gestao_empresarial: 'Gestão', ehs: 'EHS', revenda_veiculos: 'Revenda', pm: 'P&M',
  corretora_seguros: 'Corretora', ecommerce: 'E-commerce', industria: 'Indústria',
}
const nomeVertical = (s: string) => NOME[s] ?? s.replace(/_/g, ' ')
const num = (v: number | string | null | undefined): number => (v === null || v === undefined || v === '' ? 0 : Number(v))

type Ponto = {
  dia: string; vertical: string; pct_ess_validado: number | string | null; pct_validado: number | string | null
  ess_validados: number; ess_total: number; req_validados: number; req_total: number
}
type Medida = 'ess' | 'todos'

const dataBR = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`
const somaDias = (iso: string, dias: number) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + Math.round(dias)); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` }
const diffDias = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

// Um resumo "qual priorizar" por vertical, a partir da série.
type Resumo = {
  vertical: string; rotulo: string; pctHoje: number; faltamEss: number
  ritmoSemana: number | null; medindoDias: number | null; previsao: string; reforco: boolean
}

export default function ProgressoValidadoVertical() {
  const [serie, setSerie] = useState<Ponto[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [medida, setMedida] = useState<Medida>('ess')
  const [periodo, setPeriodo] = useState<7 | 30 | 90>(30)
  const [ocultas, setOcultas] = useState<Set<string>>(new Set())

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_vertical_progresso_serie', { p_dias: 90 })
    if (error) { setErro(error.message); return }
    const d = data as { ok?: boolean; erro?: string; serie?: Ponto[] }
    if (d?.ok === false) { setErro(d.erro === 'sem_acesso' ? 'Acesso restrito à equipe PS.' : (d.erro ?? 'sem dados')); return }
    setErro(null); setSerie((d?.serie ?? []) as Ponto[])
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carregar() só altera estado após o await
    void carregar()
    const i = setInterval(() => void carregar(), 120_000)
    return () => clearInterval(i)
  }, [carregar])

  const valor = useCallback((p: Ponto) => num(medida === 'ess' ? p.pct_ess_validado : p.pct_validado), [medida])

  // Verticais presentes (ordem por % de hoje, maior primeiro).
  const verticais = useMemo(() => {
    const mapa = new Map<string, Ponto>() // último ponto por vertical (= hoje, a série vem ordenada por dia)
    for (const p of serie ?? []) mapa.set(p.vertical, p)
    return [...mapa.entries()].sort((a, b) => valor(b[1]) - valor(a[1])).map(([v]) => v)
  }, [serie, valor])

  // Pontos do gráfico: um registro por dia, com uma coluna por vertical (dentro do período escolhido).
  const dados = useMemo(() => {
    if (!serie?.length) return [] as Array<Record<string, number | string | null>>
    const dias = [...new Set(serie.map((p) => p.dia))].sort()
    const ultimo = dias[dias.length - 1]
    const corte = somaDias(ultimo, -periodo).split('/').reverse().join('-') // dd/mm/yyyy -> yyyy-mm-dd
    const janela = dias.filter((d) => d >= corte)
    const porDiaVert = new Map<string, Ponto>()
    for (const p of serie) porDiaVert.set(`${p.dia}|${p.vertical}`, p)
    return janela.map((dia) => {
      const linha: Record<string, number | string | null> = { dia: dataBR(dia) }
      for (const v of verticais) {
        const p = porDiaVert.get(`${dia}|${v}`)
        linha[v] = p ? valor(p) : null
      }
      return linha
    })
  }, [serie, verticais, periodo, valor])

  // Tabela "Qual priorizar".
  const resumos = useMemo<Resumo[]>(() => {
    if (!serie?.length) return []
    const porVert = new Map<string, Ponto[]>()
    for (const p of serie) { const a = porVert.get(p.vertical) ?? []; a.push(p); porVert.set(p.vertical, a) }
    const out: Resumo[] = []
    for (const v of verticais) {
      const pts = (porVert.get(v) ?? []).slice().sort((a, b) => a.dia.localeCompare(b.dia))
      const hoje = pts[pts.length - 1]
      const pctHoje = valor(hoje)
      const faltamEss = Math.max(0, num(hoje.ess_total) - num(hoje.ess_validados))
      // ritmo: do ponto mais antigo dentro dos últimos 7 dias até hoje.
      const corte7 = somaDias(hoje.dia, -7).split('/').reverse().join('-')
      const janela = pts.filter((p) => p.dia >= corte7)
      let ritmoSemana: number | null = null, medindoDias: number | null = null, previsao = 'sem ritmo'
      const dd = janela.length >= 2 ? diffDias(janela[0].dia, hoje.dia) : 0
      if (dd <= 0) { medindoDias = janela.length } // histórico de 1 dia na janela
      else {
        ritmoSemana = Math.round(((valor(hoje) - valor(janela[0])) / dd) * 7 * 10) / 10
        if (ritmoSemana > 0.05) { previsao = somaDias(hoje.dia, ((100 - pctHoje) / (ritmoSemana / 7))) }
      }
      out.push({ vertical: v, rotulo: nomeVertical(v), pctHoje, faltamEss, ritmoSemana, medindoDias, previsao, reforco: false })
    }
    // reforço = mais essenciais faltando com menos ritmo (score = faltam / (1 + ritmo positivo)).
    let melhor = -1, idx = -1
    out.forEach((r, i) => { if (r.faltamEss > 0) { const s = r.faltamEss / (1 + Math.max(0, r.ritmoSemana ?? 0)); if (s > melhor) { melhor = s; idx = i } } })
    if (idx >= 0) out[idx].reforco = true
    return out
  }, [serie, verticais, valor])

  const alternarLinha = (v: string) => setOcultas((prev) => { const n = new Set(prev); n.has(v) ? n.delete(v) : n.add(v); return n })

  const btn = (ativo: boolean): CSSProperties => ({
    fontSize: 11, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${ativo ? ESP : BD}`, background: ativo ? ESP : BRANCO, color: ativo ? BRANCO : TXM,
  })

  return (
    <section data-testid="codes-progresso-validado" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 12, color: ESP }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
          Pronto e validado por vertical <AjudaCampo chave="dev.codes.progresso_validado" rota={ROTA} />
        </h3>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button type="button" style={btn(medida === 'ess')} onClick={() => setMedida('ess')}>Essenciais</button>
          <button type="button" style={btn(medida === 'todos')} onClick={() => setMedida('todos')}>Todos</button>
          <AjudaCampo chave="dev.codes.progresso_validado.medida" rota={ROTA} />
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {([7, 30, 90] as const).map((p) => (
            <button key={p} type="button" style={btn(periodo === p)} onClick={() => setPeriodo(p)}>{p}d</button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 8 }}>
        % de {medida === 'ess' ? 'requisitos essenciais' : 'requisitos'} que um AUDITOR já validou (não o construído do dev). Toque na legenda para esconder uma vertical.
      </div>

      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler o progresso validado: {erro}</div>}
      {!serie && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {serie && dados.length === 0 && !erro && <div style={{ fontSize: 12, color: TXM }}>Sem retrato ainda — a linha aparece a partir do primeiro snapshot do dia.</div>}

      {dados.length > 0 && (
        <>
          {/* legenda clicável */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
            {verticais.map((v, i) => {
              const off = ocultas.has(v)
              return (
                <button key={v} type="button" onClick={() => alternarLinha(v)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: off ? TXM : ESP, opacity: off ? 0.5 : 1 }}
                  aria-pressed={!off} data-testid={`progresso-legenda-${v}`}>
                  <span style={{ width: 12, height: 3, borderRadius: 2, background: CORES[i % CORES.length], textDecoration: off ? 'line-through' : 'none' }} />
                  <span style={{ textDecoration: off ? 'line-through' : 'none' }}>{nomeVertical(v)}</span>
                </button>
              )
            })}
          </div>
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={dados} margin={{ top: 6, right: 10, left: -14, bottom: 4 }}>
                <CartesianGrid stroke={BD} vertical={false} />
                <XAxis dataKey="dia" tick={{ fill: TXM, fontSize: 11 }} minTickGap={16} />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fill: TXM, fontSize: 11 }} width={44} />
                <Tooltip content={<Dica serie={serie} medida={medida} />} />
                {verticais.map((v, i) => (
                  <Line key={v} type="monotone" dataKey={v} name={nomeVertical(v)} hide={ocultas.has(v)}
                    stroke={CORES[i % CORES.length]} strokeWidth={2} dot={dados.length <= 1} connectNulls isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Qual priorizar */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
              Qual priorizar <AjudaCampo chave="dev.codes.progresso_validado.priorizar" rota={ROTA} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table data-testid="codes-progresso-priorizar" style={{ width: '100%', minWidth: 460, borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: TXM, textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px' }}>Vertical</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>% validado</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Ritmo/sem.</th>
                    <th style={{ padding: '4px 8px' }}>Previsão 100%</th>
                    <th style={{ padding: '4px 8px', textAlign: 'right' }}>Essenciais faltando</th>
                  </tr>
                </thead>
                <tbody>
                  {resumos.map((r) => (
                    <tr key={r.vertical} data-testid={`progresso-linha-${r.vertical}`}
                      style={{ borderTop: `1px solid ${BD}`, background: r.reforco ? 'rgba(185,137,0,0.10)' : 'transparent' }}>
                      <td style={{ padding: '4px 8px', fontWeight: r.reforco ? 700 : 400, color: r.reforco ? OURO : ESP }}>
                        {r.rotulo}{r.reforco && <span style={{ marginLeft: 6, fontSize: 10, color: OURO }}>● precisa de reforço</span>}
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>{r.pctHoje.toFixed(1).replace('.', ',')}%</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                        {r.medindoDias !== null ? <span style={{ color: TXM }}>medindo — {r.medindoDias}d</span>
                          : `${(r.ritmoSemana ?? 0) > 0 ? '+' : ''}${(r.ritmoSemana ?? 0).toFixed(1).replace('.', ',')} pp`}
                      </td>
                      <td style={{ padding: '4px 8px', color: r.previsao === 'sem ritmo' ? TXM : ESP }}>{r.previsao}</td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: r.reforco ? 700 : 400 }}>{r.faltamEss}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// Tooltip: por vertical no dia, X validados de N essenciais (ou de N requisitos, na medida "Todos").
function Dica({ active, label, payload, serie, medida }: {
  active?: boolean; label?: string; payload?: Array<{ dataKey: string; value: number | null; color: string }>
  serie: Ponto[] | null; medida: Medida
}) {
  if (!active || !payload?.length || !serie) return null
  const diaBR = label ?? ''
  const porRotulo = new Map<string, Ponto>()
  for (const p of serie) if (dataBR(p.dia) === diaBR) porRotulo.set(p.vertical, p)
  const visiveis = payload.filter((pl) => pl.value !== null)
  if (!visiveis.length) return null
  return (
    <div style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: ESP, maxWidth: 260 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{diaBR}</div>
      {visiveis.map((pl) => {
        const p = porRotulo.get(pl.dataKey)
        const val = p ? num(medida === 'ess' ? p.pct_ess_validado : p.pct_validado) : num(pl.value)
        return (
          <div key={pl.dataKey} style={{ marginBottom: 2 }}>
            <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: pl.color, marginRight: 5 }} />
            <b>{nomeVertical(pl.dataKey)}</b>: {val.toFixed(1).replace('.', ',')}%
            {p && <span style={{ color: TXM }}> — {medida === 'ess' ? `${p.ess_validados} de ${p.ess_total} essenciais` : `${p.req_validados} de ${p.req_total} requisitos`}</span>}
          </div>
        )
      })}
      <div style={{ color: TXM, marginTop: 2 }}>validado pelo auditor</div>
    </div>
  )
}
