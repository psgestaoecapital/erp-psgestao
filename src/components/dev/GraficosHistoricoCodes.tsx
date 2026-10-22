'use client'
// Aba Codes · gráficos do histórico (CEO 09/10, fatia 2): main/deploy verde-vermelho, sessões por Code e mensagens abertas.
// Fonte: erp_dev_codes_snapshot (leitura só equipe PS, RLS). Recarrega a cada 60 s. "?" em cada indicador (RD-95).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { linhaDoTempo, mensagensAbertas, sessoesPorCode, type Snapshot } from '@/lib/dev/snapshotCodes'
import type { Periodo } from '@/lib/dev/desempenhoCodes'
import { PERIODO_DIAS } from '@/lib/dev/desempenhoCodes'

const ESP = '#3D2314', DOU = '#C8941A', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const ROTA = '/dashboard/dev/codes'
const eixo = { fontSize: 11, fill: TXM }
const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function Cartao({ chave, titulo, resumo, testid, children }: { chave: string; titulo: string; resumo: string; testid: string; children: React.ReactNode }) {
  return (
    <section data-testid={testid} style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESP }}>{titulo}</h3>
        <AjudaCampo chave={chave} rota={ROTA} />
      </header>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 6 }}>{resumo}</div>
      <div style={{ width: '100%', height: 200 }}>{children}</div>
    </section>
  )
}

