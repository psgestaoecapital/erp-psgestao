'use client'

// O4.1 · Obras — board de andamento. A obra NASCE do orçamento aprovado/convertido (trigger no banco).
// Tudo vem de fn_obras_kpis / fn_obras_listar por company_id (RD-38: nada fixo). 3 estados: erro / vazio
// (ensina) / dados. Linguagem da casa (CONCLUIU obra) · identidade Espresso · mobile-first.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, HardHat, Receipt, X } from 'lucide-react'
import PSGCMetric from '@/components/psgc/PSGCMetric'
import { fmtR } from '@/lib/psgc-tokens'
import { supabase } from '@/lib/supabase'
import { comPrazo, MSG_CARREGAMENTO_FALHOU } from '@/lib/comPrazo'
import { useCompanyIds } from '@/lib/useCompanyIds'
import CepEndereco from '@/components/comum/CepEndereco'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BG = '#FAF7F2', GOLD = '#C8941A', LINE = '#E7DECF', MUT = 'rgba(61,35,20,0.55)', VERDE = '#16A34A', AMBAR = '#B45309', VERM = '#B91C1C'

type Obra = {
  id: string; numero: string; nome: string; cliente_nome: string | null; status: string
  valor_previsto: number; pct_conclusao: number; cidade: string | null; uf: string | null
  responsavel_nome: string | null; data_inicio: string | null; data_prevista_fim: string | null; data_conclusao: string | null
}
type Kpis = { em_andamento: number; concluidas: number; valor_em_andamento: number; valor_concluido: number }
// Resultado por obra — versão receita (CEO 30/09 · FC): fn_obras_receita. Custo real (material + viagens) vem da v_obra_resultado.
type Receita = { obra_id: string; faturado: number; recebido: number; a_receber: number; notas: number; notas_sem_titulo: number; custo?: number; receita_view?: number }

const ST: Record<string, { label: string; cor: string }> = {
  em_andamento: { label: 'Em andamento', cor: GOLD },
  pausada: { label: 'Pausada', cor: AMBAR },
  concluida: { label: 'Concluída', cor: VERDE },
  cancelada: { label: 'Cancelada', cor: VERM },
}
const PROXIMOS: Record<string, { s: string; l: string }[]> = {
  em_andamento: [{ s: 'concluida', l: 'Concluir' }, { s: 'pausada', l: 'Pausar' }, { s: 'cancelada', l: 'Cancelar' }],
  pausada: [{ s: 'em_andamento', l: 'Retomar' }, { s: 'cancelada', l: 'Cancelar' }],
  concluida: [{ s: 'em_andamento', l: 'Reabrir' }],
  cancelada: [{ s: 'em_andamento', l: 'Reabrir' }],
}

