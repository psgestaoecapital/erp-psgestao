'use client'
// Aba Codes · gráficos de desempenho (CEO 09/10): publicações por hora/dia (total e por Code), pilha de PRs prontas e vazão
// (tempo pronta → publicada). Fonte: erp_dev_entrega (leitura só da equipe PS, RLS). Recarrega a cada 60 s. Regras puras em
// src/lib/dev/desempenhoCodes.ts. Todo indicador tem o "?" (RD-95); sem emoji (ícones de traço fino).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts'
import { supabase } from '@/lib/supabase'
import GraficosHistoricoCodes from './GraficosHistoricoCodes'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { CODES_PAINEL, duracao, type Entrega } from '@/lib/dev/painelCodes'
import { PERIODOS, PERIODO_DIAS, pilhaProntas, producaoPublicacao, resumoProducao, vazaoPorDia, type Periodo, type PontoProducao } from '@/lib/dev/desempenhoCodes'

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

const SEMAFORO = { verde: '#2E7D32', amarelo: '#B7791F', vermelho: '#C62828' } as const

function Numero({ rotulo, valor, chave, testid, cor, extra }: { rotulo: string; valor: number | string; chave: string; testid: string; cor?: string; extra?: string }) {
  return (
    <div data-testid={testid} data-semaforo={extra} style={{ flex: '1 1 100px', border: `1px solid ${cor ?? BD}`, borderRadius: 10, padding: '8px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: TXM }}>{rotulo}<AjudaCampo chave={chave} rota={ROTA} /></div>
      <div style={{ fontSize: 22, fontWeight: 700, color: cor ?? ESP }}>{valor}</div>
    </div>
  )
}

function ListaHora({ pontos, rotulo, onFechar }: { pontos: PontoProducao[]; rotulo: string | null; onFechar: () => void }) {
  const p = rotulo ? pontos.find((x) => x.rotulo === rotulo) : null
  if (!p) return null
  const bloco = (titulo: string, prs: PontoProducao['prsProduzidas']) => (
    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: ESP }}>{titulo} ({prs.length})</div>
      {prs.length === 0 ? <div style={{ fontSize: 12, color: TXM }}>Nenhuma neste período.</div> : prs.map((r) => (
        <div key={r.pr} style={{ fontSize: 12 }}>
          <a href={r.url ?? `https://github.com/psgestaoecapital/erp-psgestao/pull/${r.pr}`} target="_blank" rel="noreferrer" style={{ color: ESP, textDecoration: 'underline' }}>#{r.pr}</a> {r.titulo}
        </div>
      ))}
    </div>
  )
  return (
    <div data-testid="producao-lista" style={{ marginTop: 8, borderTop: `1px solid ${BD}`, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: TXM, marginBottom: 4 }}>
        <span>PRs de {p.rotulo}</span>
        <button type="button" onClick={onFechar} style={{ marginLeft: 'auto', minHeight: 32, padding: '0 10px', border: `1px solid ${BD}`, borderRadius: 8, background: BRANCO, color: ESP, cursor: 'pointer' }}>Fechar</button>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>{bloco('Produzidas', p.prsProduzidas)}{bloco('Publicadas', p.prsPublicadas)}</div>
    </div>
  )
}

/** Produzidas × publicadas COMPACTO (CEO 24/10): vive no topo da aba, ao lado do resumo por Code. Usa as entregas que o painel
 *  já carregou e mantém ao vivo (Realtime) — sem outra consulta. Hoje (por hora) e 7 dias (por dia); 30 dias fica em "Desempenho". */
export function ProducaoCompacta({ entregas, agora }: { entregas: Entrega[]; agora: Date }) {
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [aberto, setAberto] = useState<string | null>(null)
  const prod = useMemo(() => producaoPublicacao(entregas, agora, periodo, null), [entregas, agora, periodo])
  const resumo = useMemo(() => resumoProducao(prod, periodo), [prod, periodo])
  const eixo = { fontSize: 10, fill: TXM }
  return (
    <section data-testid="grafico-publicacoes" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 12, minWidth: 0, color: ESP }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{periodo === 'hoje' ? 'Produzidas × publicadas por hora' : 'Produzidas × publicadas por dia'}</h3>
        <AjudaCampo chave="dev.codes.graficos.publicacoes" rota={ROTA} />
        <div role="group" aria-label="Período" style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {PERIODOS.filter((p) => p.id !== '30d').map((p) => (
            <button key={p.id} type="button" onClick={() => { setPeriodo(p.id); setAberto(null) }} aria-pressed={periodo === p.id} data-testid={`codes-periodo-${p.id}`}
              style={{ padding: '4px 10px', minHeight: 32, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                border: `1px solid ${periodo === p.id ? ESP : BD}`, background: periodo === p.id ? ESP : BRANCO, color: periodo === p.id ? BRANCO : ESP }}>
              {p.rotulo}
            </button>
          ))}
        </div>
      </header>
      <div data-testid="producao-resumo" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <Numero testid="producao-produzidas" rotulo="Produzidas" valor={resumo.produzidas} chave="dev.codes.graficos.produzidas" />
        <Numero testid="producao-publicadas" rotulo="Publicadas" valor={resumo.publicadas} chave="dev.codes.graficos.publicadas" />
        <Numero testid="producao-saldo" rotulo="Saldo" valor={(resumo.saldo > 0 ? '+' : '') + resumo.saldo} chave="dev.codes.graficos.saldo" cor={SEMAFORO[resumo.semaforo]} extra={resumo.semaforo} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: Math.max(300, prod.length * 30), height: 170 }}>
          <ResponsiveContainer>
            <ComposedChart data={prod} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}
              onClick={(st) => { const r = (st as { activeLabel?: string | number } | null)?.activeLabel; if (r !== undefined) setAberto(String(r)) }}>
              <CartesianGrid stroke={BD} vertical={false} />
              <XAxis dataKey="rotulo" tick={eixo} interval={periodo === 'hoje' ? 1 : 0} /><YAxis allowDecimals={false} tick={eixo} />
              <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="produzidas" name="Produzidas" fill={DOU} cursor="pointer" />
              <Bar dataKey="publicadas" name="Publicadas" fill={ESP} cursor="pointer" />
              <Line type="monotone" dataKey="fila" name="Fila acumulada" stroke={TXM} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ListaHora pontos={prod} rotulo={aberto} onFechar={() => setAberto(null)} />
    </section>
  )
}

