'use client'

// Hub · Acompanhamento das obras (portfólio/cronograma) — chamado #3742.
// Lente de ANDAMENTO, distinta da lista de obras (status) e do Resultado (financeiro): avanço físico,
// cronograma (em dia/atrasada), próxima entrega, última medição e prazo por obra. Tudo de
// fn_obras_acompanhamento por company_id (RD-38: nada fixo). 3 estados: erro / vazio (ensina) / dados.
// Identidade Espresso · mobile-first (cards a partir de 390px) · "?" RD-95 em todo indicador/filtro.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, HardHat, CalendarClock, ArrowRight } from 'lucide-react'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)'
const VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C', CINZA = '#6B7280'

type Obra = {
  id: string; numero: string; nome: string; cliente_nome: string | null; status: string
  cidade: string | null; uf: string | null; responsavel_nome: string | null
  data_inicio: string | null; data_prevista_fim: string | null; dias_para_fim: number | null
  pct_fisico: number; tarefas_total: number; tarefas_concluidas: number; tarefas_atrasadas: number
  proxima_entrega: string | null; ultimo_avanco: string | null
  medicao_numero: number | null; medicao_competencia: string | null; medicao_status: string | null
  situacao: 'em_dia' | 'atrasada' | 'sem_cronograma' | 'concluida' | 'cancelada'
}

const SIT: Record<string, { label: string; cor: string }> = {
  em_dia: { label: 'Em dia', cor: VERDE },
  atrasada: { label: 'Atrasada', cor: VERM },
  sem_cronograma: { label: 'Sem cronograma', cor: CINZA },
  concluida: { label: 'Concluída', cor: ESP },
  cancelada: { label: 'Cancelada', cor: CINZA },
}