export default function ObrasPage() {
  const { companyIds } = useCompanyIds()
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [aba, setAba] = useState<'principais' | 'outras'>('principais')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [obraAberta, setObraAberta] = useState<Obra | null>(null)
  const [obraFiscal, setObraFiscal] = useState<Obra | null>(null)
  const [obraEditar, setObraEditar] = useState<Obra | null>(null)
  const [obraExcluir, setObraExcluir] = useState<Obra | null>(null)
  const [receita, setReceita] = useState<Record<string, Receita> | null>(null)

  const carregar = useCallback(async () => {
    if (!companyIds?.length) { setLoading(false); return }
    setLoading(true); setErro('')
    try {
      const [{ data: k, error: ek }, { data: l, error: el }] = await comPrazo(() => Promise.all([
        supabase.rpc('fn_obras_kpis', { p_company_ids: companyIds }),
        supabase.rpc('fn_obras_listar', { p_company_ids: companyIds, p_status: null }),
      ]), { ms: 8000, tentativas: 1, label: 'projetos_obras' })
      if (ek || el) { setErro((ek ?? el)!.message); return }
      setKpis(k as Kpis); setObras((l as Obra[]) ?? [])
      // receita não derruba o board: se falhar, o cartão mostra "não deu para carregar"
      const { data: rc, error: er } = await supabase.rpc('fn_obras_receita', { p_company_ids: companyIds })
      // custo real (material + viagens) vem da v_obra_resultado; se falhar, o cartão mostra só a receita
      const { data: cr } = await supabase.from('v_obra_resultado').select('obra_id,custo_material,custo_viagens,receita_servico,receita_material').in('company_id', companyIds)
      const linhasRes = (cr ?? []) as { obra_id: string; custo_material: number; custo_viagens: number; receita_servico: number; receita_material: number }[]
      const custos = Object.fromEntries(linhasRes.map((x) => [x.obra_id, Number(x.custo_material || 0) + Number(x.custo_viagens || 0)]))
      // receita lançada fora de NFS-e (medição do escopo, venda de material ligada à obra): mesma fonte do Resultado por obra
      const recView = Object.fromEntries(linhasRes.map((x) => [x.obra_id, Number(x.receita_servico || 0) + Number(x.receita_material || 0)]))
      setReceita(er ? null : Object.fromEntries(((rc as Receita[]) ?? []).map((x) => [x.obra_id, { ...x, custo: custos[x.obra_id], receita_view: recView[x.obra_id] }])))
    } catch {
      setErro(MSG_CARREGAMENTO_FALHOU)
    } finally {
      setLoading(false)  // nunca "Carregando…" eterno se a RPC pendurar
    }
  }, [companyIds])

  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function mudarStatus(o: Obra, novo: string) {
    setBusy(o.id); setMsg('')
    const { error } = await supabase.rpc('fn_obra_mudar_status', { p_obra_id: o.id, p_novo_status: novo })
    setBusy('')
    if (error) { setMsg('Erro: ' + error.message); return }
    setMsg(novo === 'concluida' ? `CONCLUIU a obra ${o.numero}.` : `Obra ${o.numero} → ${ST[novo]?.label ?? novo}.`)
    void carregar()
  }

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return obras.filter((o) => (!filtroStatus || o.status === filtroStatus)
      && (!q || [o.numero, o.nome, o.cliente_nome, o.cidade].some((t) => (t ?? '').toLowerCase().includes(q))))
  }, [obras, busca, filtroStatus])
  const grupos = useMemo(() => ({
    em_andamento: visiveis.filter((o) => o.status === 'em_andamento'),
    concluida: visiveis.filter((o) => o.status === 'concluida'),
    pausada: visiveis.filter((o) => o.status === 'pausada'),
    cancelada: visiveis.filter((o) => o.status === 'cancelada'),
  }), [visiveis])

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px 18px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700 }}>Hub · Construção</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, fontWeight: 400, color: ESP, margin: '2px 0 6px' }}>Obras</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Link href="/dashboard/projetos/obras/nova?area=hub" data-testid="link-nova-obra" style={{ fontSize: 12, fontWeight: 700, color: ESP, textDecoration: 'underline' }}>+ Nova obra</Link>
            <AjudaCampo chave="projetos.obras.nova_obra" />
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Link href="/dashboard/projetos/obras/resultado?area=hub" data-testid="link-resultado-obra" style={{ fontSize: 12, fontWeight: 700, color: ESP, textDecoration: 'underline' }}>Ver resultado por obra</Link>
            <AjudaCampo chave="projetos.obras.link_resultado" />
          </span>
        </div>

        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 12, background: msg.startsWith('Erro') ? '#FBEAEA' : '#EAF5EE', color: msg.startsWith('Erro') ? VERM : VERDE, border: `0.5px solid ${LINE}` }}>{msg}</div>}

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 16 }}>
          <Kpi chave="projetos.obras.kpi_em_andamento"><PSGCMetric label="Em andamento" valor={kpis?.em_andamento ?? 0} cor={GOLD} corBg="#FFF" /></Kpi>
          <Kpi chave="projetos.obras.kpi_concluidas"><PSGCMetric label="Concluídas" valor={kpis?.concluidas ?? 0} cor={VERDE} corBg="#FFF" /></Kpi>
          <Kpi chave="projetos.obras.kpi_valor_andamento"><PSGCMetric label="Valor em andamento" valor={fmtR(kpis?.valor_em_andamento ?? 0)} cor={ESP} corBg="#FFF" /></Kpi>
          <Kpi chave="projetos.obras.kpi_valor_concluido"><PSGCMetric label="Valor concluído" valor={fmtR(kpis?.valor_concluido ?? 0)} cor={VERDE} corBg="#FFF" /></Kpi>
        </div>

        {/* ESTADO: erro */}
        {erro ? (
          <Aviso cor={VERM} titulo="Não deu para carregar as obras" texto={erro} />
        ) : loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: MUT }}>Carregando…</div>
        ) : obras.length === 0 ? (
          /* ESTADO: vazio (ensina) */
          <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 28, textAlign: 'center' }}>
            <div style={{ color: GOLD }}><HardHat size={34} aria-hidden style={{ margin: '0 auto' }} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: ESP, marginTop: 6 }}>Nenhuma obra ainda</div>
            <div style={{ fontSize: 13, color: MUT, maxWidth: 440, margin: '8px auto 0', lineHeight: 1.5 }}>
              Uma obra nasce automaticamente quando um orçamento é <b>aprovado</b>. Aprove um orçamento em Propostas para ver a obra aqui.
            </div>
            <Link href="/dashboard/projetos/propostas" style={{ display: 'inline-block', marginTop: 14, padding: '9px 16px', borderRadius: 8, background: ESP, color: '#FFF', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>Ir para Propostas</Link>
          </div>
        ) : (
          /* ESTADO: dados */
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <input data-testid="obras-busca" aria-label="Buscar obra" placeholder="Buscar por número, nome, cliente ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)}
                style={{ flex: '1 1 220px', minWidth: 0, padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP }} />
              <AjudaCampo chave="projetos.obras.busca" />
              <select data-testid="obras-filtro-status" aria-label="Filtrar por situação" value={filtroStatus}
                onChange={(e) => { const v = e.target.value; setFiltroStatus(v); if (v) setAba(v === 'pausada' || v === 'cancelada' ? 'outras' : 'principais') }}
                style={{ padding: '8px 10px', fontSize: 13, border: `1px solid ${LINE}`, borderRadius: 8, background: '#fff', color: ESP }}>
                <option value="">Todas as situações</option>
                <option value="em_andamento">Em andamento</option>
                <option value="concluida">Concluídas</option>
                <option value="pausada">Pausadas</option>
                <option value="cancelada">Canceladas</option>
              </select>
              <AjudaCampo chave="projetos.obras.filtro_status" />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Tab ativo={aba === 'principais'} onClick={() => setAba('principais')}>Em andamento · Concluídas</Tab>
              {(grupos.pausada.length + grupos.cancelada.length > 0) && (
                <Tab ativo={aba === 'outras'} onClick={() => setAba('outras')}>Pausadas · Canceladas ({grupos.pausada.length + grupos.cancelada.length})</Tab>
              )}
              <AjudaCampo chave="projetos.obras.abas" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 14, alignItems: 'start' }}>
              {aba === 'principais' ? (
                <>
                  <Coluna titulo="Em andamento" cor={GOLD} obras={grupos.em_andamento} receita={receita} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} onEditar={setObraEditar} onExcluir={setObraExcluir} />
                  <Coluna titulo="Concluídas" cor={VERDE} obras={grupos.concluida} receita={receita} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} onEditar={setObraEditar} onExcluir={setObraExcluir} />
                </>
              ) : (
                <>
                  <Coluna titulo="Pausadas" cor={AMBAR} obras={grupos.pausada} receita={receita} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} onEditar={setObraEditar} onExcluir={setObraExcluir} />
                  <Coluna titulo="Canceladas" cor={VERM} obras={grupos.cancelada} receita={receita} onStatus={mudarStatus} busy={busy} onAbrir={setObraAberta} onFiscal={setObraFiscal} onEditar={setObraEditar} onExcluir={setObraExcluir} />
                </>
              )}
            </div>
          </>
        )}
      </div>
      {obraAberta && <EscopoModal obra={obraAberta} onClose={() => setObraAberta(null)} onChanged={() => void carregar()} />}
      {obraEditar && <EditarObraModal obra={obraEditar} onClose={() => setObraEditar(null)} onSaved={() => { setMsg(`Obra ${obraEditar.numero} atualizada.`); void carregar() }} />}
      {obraExcluir && <ExcluirObraModal obra={obraExcluir} onClose={() => setObraExcluir(null)} onDone={() => { setMsg(`Obra ${obraExcluir.numero} excluída (fica registrada na auditoria).`); void carregar() }} />}
      {obraFiscal && <FiscalObraModal obra={obraFiscal} onClose={() => setObraFiscal(null)} onSaved={() => void carregar()} />}
    </div>
  )
}