export default function GraficosHistoricoCodes({ periodo }: { periodo: Periodo }) {
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [chamados, setChamados] = useState<{ dia: string; ps: number; cliente: number; automaticos: number }[]>([])
  const [blocos, setBlocos] = useState<{ cliAbertos: number; cliAcima: number; cliAntigoMin: number; audAbertos: number; audCorrigidos: number; audTotal: number } | null>(null)
  const [espera, setEspera] = useState<{ esperando: number; antigo: number } | null>(null)

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - PERIODO_DIAS[periodo] * 864e5).toISOString()
    const { data, error } = await supabase.from('erp_dev_codes_snapshot')
      .select('capturado_em,main_estado,deploy_estado,sessoes_abertas,mensagens_por_status')
      .gte('capturado_em', desde).order('capturado_em', { ascending: false }).limit(3000)
    if (error) { setErro(error.message); return }
    setErro(null); setSnaps((data ?? []) as Snapshot[])
    // Bloco isolado: erro aqui não derruba os outros gráficos (RD-97)
    const ch = await supabase.rpc('fn_dev_codes_chamados_ps_x_cliente', { p_dias: PERIODO_DIAS[periodo] })
    if (!ch.error) setChamados(((ch.data ?? []) as { dia: string; resolvidos_ps: number; confirmados_cliente: number; automaticos: number }[]).map((r) => ({ dia: r.dia.slice(8, 10) + '/' + r.dia.slice(5, 7), ps: r.resolvidos_ps, cliente: r.confirmados_cliente, automaticos: r.automaticos })))
    const es = await supabase.rpc('fn_dev_codes_chamados_esperando_cliente')
    const e0 = (es.data ?? [])[0] as { esperando: number; mais_antigo_dias: number } | undefined
    if (!es.error && e0) setEspera({ esperando: e0.esperando, antigo: e0.mais_antigo_dias })
    const bl = await supabase.rpc('fn_dev_codes_chamados_clientes_x_auditor')
    const b0 = (bl.data ?? [])[0] as { clientes_abertos: number; clientes_acima_meta: number; clientes_mais_antigo_min: number; auditor_abertos: number; auditor_corrigidos: number; auditor_total: number } | undefined
    if (!bl.error && b0) setBlocos({ cliAbertos: b0.clientes_abertos, cliAcima: b0.clientes_acima_meta, cliAntigoMin: b0.clientes_mais_antigo_min, audAbertos: b0.auditor_abertos, audCorrigidos: b0.auditor_corrigidos, audTotal: b0.auditor_total })
  }, [periodo])

  useEffect(() => {
    void carregar()
    const t = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(t)
  }, [carregar])

  const d = useMemo(() => {
    if (!snaps) return null
    const f = (campo: 'main_estado' | 'deploy_estado') => linhaDoTempo(snaps, campo).map((p) => ({ t: p.t, verde: p.valor === 1 ? 1 : 0, vermelho: p.valor === 0 ? 1 : 0, lido: p.valor !== null }))
    const main = f('main_estado'), deploy = f('deploy_estado')
    return { main, deploy, semLeitura: !main.some((p) => p.lido) && !deploy.some((p) => p.lido), sessoes: sessoesPorCode(snaps), msgs: mensagensAbertas(snaps) }
  }, [snaps])

  if (erro) return <div role="alert" style={{ fontSize: 12, color: TXM, marginBottom: 8 }}>Não consegui ler o histórico: {erro}</div>
  if (!d) return <div style={{ fontSize: 13, color: TXM }}>Carregando histórico…</div>
  return (
    <div data-testid="codes-graficos-historico" className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ marginTop: 12 }}>
      <Cartao testid="grafico-main-deploy" chave="dev.codes.graficos.main_deploy" titulo="Main e deploy" resumo={d.semLeitura ? 'Ainda sem leitura do GitHub: o job que preenche o estado da main e do deploy ainda não foi ligado.' : 'Verde = saudável, vermelho = quebrado, em cada retrato de 15 min'}>
        <ResponsiveContainer>
          <AreaChart data={d.main.map((p, i) => ({ t: hora.format(new Date(p.t)), mainVerde: p.verde, mainVermelho: p.vermelho, deployVermelho: d.deploy[i]?.vermelho ?? 0 }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={BD} vertical={false} />
            <XAxis dataKey="t" tick={eixo} interval="preserveStartEnd" /><YAxis allowDecimals={false} domain={[0, 1]} tick={eixo} />
            <Tooltip />
            <Area type="stepAfter" dataKey="mainVerde" name="Main verde" stroke="#2f7d4f" fill="#2f7d4f" fillOpacity={0.25} />
            <Area type="stepAfter" dataKey="mainVermelho" name="Main vermelha" stroke="#b3261e" fill="#b3261e" fillOpacity={0.35} />
            <Area type="stepAfter" dataKey="deployVermelho" name="Deploy vermelho" stroke={DOU} fill={DOU} fillOpacity={0.3} />
          </AreaChart>
        </ResponsiveContainer>
      </Cartao>
      <Cartao testid="grafico-sessoes" chave="dev.codes.graficos.sessoes" titulo="Sessões por Code" resumo="Minutos com sessão aberta no período (consumo de cota)">
        <ResponsiveContainer>
          <BarChart data={d.sessoes} layout="vertical" margin={{ top: 4, right: 4, left: 30, bottom: 0 }}>
            <CartesianGrid stroke={BD} horizontal={false} />
            <XAxis type="number" tick={eixo} /><YAxis type="category" dataKey="code" tick={eixo} width={110} />
            <Tooltip /><Bar dataKey="minutos" name="Minutos" fill={ESP} />
          </BarChart>
        </ResponsiveContainer>
      </Cartao>
      <Cartao testid="grafico-mensagens" chave="dev.codes.graficos.mensagens" titulo="Mensagens abertas por Code" resumo="Tarefas ainda não concluídas na caixa de cada Code, agora">
        <ResponsiveContainer>
          <BarChart data={d.msgs} layout="vertical" margin={{ top: 4, right: 4, left: 30, bottom: 0 }}>
            <CartesianGrid stroke={BD} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={eixo} /><YAxis type="category" dataKey="code" tick={eixo} width={110} />
            <Tooltip /><Bar dataKey="abertas" name="Abertas" fill={DOU} />
          </BarChart>
        </ResponsiveContainer>
      </Cartao>
      <Cartao testid="grafico-chamados" chave="dev.codes.graficos.chamados" titulo="Chamados resolvidos por dia" resumo="Resolvidos pela PS × confirmados pelo cliente, em cada dia do período">
        <ResponsiveContainer>
          <BarChart data={chamados} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid stroke={BD} vertical={false} />
            <XAxis dataKey="dia" tick={eixo} interval="preserveStartEnd" /><YAxis allowDecimals={false} tick={eixo} />
            <Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="ps" name="Resolvidos pela PS" fill={ESP} />
            <Bar dataKey="cliente" name="Confirmados pelo cliente" fill={DOU} />
            <Bar dataKey="automaticos" name="Encerrados automaticamente" fill="#9C8B78" />
          </BarChart>
        </ResponsiveContainer>
      </Cartao>
      {blocos && (
        <section data-testid="chamados-clientes" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESP }}>Chamados de clientes</h3>
            <AjudaCampo chave="dev.codes.graficos.chamados_clientes" rota={ROTA} />
          </header>
          <div style={{ fontSize: 28, fontWeight: 700, color: ESP, marginTop: 6 }}>{blocos.cliAbertos}</div>
          <div style={{ fontSize: 12, color: TXM }}>abertos · meta de 20 min: {blocos.cliAcima} acima da meta · o mais antigo sem resposta há {blocos.cliAntigoMin} min</div>
        </section>
      )}
      {blocos && (
        <section data-testid="achados-auditor" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESP }}>Achados do auditor (PDCA do Hub)</h3>
            <AjudaCampo chave="dev.codes.graficos.achados_auditor" rota={ROTA} />
          </header>
          <div style={{ fontSize: 28, fontWeight: 700, color: ESP, marginTop: 6 }}>{blocos.audAbertos}</div>
          <div style={{ fontSize: 12, color: TXM }}>abertos · {blocos.audCorrigidos} corrigidos · {blocos.audTotal} no total (empresa DEMO, fora do atendimento de clientes)</div>
        </section>
      )}
      {espera && (
        <section data-testid="chamados-esperando-cliente" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, minWidth: 0 }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: ESP }}>Esperando o cliente</h3>
            <AjudaCampo chave="dev.codes.graficos.chamados_espera" rota={ROTA} />
          </header>
          <div style={{ fontSize: 28, fontWeight: 700, color: ESP, marginTop: 6 }}>{espera.esperando}</div>
          <div style={{ fontSize: 12, color: TXM }}>chamados respondidos pela PS aguardando confirmação · o mais antigo espera há {espera.antigo} {espera.antigo === 1 ? 'dia' : 'dias'}</div>
        </section>
      )}
    </div>
  )
}