export default function GraficosCodes({ semProducao = false }: { semProducao?: boolean } = {}) {
  const [periodo, setPeriodo] = useState<Periodo>('hoje')
  const [code, setCode] = useState<string>('')
  const [aberto, setAberto] = useState<string | null>(null)
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
    const prod = producaoPublicacao(entregas, agora, periodo, code || null)
    const filtradas = code ? entregas.filter((e) => e.code === code) : entregas
    return {
      resumo: resumoProducao(prod, periodo), prod,
      pilha: pilhaProntas(filtradas, agora, periodo === 'hoje' ? 24 : dias * 24).map((p) => ({ rotulo: p.rotulo, prontas: p.prontas })),
      vazao: vazaoPorDia(filtradas, agora, Math.max(dias, 7)).map((v) => ({ rotulo: v.rotulo, minutos: v.medianaMin })),
    }
  }, [entregas, agora, periodo, dias, code])

  const eixo = { fontSize: 11, fill: TXM }
  return (
    <div data-testid="codes-graficos" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ESP }}>Desempenho</h3>
        <AjudaCampo chave="dev.codes.graficos.periodo" rota={ROTA} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: ESP, marginLeft: 'auto' }}>
          Code
          <select data-testid="codes-filtro-code" value={code} onChange={(e) => setCode(e.target.value)}
            style={{ minHeight: 36, borderRadius: 8, border: `1px solid ${BD}`, padding: '0 8px', fontSize: 12, color: ESP, background: BRANCO }}>
            <option value="">Todos</option>
            {CODES_PAINEL.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <AjudaCampo chave="dev.codes.graficos.code" rota={ROTA} />
        </label>
        <div role="group" aria-label="Período" style={{ display: 'flex', gap: 4 }}>
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
          {!semProducao && <div data-testid="grafico-publicacoes" style={{ gridColumn: '1 / -1', background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESP }}>{periodo === 'hoje' ? 'Produzidas × publicadas por hora' : 'Produzidas × publicadas por dia'}</h3>
              <AjudaCampo chave="dev.codes.graficos.publicacoes" rota={ROTA} />
            </header>
            <div data-testid="producao-resumo" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <Numero testid="producao-produzidas" rotulo="Produzidas" valor={serie.resumo.produzidas} chave="dev.codes.graficos.produzidas" />
              <Numero testid="producao-publicadas" rotulo="Publicadas" valor={serie.resumo.publicadas} chave="dev.codes.graficos.publicadas" />
              <Numero testid="producao-saldo" rotulo="Saldo" valor={(serie.resumo.saldo > 0 ? '+' : '') + serie.resumo.saldo} chave="dev.codes.graficos.saldo" cor={SEMAFORO[serie.resumo.semaforo]} extra={serie.resumo.semaforo} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: Math.max(320, serie.prod.length * 44), height: 220 }}>
                <ResponsiveContainer>
                  <ComposedChart data={serie.prod} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                    onClick={(st) => { const r = (st as { activeLabel?: string | number } | null)?.activeLabel; if (r !== undefined) setAberto(String(r)) }}>
                    <CartesianGrid stroke={BD} vertical={false} />
                    <XAxis dataKey="rotulo" tick={eixo} interval={0} /><YAxis allowDecimals={false} tick={eixo} />
                    <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="produzidas" name="Produzidas" fill={DOU} cursor="pointer" />
                    <Bar dataKey="publicadas" name="Publicadas" fill={ESP} cursor="pointer" />
                    <Line type="monotone" dataKey="fila" name="Fila acumulada" stroke={TXM} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
            <ListaHora pontos={serie.prod} rotulo={aberto} onFechar={() => setAberto(null)} />
          </div>}
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
      <GraficosHistoricoCodes periodo={periodo} />
    </div>
  )
}