const fmtData = (d: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '—'

export default function AcompanhamentoPage() {
  const { companyIds } = useCompanyIds()
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroSit, setFiltroSit] = useState('')

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const { data, error } = await comPrazo(
        () => Promise.resolve(supabase.rpc('fn_obras_acompanhamento', { p_company_ids: companyIds })),
        { ms: 8000, tentativas: 1, label: 'acompanhamento_obras' },
      )
      if (error) { setErro(error.message); return }
      setObras((data as Obra[]) ?? [])
    } catch {
      setErro(MSG_CARREGAMENTO_FALHOU)
    } finally {
      setLoading(false)
    }
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  const ativas = useMemo(() => obras.filter((o) => o.status === 'em_andamento' || o.status === 'pausada'), [obras])
  const kpis = useMemo(() => {
    const emDia = ativas.filter((o) => o.situacao === 'em_dia').length
    const atrasadas = ativas.filter((o) => o.situacao === 'atrasada').length
    const pctMedio = ativas.length ? Math.round(ativas.reduce((s, o) => s + (o.pct_fisico || 0), 0) / ativas.length) : 0
    return { emDia, atrasadas, pctMedio }
  }, [ativas])

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return obras.filter((o) => (!filtroSit || o.situacao === filtroSit)
      && (!q || [o.numero, o.nome, o.cliente_nome, o.cidade].some((t) => (t ?? '').toLowerCase().includes(q))))
  }, [obras, busca, filtroSit])

  const campo: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', background: '#fff', color: ESP, fontSize: 14, minWidth: 0 }
  const rotulo: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, fontWeight: 700, color: MUT, marginBottom: 5 }

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <CalendarClock size={26} color={GOLD} />
          <h1 style={{ fontSize: 24, fontWeight: 800, color: ESP, margin: 0, letterSpacing: '-0.01em' }}>Acompanhamento das obras</h1>
        </div>
        <p style={{ color: MUT, fontSize: 14, margin: '0 0 18px' }}>
          Avanço físico e cronograma de cada obra — quem está em dia, quem atrasou e o que vence a seguir.
        </p>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
          <PSGCMetric label="Obras em dia" valor={kpis.emDia} icon="✓" cor={VERDE} ajuda="projetos.acompanhamento.kpi_em_dia" />
          <PSGCMetric label="Obras atrasadas" valor={kpis.atrasadas} icon="!" cor={VERM} ajuda="projetos.acompanhamento.kpi_atrasadas" />
          <PSGCMetric label="Avanço físico médio" valor={`${kpis.pctMedio}%`} icon="▦" cor={GOLD} ajuda="projetos.acompanhamento.kpi_pct_medio" />
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', flex: '1 1 220px' }}>
            <span style={rotulo}>Buscar obra <AjudaCampo chave="projetos.acompanhamento.busca" /></span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Número, nome, cliente ou cidade" style={campo} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', flex: '0 1 220px' }}>
            <span style={rotulo}>Situação do cronograma <AjudaCampo chave="projetos.acompanhamento.filtro_situacao" /></span>
            <select value={filtroSit} onChange={(e) => setFiltroSit(e.target.value)} style={campo}>
              <option value="">Todas</option>
              <option value="em_dia">Em dia</option>
              <option value="atrasada">Atrasadas</option>
              <option value="sem_cronograma">Sem cronograma</option>
              <option value="concluida">Concluídas</option>
            </select>
          </label>
        </div>

        {/* Estados */}
        {loading ? (
          <div style={{ color: MUT, padding: '40px 0', textAlign: 'center' }}>Carregando acompanhamento…</div>
        ) : erro ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#FDF2F2', border: `1px solid ${VERM}40`, color: VERM, borderRadius: 12, padding: '14px 16px' }}>
            <AlertTriangle size={18} /> <span>Não deu para carregar o acompanhamento: {erro}</span>
          </div>
        ) : !obras.length ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 14 }}>
            <HardHat size={34} color={GOLD} style={{ marginBottom: 10 }} />
            <p style={{ color: ESP, fontWeight: 700, fontSize: 16, margin: '0 0 6px' }}>Nenhuma obra para acompanhar ainda</p>
            <p style={{ color: MUT, fontSize: 14, margin: '0 0 16px' }}>As obras nascem do orçamento aprovado. Abra uma obra e cadastre o cronograma para ver o avanço aqui.</p>
            <Link href="/dashboard/projetos/obras" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: ESP, color: '#fff', borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
              Ir para Obras <ArrowRight size={16} />
            </Link>
          </div>
        ) : !visiveis.length ? (
          <div style={{ textAlign: 'center', padding: '36px 20px', color: MUT }}>Nenhuma obra encontrada com esse filtro.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
            {visiveis.map((o) => {
              const sit = SIT[o.situacao] ?? SIT.sem_cronograma
              return (
                <Link key={o.id} href={`/dashboard/projetos/obras/${o.id}/cockpit`}
                  style={{ display: 'block', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 16, textDecoration: 'none', color: ESP }}>
                  {/* topo: nome + situação */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nome}</div>
                      <div style={{ color: MUT, fontSize: 12.5 }}>{o.numero}{o.cliente_nome ? ` · ${o.cliente_nome}` : ''}</div>
                    </div>
                    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <span style={{ background: `${sit.cor}18`, color: sit.cor, borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 700 }}>{sit.label}</span>
                      <AjudaCampo chave="projetos.acompanhamento.cronograma" />
                    </span>
                  </div>

                  {/* avanço físico */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: MUT, marginBottom: 4 }}>
                    <span>Avanço físico</span><AjudaCampo chave="projetos.acompanhamento.pct_fisico" />
                    <span style={{ marginLeft: 'auto', fontWeight: 800, color: ESP, fontSize: 14 }}>{o.pct_fisico}%</span>
                  </div>
                  <div style={{ height: 8, background: '#EEE6D8', borderRadius: 999, overflow: 'hidden', marginBottom: 12 }}>
                    <div style={{ width: `${Math.max(0, Math.min(100, o.pct_fisico))}%`, height: '100%', background: sit.cor }} />
                  </div>

                  {/* grade de indicadores */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px', fontSize: 13 }}>
                    <Ind rotulo="Tarefas" chave="projetos.acompanhamento.tarefas"
                      valor={o.tarefas_total ? `${o.tarefas_concluidas}/${o.tarefas_total}` : '—'}
                      extra={o.tarefas_atrasadas > 0 ? `${o.tarefas_atrasadas} atrasada${o.tarefas_atrasadas > 1 ? 's' : ''}` : null} extraCor={VERM} />
                    <Ind rotulo="Próxima entrega" chave="projetos.acompanhamento.proxima_entrega" valor={fmtData(o.proxima_entrega)} />
                    <Ind rotulo="Última medição" chave="projetos.acompanhamento.medicao"
                      valor={o.medicao_numero ? `Medição ${o.medicao_numero}` : '—'}
                      extra={o.medicao_status} extraCor={MUT} />
                    <Ind rotulo="Prazo" chave="projetos.acompanhamento.prazo"
                      valor={o.dias_para_fim === null ? '—' : o.dias_para_fim < 0 ? `${-o.dias_para_fim}d atrás` : `${o.dias_para_fim}d`}
                      extra={o.data_prevista_fim ? `fim ${fmtData(o.data_prevista_fim)}` : null} extraCor={MUT}
                      valorCor={o.dias_para_fim !== null && o.dias_para_fim < 0 && o.status !== 'concluida' ? VERM : ESP} />
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Ind({ rotulo, chave, valor, extra, extraCor, valorCor }: { rotulo: string; chave: string; valor: string; extra?: string | null; extraCor?: string; valorCor?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(61,35,20,0.55)', fontSize: 12 }}>
        <span>{rotulo}</span><AjudaCampo chave={chave} />
      </div>
      <div style={{ fontWeight: 700, color: valorCor ?? '#3D2314' }}>{valor}</div>
      {extra ? <div style={{ fontSize: 11.5, color: extraCor ?? 'rgba(61,35,20,0.55)' }}>{extra}</div> : null}
    </div>
  )
}
