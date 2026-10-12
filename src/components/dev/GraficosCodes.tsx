'use client'
// Aba Codes · gráficos de desempenho (CEO 09/10): publicações por hora/dia (total e por Code), pilha de PRs prontas e vazão
// (tempo pronta → publicada). Fonte: erp_dev_entrega (leitura só da equipe PS, RLS). Recarrega a cada 60 s. Regras puras em
// src/lib/dev/desempenhoCodes.ts. Todo indicador tem o "?" (RD-95); sem emoji (ícones de traço fino).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CODES_PAINEL, duracao, type Entrega } from '@/lib/dev/painelCodes'
import { PERIODOS, PERIODO_DIAS, pilhaProntas, publicacoesPorDia, publicacoesPorHora, totalPeriodo, vazaoPorDia, type Periodo } from '@/lib/dev/desempenhoCodes'

const ESP = '#3D2314', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
// paleta sóbria na identidade PS (um tom por Code)
const CORES = ['#3D2314', '#C8941A', '#7A5C3E', '#A67C52', '#8C8C6A', '#5E7C74', '#B08968']
const COLS = 'id,pr_numero,titulo,code,evento,via,sha,url,ocorrido_em'
const ROTA = '/dashboard/dev/codes'

function Cartao({ chave, titulo, resumo, children, testid }: { chave: string; titulo: string; resumo?: string; children: React.ReactNode; testid: string }) {
  return (
    <section data-testid={testid} style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESP }}>{titulo}</h3>
        <AjudaCampo chave={chave} rota={ROTA} />
      </header>
      {resumo && <div style={{ fontSize: 12, color: TXM, marginBottom: 6 }}>{resumo}</div>}
      <div style={{ width: '100%', height: 200 }}>{children}</div>
    </section>
  )
}

export default function GraficosCodes() {
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [entregas, setEntregas] = useState<Entrega[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [agora, setAgora] = useState(() => new Date())

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 35 * 864e5).toISOString()
    const { data, error } = await supabase.from('erp_dev_entrega').select(COLS).gte('ocorrido_em', desde)
      .order('ocorrido_em', { ascending: false }).limit(5000)
    if (error) { setErro(error.message); return }
    setErro(null); setEntregas((data ?? []) as Entrega[]); setAgora(new Date())
  }, [])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(t)
  }, [carregar])

  const dias = PERIODO_DIAS[periodo]
  const serie = useMemo(() => {
    if (!entregas) return null
    const pub = periodo === 'hoje' ? publicacoesPorHora(entregas, agora, 24) : publicacoesPorDia(entregas, agora, dias)
    const codes = CODES_PAINEL.filter((c) => pub.some((p) => p.porCode[c])).concat(
      [...new Set(pub.flatMap((p) => Object.keys(p.porCode)))].filter((c) => !CODES_PAINEL.includes(c)))
    const barras = pub.map((p) => ({ rotulo: p.rotulo, ...p.porCode }))
    return {
      total: totalPeriodo(pub), codes, barras,
      pilha: pilhaProntas(entregas, agora, periodo === 'hoje' ? 24 : dias * 24).map((p) => ({ rotulo: p.rotulo, prontas: p.prontas })),
      vazao: vazaoPorDia(entregas, agora, Math.max(dias, 7)).map((v) => ({ rotulo: v.rotulo, minutos: v.medianaMin })),
    }
  }, [entregas, agora, periodo, dias])

  const eixo = { fontSize: 11, fill: TXM }
  return (
    <div data-testid="codes-graficos" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ESP }}>Desempenho</h3>
        <AjudaCampo chave="dev.codes.graficos.periodo" rota={ROTA} />
        <div role="group" aria-label="Período" style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {PERIODOS.map((p) => (
            <button key={p.id} type="button" onClick={() => setPeriodo(p.id)} aria-pressed={periodo === p.id} data-testid={`codes-periodo-${p.id}`}
              style={{ padding: '6px 12px', minHeight: 36, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${periodo === p.id ? ESP : BD}`, background: periodo === p.id ? ESP : BRANCO, color: periodo === p.id ? BRANCO : ESP }}>
              {p.rotulo}
            </button>
          ))}
        </div>
      </div>
      {erro && <div role="alert" style={{ fontSize: 12, color: TXM, marginBottom: 8 }}>Não consegui ler o histórico: {erro}</div>}
      {!serie ? <div style={{ fontSize: 13, color: TXM }}>Carregando gráficos…</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Cartao testid="grafico-publicacoes" chave="dev.codes.graficos.publicacoes" titulo={periodo === 'hoje' ? 'Publicações por hora' : 'Publicações por dia'}
            resumo={`${serie.total} publicada${serie.total === 1 ? '' : 's'} no período, por Code`}>
            <ResponsiveContainer>
              <BarChart data={serie.barras} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={BD} vertical={false} />
                <XAxis dataKey="rotulo" tick={eixo} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={eixo} />
                <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                {serie.codes.map((c, i) => <Bar key={c} dataKey={c} stackId="p" fill={CORES[i % CORES.length]} />)}
              </BarChart>
            </ResponsiveContainer>
          </Cartao>
          <Cartao testid="grafico-pilha" chave="dev.codes.graficos.pilha" titulo="PRs prontas esperando" resumo="Quantas estavam prontas e ainda não publicadas">
            <ResponsiveContainer>
              <AreaChart data={serie.pilha} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={BD} vertical={false} />
                <XAxis dataKey="rotulo" tick={eixo} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={eixo} />
                <Tooltip /><Area type="stepAfter" dataKey="prontas" name="Prontas" stroke={DOU} fill={DOU} fillOpacity={0.25} />
              </AreaChart>
            </ResponsiveContainer>
          </Cartao>
          <Cartao testid="grafico-vazao" chave="dev.codes.graficos.vazao" titulo="Vazão: pronta → publicada"
            resumo="Mediana do tempo até publicar, por dia (menor é melhor)">
            <ResponsiveContainer>
              <LineChart data={serie.vazao} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={BD} vertical={false} />
                <XAxis dataKey="rotulo" tick={eixo} interval="preserveStartEnd" /><YAxis tick={eixo} />
                <Tooltip formatter={(v) => (typeof v === 'number' ? duracao(v * 6e4) : '—')} />
                <Line type="monotone" dataKey="minutos" name="Mediana" stroke={ESP} strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </Cartao>
        </div>
      )}
    </div>
  )
}