function Coluna({ titulo, cor, obras, receita, onStatus, busy, onAbrir, onFiscal, onEditar, onExcluir }: { titulo: string; cor: string; obras: Obra[]; receita: Record<string, Receita> | null; onStatus: (o: Obra, s: string) => void; busy: string; onAbrir: (o: Obra) => void; onFiscal: (o: Obra) => void; onEditar: (o: Obra) => void; onExcluir: (o: Obra) => void }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: cor, fontWeight: 700, marginBottom: 8 }}>{titulo} · {obras.length}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {obras.length === 0 ? (
          <div data-testid={`obras-coluna-vazia-${titulo}`} style={{ fontSize: 12.5, color: MUT, lineHeight: 1.5, border: `0.5px dashed ${LINE}`, borderRadius: 10, padding: 14 }}>
            {titulo === 'Em andamento'
              ? <>Nenhuma obra em andamento. A obra nasce quando uma proposta é aprovada — <Link href="/dashboard/projetos/propostas" style={{ color: ESP, fontWeight: 600 }}>abra as Propostas</Link> e aprove a próxima.</>
              : <>Nenhuma obra {titulo.toLowerCase()} por enquanto.</>}
          </div>
        ) :
          obras.map((o) => <ObraCard key={o.id} o={o} receita={receita ? (receita[o.id] ?? null) : undefined} onStatus={onStatus} busy={busy === o.id} onAbrir={onAbrir} onFiscal={onFiscal} onEditar={onEditar} onExcluir={onExcluir} />)}
      </div>
    </div>
  )
}

function ObraCard({ o, receita, onStatus, busy, onAbrir, onFiscal, onEditar, onExcluir }: { o: Obra; receita: Receita | null | undefined; onStatus: (o: Obra, s: string) => void; busy: boolean; onAbrir: (o: Obra) => void; onFiscal: (o: Obra) => void; onEditar: (o: Obra) => void; onExcluir: (o: Obra) => void }) {
  const st = ST[o.status] ?? { label: o.status, cor: MUT }
  const local = [o.cidade, o.uf].filter(Boolean).join('/')
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${st.cor}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: st.cor, fontFamily: 'monospace' }}>{o.numero}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>{fmtR(o.valor_previsto)}</span>
      </div>
      <div style={{ fontSize: 13.5, color: ESP, fontWeight: 600, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nome}</div>
      <div style={{ fontSize: 11.5, color: MUT, marginTop: 1 }}>{o.cliente_nome || 'Cliente não informado'}{local ? ` · ${local}` : ''}</div>

      <div style={{ marginTop: 8 }}>
        <div style={{ background: BG, borderRadius: 6, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${o.pct_conclusao}%`, height: '100%', background: st.cor, opacity: 0.85 }} />
        </div>
        <div style={{ fontSize: 10.5, color: MUT, marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
          <span>{o.pct_conclusao}% concluído</span>
          <span>{o.responsavel_nome || 'sem responsável'}</span>
        </div>
      </div>

      <ResultadoObra r={receita} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        <button onClick={() => onAbrir(o)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${GOLD}`, background: '#FBF4E4', color: '#A57A15' }}>
          Ver escopo
        </button>
        <Link href={`/dashboard/projetos/obras/${o.id}/cockpit?area=hub`} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: ESP, textDecoration: 'none' }}>Cockpit</Link>
        <Link href={`/dashboard/projetos/obras/${o.id}/linha-do-tempo?area=hub`} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: ESP, textDecoration: 'none' }}>
          Linha do tempo
        </Link>
        <button onClick={() => onFiscal(o)} title="CNO e endereço para a NFS-e de construção (E0370)" style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }}>
          <Receipt size={12} aria-hidden style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />Dados fiscais
        </button>
        <button data-testid={`obra-editar-${o.numero}`} onClick={() => onEditar(o)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: ESP }}>Editar</button>
        <AjudaCampo chave="projetos.obras.acao_editar" />
        <button data-testid={`obra-excluir-${o.numero}`} onClick={() => onExcluir(o)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: `1px solid ${LINE}`, background: '#fff', color: VERM }}>Excluir</button>
        <AjudaCampo chave="projetos.obras.acao_excluir" />
        {(PROXIMOS[o.status] ?? []).map((p) => (
          <button key={p.s} onClick={() => onStatus(o, p.s)} disabled={busy}
            style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 6, cursor: busy ? 'default' : 'pointer', border: `1px solid ${LINE}`, background: p.s === 'concluida' ? '#EAF5EE' : '#FFF', color: p.s === 'cancelada' ? VERM : ESP, opacity: busy ? 0.5 : 1 }}>
            {p.l}
          </button>
        ))}
        <AjudaCampo chave="projetos.obras.acoes_card" />
      </div>
    </div>
  )
}

// Cartão "Resultado da obra" (receita): faturado = NFS-e autorizadas ligadas à obra; recebido = baixas dos títulos
// dessas notas. undefined = não carregou (falha); null = obra sem nota autorizada.
const fmtRc = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
function ResultadoObra({ r }: { r: Receita | null | undefined }) {
  const cel = (label: string, valor: string, cor: string, testId: string) => (
    <div>
      <div style={{ fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.6, color: MUT, fontWeight: 700 }}>{label}</div>
      <div data-testid={testId} style={{ fontSize: 12.5, fontWeight: 700, color: cor, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
  // Sem NFS-e autorizada ligada: R$ 0,00 mudo parece resultado zero; explica que falta lançar a medição.
  const semLancamento = !!r && r.notas === 0 && Number(r.faturado || 0) === 0 && Number(r.recebido || 0) === 0 && Number(r.receita_view || 0) === 0
  return (
    <div data-testid="obra-resultado" style={{ marginTop: 10, background: BG, border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: ESP, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 2 }}>Resultado da obra<AjudaCampo chave="projetos.obras.resultado_card" /></div>
      {r === undefined ? (
        <div style={{ fontSize: 11.5, color: MUT }}>Não deu para carregar o faturado agora.</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(80px,1fr))', gap: 8 }}>
            {cel('Faturado', semLancamento ? 'sem medição' : fmtRc(Number(r?.faturado || 0) || Number(r?.receita_view || 0)), semLancamento ? MUT : ESP, 'obra-faturado')}
            {cel('Recebido', semLancamento ? 'sem medição' : fmtRc(r?.recebido ?? 0), semLancamento ? MUT : VERDE, 'obra-recebido')}
            {cel('A receber', semLancamento ? 'sem medição' : fmtRc(r?.a_receber ?? 0), semLancamento ? MUT : GOLD, 'obra-a-receber')}
            {cel('Custo', r?.custo != null ? fmtRc(r.custo) : '—', MUT, 'obra-custo')}
          </div>
          <div style={{ fontSize: 10.5, color: MUT, marginTop: 4 }} data-testid="obra-notas">
            {r && r.notas > 0 ? `${r.notas} NFS-e autorizada(s)` : r && Number(r.receita_view || 0) > 0 ? 'Receita lançada por medição/venda de material (sem NFS-e ligada)' : 'Nenhuma NFS-e autorizada ligada a esta obra — lance a medição para ver faturado e recebido'}{semLancamento && <AjudaCampo chave="projetos.obras.resultado_vazio" />}
            {r && r.notas_sem_titulo > 0 ? ` · ${r.notas_sem_titulo} sem título no financeiro (não entram no recebido)` : ''}
          </div>
        </>
      )}
    </div>
  )
}

// Indicador do topo com o "?" (RD-95) no canto, sem mexer no PSGCMetric compartilhado
function Kpi({ chave, children }: { chave: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      {children}
      <span style={{ position: 'absolute', top: 8, right: 8 }}><AjudaCampo chave={chave} /></span>
    </div>
  )
}

function Tab({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${ativo ? GOLD : LINE}`, background: ativo ? '#FBF4E4' : '#FFF', color: ativo ? '#A57A15' : MUT }}>{children}</button>
}
function Aviso({ cor, titulo, texto }: { cor: string; titulo: string; texto: string }) {
  return (
    <div style={{ background: '#FFF', border: `0.5px solid ${LINE}`, borderLeft: `4px solid ${cor}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: ESP }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: MUT, marginTop: 4 }}>{texto}</div>
    </div>
  )
}

// ── F2 · Escopo congelado da obra (fn_obra_escopo + adicionar/excluir item) ──
type EscItem = { id: string; ordem: number; descricao: string; unidade: string; quantidade_contratada: number; quantidade_medida: number; quantidade_a_medir: number; pct_medido: number; preco_unitario: number; valor_contratado: number; valor_medido: number }
type Escopo = { ok: boolean; erro?: string; obra_numero?: string; centro_custo?: { codigo: string | null; nome: string | null } | null; itens: EscItem[]; total_itens: number; valor_contratado: number; valor_medido: number; valor_a_medir: number; pct_fisico: number }

function EscopoModal({ obra, onClose, onChanged }: { obra: Obra; onClose: () => void; onChanged: () => void }) {
  const [esc, setEsc] = useState<Escopo | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [addAberto, setAddAberto] = useState(false)
  const [form, setForm] = useState({ descricao: '', unidade: 'un', quantidade: '', preco_unit: '' })
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const { data, error } = await comPrazo(async () => await supabase.rpc('fn_obra_escopo', { p_obra_id: obra.id }), { ms: 8000, tentativas: 1, label: 'projetos_obra_escopo' })
      if (error) { setErro(error.message); return }
      const j = data as Escopo
      if (!j?.ok) { setErro(j?.erro === 'sem_acesso' ? 'Sem acesso a esta empresa.' : (j?.erro ?? 'Falha ao carregar o escopo.')); return }
      setEsc(j)
    } catch {
      setErro(MSG_CARREGAMENTO_FALHOU)
    } finally {
      setCarregando(false)  // nunca "Carregando…" eterno
    }
  }, [obra.id])
  useEffect(() => { void carregar() }, [carregar]) // eslint-disable-line react-hooks/set-state-in-effect

  async function adicionar() {
    if (!form.descricao.trim()) { setErro('Informe a descrição do item.'); return }
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_item_adicionar', {
      p_obra_id: obra.id, p_descricao: form.descricao.trim(), p_unidade: form.unidade.trim() || 'un',
      p_quantidade: Number(form.quantidade.replace(',', '.')) || 0, p_preco_unit: Number(form.preco_unit.replace(',', '.')) || 0,
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (error || !j?.ok) { setErro(j?.mensagem ?? error?.message ?? j?.erro ?? 'Falha ao adicionar o item.'); return }
    setForm({ descricao: '', unidade: 'un', quantidade: '', preco_unit: '' }); setAddAberto(false)
    await carregar(); onChanged()
  }

  async function excluir(it: EscItem) {
    if (typeof window !== 'undefined' && !window.confirm(`Remover "${it.descricao}" do escopo?`)) return
    setBusy(true); setErro(null)
    const { data, error } = await supabase.rpc('fn_obra_item_excluir', { p_item_id: it.id, p_motivo: 'removido pela tela de obras' })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (error || !j?.ok) { setErro(j?.mensagem ?? error?.message ?? j?.erro ?? 'Falha ao remover o item.'); return }
    await carregar(); onChanged()
  }

  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '7px 9px', fontSize: 12.5, color: ESP, background: '#fff' }
  const ccCod = esc?.centro_custo?.codigo ?? obra.numero
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{obra.numero} · Escopo da obra</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex' }} aria-label="Fechar"><X size={18} aria-hidden /></button>
        </div>
        <div style={{ padding: 16 }}>
          {/* Cabeçalho: contratado · medido (%) · a medir · centro de custo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 12 }}>
            <MiniKpi label="Contratado" valor={fmtR(esc?.valor_contratado ?? 0)} cor={ESP} />
            <MiniKpi label={`Medido (${esc?.pct_fisico ?? 0}%)`} valor={fmtR(esc?.valor_medido ?? 0)} cor={VERDE} />
            <MiniKpi label="A medir" valor={fmtR(esc?.valor_a_medir ?? 0)} cor={GOLD} />
            <MiniKpi label="Centro de custo" valor={ccCod ?? '—'} cor={ESP} />
          </div>

          {erro && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 12, marginBottom: 10 }}>{erro}</div>}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: ESP }}>Itens do escopo {esc ? `(${esc.total_itens})` : ''}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAddAberto((v) => !v)} disabled={busy} style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${GOLD}`, color: '#A57A15', background: '#FBF4E4' }}>+ Adicionar item</button>
              <button disabled title="Disponível na próxima entrega" style={{ fontSize: 11.5, fontWeight: 700, padding: '6px 12px', borderRadius: 8, cursor: 'not-allowed', border: `1px solid ${LINE}`, color: MUT, background: '#F2ECE2' }}>Nova medição</button>
            </div>
          </div>

          {addAberto && (
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 0.9fr 1fr auto', gap: 8, alignItems: 'center', marginBottom: 12, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}><input style={inp} placeholder="Descrição do item *" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /><AjudaCampo chave="projetos.obras.item_descricao" /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}><input style={inp} placeholder="un" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} /><AjudaCampo chave="projetos.obras.item_unidade" /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}><input style={{ ...inp, textAlign: 'right' }} inputMode="decimal" placeholder="qtd" value={form.quantidade} onChange={(e) => setForm({ ...form, quantidade: e.target.value })} /><AjudaCampo chave="projetos.obras.item_quantidade" /></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}><input style={{ ...inp, textAlign: 'right' }} inputMode="decimal" placeholder="R$/un" value={form.preco_unit} onChange={(e) => setForm({ ...form, preco_unit: e.target.value })} /><AjudaCampo chave="projetos.obras.item_preco" /></div>
              <button onClick={() => void adicionar()} disabled={busy || !form.descricao.trim()} style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 8, cursor: 'pointer', border: 'none', color: '#fff', background: GOLD, opacity: (busy || !form.descricao.trim()) ? 0.5 : 1 }}>{busy ? '…' : 'Adicionar'}</button>
            </div>
          )}

          {carregando ? <div style={{ padding: 24, textAlign: 'center', color: MUT, fontSize: 13 }}>Carregando escopo…</div>
            : (esc?.itens.length ?? 0) === 0 ? (
              <div style={{ background: '#fff', border: `1px dashed ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: ESP }}>Esta obra não tem itens de escopo</div>
                <div style={{ fontSize: 12.5, color: MUT, marginTop: 6, maxWidth: 460, marginInline: 'auto' }}>Foi criada antes do escopo por item. Adicione os itens manualmente para acompanhar o avanço.</div>
                <button onClick={() => setAddAberto(true)} style={{ marginTop: 12, fontSize: 12, fontWeight: 700, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', border: 'none', color: '#fff', background: GOLD }}>+ Adicionar item</button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 10, background: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead><tr style={{ background: BG, color: MUT, textAlign: 'left' }}>
                    <th style={th}>#</th><th style={th}>Descrição</th><th style={th}>Un</th>
                    <th style={thR}>Contratado <AjudaCampo chave="projetos.obras.escopo_contratado" /></th><th style={thR}>Medido <AjudaCampo chave="projetos.obras.escopo_medido" /></th><th style={thR}>% <AjudaCampo chave="projetos.obras.escopo_pct" /></th><th style={thR}>A medir <AjudaCampo chave="projetos.obras.escopo_a_medir" /></th><th style={thR}>Valor contratado <AjudaCampo chave="projetos.obras.escopo_valor" /></th><th style={th}></th>
                  </tr></thead>
                  <tbody>
                    {esc!.itens.map((it) => (
                      <tr key={it.id} style={{ borderTop: `1px solid ${LINE}` }}>
                        <td style={td}>{it.ordem}</td>
                        <td style={{ ...td, color: ESP }}>{it.descricao}</td>
                        <td style={td}>{it.unidade}</td>
                        <td style={tdR}>{it.quantidade_contratada}</td>
                        <td style={tdR}>{it.quantidade_medida}</td>
                        <td style={tdR}>{it.pct_medido}%</td>
                        <td style={tdR}>{it.quantidade_a_medir}</td>
                        <td style={{ ...tdR, fontWeight: 600, color: ESP }}>{fmtR(it.valor_contratado)}</td>
                        <td style={{ ...td, textAlign: 'center' }}>
                          <button onClick={() => void excluir(it)} disabled={busy || it.quantidade_medida > 0}
                            title={it.quantidade_medida > 0 ? 'Item já medido — não pode ser removido' : 'Remover do escopo'}
                            style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: it.quantidade_medida > 0 ? MUT : VERM, cursor: (busy || it.quantidade_medida > 0) ? 'not-allowed' : 'pointer', opacity: it.quantidade_medida > 0 ? 0.5 : 1 }}>excluir</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}
// #18 · Dados fiscais da obra (CNO/endereço) — o que a NFS-e de construção precisa (E0370). A nota
// aponta pra obra; corrigir aqui corrige a próxima nota. CNO OU código municipal basta.
function FiscalObraModal({ obra, onClose, onSaved }: { obra: Obra; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ endereco: '', numero_endereco: '', bairro: '', cidade: '', uf: '', cep: '', codigo_ibge_municipio: '', cno: '', art: '', codigo_obra_municipal: '' })
  const [carregando, setCarregando] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void supabase.rpc('fn_obra_fiscal_obter', { p_obra_id: obra.id }).then(({ data }) => {
      if (!alive) return
      const r = data as Record<string, string | null> | null
      if (r?.ok) setF((p) => ({ ...p,
        endereco: r.endereco ?? '', numero_endereco: r.numero_endereco ?? '', bairro: r.bairro ?? '',
        cidade: r.cidade ?? '', uf: r.uf ?? '', cep: r.cep ?? '', codigo_ibge_municipio: r.codigo_ibge_municipio ?? '',
        cno: r.cno ?? '', art: r.art ?? '', codigo_obra_municipal: r.codigo_obra_municipal ?? '' }))
      setCarregando(false)
    })
    return () => { alive = false }
  }, [obra.id])
  const temId = !!(f.cno.trim() || f.codigo_obra_municipal.trim())
  async function salvar() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_obra_salvar_fiscal', {
      p_obra_id: obra.id, p_endereco: f.endereco, p_numero_endereco: f.numero_endereco, p_bairro: f.bairro,
      p_cidade: f.cidade, p_uf: f.uf, p_cep: f.cep, p_codigo_ibge_municipio: f.codigo_ibge_municipio,
      p_cno: f.cno, p_art: f.art, p_codigo_obra_municipal: f.codigo_obra_municipal,
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (j?.erro ?? error?.message ?? 'falha ao salvar')); return }
    onSaved(); onClose()
  }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: ESP, background: '#fff', width: '100%', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 10.5, color: MUT, fontWeight: 600, display: 'block', marginBottom: 3 }
  const campo = (label: string, k: keyof typeof f, ph = '', ajuda = '') => (
    <label style={{ display: 'block' }}><span style={lbl}>{label}{ajuda && <AjudaCampo chave={ajuda} />}</span>
      <input style={inp} value={f[k]} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{obra.numero} · Dados fiscais da obra</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex' }} aria-label="Fechar"><X size={18} aria-hidden /></button>
        </div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: MUT, marginBottom: 12, lineHeight: 1.5 }}>
            Estes dados vão na <b>NFS-e de construção</b> (exigência E0370 do Fisco). A nota aponta para a obra — corrigir aqui corrige a próxima nota. <b>CNO ou código de obra municipal</b> é obrigatório.
          </div>
          {carregando ? <div style={{ padding: 20, textAlign: 'center', color: MUT }}>Carregando…</div> : (
            <>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700, marginBottom: 8 }}>Identificação da obra</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 14 }}>
                {campo('CNO (Cadastro Nacional de Obras)', 'cno', 'ex.: 12.345.67890/12', 'projetos.obras.fiscal_cno')}
                {campo('Código de obra municipal (se o município usar)', 'codigo_obra_municipal', '', 'projetos.obras.fiscal_codigo_municipal')}
                {campo('ART / RRT (opcional)', 'art', '', 'projetos.obras.fiscal_art')}
              </div>
              {!temId && <div style={{ fontSize: 11.5, color: '#B45309', marginBottom: 12, display: 'flex', gap: 6, alignItems: 'flex-start' }}><AlertTriangle size={14} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} /><span>Falta o CNO ou o código municipal — sem um dos dois a nota de construção não sai.</span></div>}
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700, marginBottom: 8 }}>Endereço da obra</div>
              {/* #82/CEP · o IBGE nasce do CEP (nunca digitado) — fecha o erro que mandava ISS pro estado errado */}
              <CepEndereco
                ibgeObrigatorio
                value={{ cep: f.cep, logradouro: f.endereco, numero: f.numero_endereco, bairro: f.bairro, cidade: f.cidade, uf: f.uf, codigo_ibge_municipio: f.codigo_ibge_municipio }}
                onChange={(p) => setF((prev) => ({ ...prev,
                  ...(p.cep !== undefined ? { cep: p.cep } : {}),
                  ...(p.logradouro !== undefined ? { endereco: p.logradouro } : {}),
                  ...(p.numero !== undefined ? { numero_endereco: p.numero } : {}),
                  ...(p.bairro !== undefined ? { bairro: p.bairro } : {}),
                  ...(p.cidade !== undefined ? { cidade: p.cidade } : {}),
                  ...(p.uf !== undefined ? { uf: p.uf } : {}),
                  ...(p.codigo_ibge_municipio !== undefined ? { codigo_ibge_municipio: p.codigo_ibge_municipio } : {}),
                }))}
              />
              {msg && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 12, marginTop: 12 }}>{msg}</div>}
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button onClick={() => void salvar()} disabled={busy} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Salvando…' : 'Salvar dados fiscais'}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
// RD-98 p2 · Editar todos os campos da obra (fn_obra_obter / fn_obra_editar). Situação continua nos botões do cartão; CNO/ART em "Dados fiscais".
type FormObra = { nome: string; cliente_nome: string; endereco: string; numero_endereco: string; bairro: string; cidade: string; uf: string; cep: string; responsavel_nome: string; valor_previsto: string; pct_conclusao: string; data_inicio: string; data_prevista_fim: string; observacoes: string }
const FORM_OBRA_VAZIO: FormObra = { nome: '', cliente_nome: '', endereco: '', numero_endereco: '', bairro: '', cidade: '', uf: '', cep: '', responsavel_nome: '', valor_previsto: '', pct_conclusao: '0', data_inicio: '', data_prevista_fim: '', observacoes: '' }
function EditarObraModal({ obra, onClose, onSaved }: { obra: Obra; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<FormObra>(FORM_OBRA_VAZIO)
  const [carregando, setCarregando] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void supabase.rpc('fn_obra_obter', { p_obra_id: obra.id }).then(({ data, error }) => {
      if (!alive) return
      const j = data as { ok?: boolean; erro?: string; obra?: Record<string, string | number | null> } | null
      if (error || !j?.ok || !j.obra) { setMsg('Erro: ' + (j?.erro ?? error?.message ?? 'não deu para carregar a obra')); setCarregando(false); return }
      const x = j.obra, t = (k: string) => (x[k] == null ? '' : String(x[k]))
      setF({ nome: t('nome'), cliente_nome: t('cliente_nome'), endereco: t('endereco'), numero_endereco: t('numero_endereco'), bairro: t('bairro'), cidade: t('cidade'), uf: t('uf'), cep: t('cep'),
        responsavel_nome: t('responsavel_nome'), valor_previsto: t('valor_previsto'), pct_conclusao: t('pct_conclusao') || '0', data_inicio: t('data_inicio'), data_prevista_fim: t('data_prevista_fim'), observacoes: t('observacoes') })
      setCarregando(false)
    })
    return () => { alive = false }
  }, [obra.id])
  async function salvar() {
    if (!f.nome.trim()) { setMsg('Erro: informe o nome da obra.'); return }
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_obra_editar', { p_obra_id: obra.id, p_dados: {
      ...f, valor_previsto: f.valor_previsto.replace(',', '.'), pct_conclusao: f.pct_conclusao || '0' } })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setMsg('Erro: ' + (j?.erro ?? error?.message ?? 'falha ao salvar')); return }
    onSaved(); onClose()
  }
  const inp: React.CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: ESP, background: '#fff', width: '100%', boxSizing: 'border-box' }
  const lbl: React.CSSProperties = { fontSize: 10.5, color: MUT, fontWeight: 600, display: 'block', marginBottom: 3 }
  const campo = (label: string, k: keyof FormObra, ajuda: string, tipo = 'text', extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label style={{ display: 'block' }}><span style={lbl}>{label}<AjudaCampo chave={ajuda} /></span>
      <input data-testid={`obra-edit-${k}`} type={tipo} style={inp} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 680 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0' }}>
          <div style={{ color: GOLD, fontWeight: 700, fontSize: 15 }}>{obra.numero} · Editar obra</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'inline-flex' }} aria-label="Fechar"><X size={18} aria-hidden /></button>
        </div>
        <div style={{ padding: 16 }}>
          {carregando ? <div style={{ padding: 20, textAlign: 'center', color: MUT }}>Carregando…</div> : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
                {campo('Nome da obra *', 'nome', 'projetos.obras.edit_nome')}
                {campo('Cliente', 'cliente_nome', 'projetos.obras.edit_cliente')}
                {campo('Responsável', 'responsavel_nome', 'projetos.obras.edit_responsavel')}
                {campo('Valor previsto (R$)', 'valor_previsto', 'projetos.obras.edit_valor', 'text', { inputMode: 'decimal' })}
                {campo('% concluído (0–100)', 'pct_conclusao', 'projetos.obras.edit_pct', 'number', { min: 0, max: 100 })}
                {campo('Início', 'data_inicio', 'projetos.obras.edit_inicio', 'date')}
                {campo('Fim previsto', 'data_prevista_fim', 'projetos.obras.edit_fim', 'date')}
              </div>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: GOLD, fontWeight: 700, margin: '14px 0 8px', display: 'flex', alignItems: 'center', gap: 2 }}>Endereço da obra<AjudaCampo chave="projetos.obras.edit_endereco" /></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                {campo('Logradouro', 'endereco', 'projetos.obras.edit_endereco')}
                {campo('Número', 'numero_endereco', 'projetos.obras.edit_endereco')}
                {campo('Bairro', 'bairro', 'projetos.obras.edit_endereco')}
                {campo('Cidade', 'cidade', 'projetos.obras.edit_endereco')}
                {campo('UF', 'uf', 'projetos.obras.edit_endereco', 'text', { maxLength: 2 })}
                {campo('CEP', 'cep', 'projetos.obras.edit_endereco')}
              </div>
              <label style={{ display: 'block', marginTop: 12 }}><span style={lbl}>Observações<AjudaCampo chave="projetos.obras.edit_obs" /></span>
                <textarea data-testid="obra-edit-observacoes" rows={3} style={{ ...inp, resize: 'vertical' }} value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></label>
              <div style={{ fontSize: 11.5, color: MUT, marginTop: 8 }}>Situação (concluir, pausar, cancelar) fica nos botões do cartão; CNO e ART em “Dados fiscais”.</div>
            </>
          )}
          {msg && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 12, marginTop: 12 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
            <button data-testid="obra-edit-salvar" onClick={() => void salvar()} disabled={busy || carregando} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: GOLD, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: (busy || carregando) ? 0.6 : 1 }}>{busy ? 'Salvando…' : 'Salvar obra'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// RD-98 p4 · Exclusão rastreável (soft-delete em fn_obra_excluir: deleted_at + quem + motivo + audit_log_global).
function ExcluirObraModal({ obra, onClose, onDone }: { obra: Obra; onClose: () => void; onDone: () => void }) {
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function excluir() {
    setBusy(true); setMsg(null)
    const { data, error } = await supabase.rpc('fn_obra_excluir', { p_obra_id: obra.id, p_motivo: motivo })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; mensagem?: string } | null
    if (error || !j?.ok) { setMsg(j?.mensagem ?? j?.erro ?? error?.message ?? 'Falha ao excluir a obra.'); return }
    onDone(); onClose()
  }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '8vh 12px', overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Excluir obra" style={{ background: BG, borderRadius: 14, width: '100%', maxWidth: 460 }}>
        <div style={{ padding: '14px 18px', background: ESP, borderRadius: '14px 14px 0 0', color: GOLD, fontWeight: 700, fontSize: 15 }}>{obra.numero} · Excluir obra</div>
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: ESP, lineHeight: 1.5 }}>Excluir <b>{obra.nome}</b>? Ela some da lista, dos indicadores e do resultado. O registro fica guardado com quem excluiu e quando.</div>
          <label style={{ display: 'block', marginTop: 12 }}>
            <span style={{ fontSize: 10.5, color: MUT, fontWeight: 600, display: 'block', marginBottom: 3 }}>Motivo<AjudaCampo chave="projetos.obras.excluir_motivo" /></span>
            <input data-testid="obra-excluir-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: cadastro duplicado"
              style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, color: ESP, background: '#fff', width: '100%', boxSizing: 'border-box' }} />
          </label>
          {msg && <div style={{ background: '#FBEAEA', color: VERM, borderRadius: 8, padding: '8px 10px', fontSize: 12, marginTop: 12 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: ESP, fontSize: 13, cursor: 'pointer' }}>Voltar</button>
            <button data-testid="obra-excluir-confirmar" onClick={() => void excluir()} disabled={busy} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: VERM, color: '#fff', fontWeight: 700, fontSize: 13, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Excluindo…' : 'Excluir obra'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
function MiniKpi({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 10, padding: '9px 11px' }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: cor }}>{valor}</div>
      <div style={{ fontSize: 10.5, color: MUT, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    </div>
  )
}
const th: React.CSSProperties = { padding: '7px 9px', fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '6px 9px' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
