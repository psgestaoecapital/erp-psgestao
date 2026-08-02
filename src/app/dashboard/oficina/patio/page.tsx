'use client'

// 🚗 PÁTIO — Kanban tátil da oficina (a "tela do tablet do box").
// Simplicidade radical (Estrela-Norte): arrastar/tocar o card = muda o status
// da OS. 2 toques, sem formulário. Lê/escreve o MESMO erp_os do /dashboard/os —
// NÃO duplica a OS. Colunas = os status reais do erp_os (sem inventar status).
// Financeiro NÃO aparece (é fluxo técnico); só mostra o valor da OS como leitura.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { useAcesso } from '@/hooks/useAcesso'
import VisaoExecucaoModal from '@/components/oficina/VisaoExecucaoModal'
import AssinaturaModal from '@/components/oficina/AssinaturaModal'

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', espressoD: '#9C8E80',
  bg: '#FAF7F2', white: '#FFFFFF', border: '#E7DECF', gold: '#C8941A',
  verde: '#16A34A', amarelo: '#C8941A', vermelho: '#DC2626',
}

// Colunas do Kanban = status reais do erp_os, na ordem do fluxo da oficina.
// (labels amigáveis; "Em diagnóstico" não é status do erp_os hoje — fica em aberta.)
const COLUNAS: { status: string; label: string; icone: string }[] = [
  { status: 'aberta', label: 'Recebido', icone: '🅿️' },
  { status: 'aguardando_aprovacao', label: 'Aguardando aprovação', icone: '⏳' },
  { status: 'em_execucao', label: 'Em serviço', icone: '🔧' },
  { status: 'aguardando_peca', label: 'Aguardando peça', icone: '📦' },
  { status: 'pronta', label: 'Pronto', icone: '✅' },
  { status: 'entregue', label: 'Entregue', icone: '🚗' },
]

type OS = {
  id: string
  company_id: string
  numero: string | null
  cliente_nome: string | null
  equipamento: string | null
  placa: string | null
  modelo: string | null
  marca: string | null
  ano: number | null
  km: number | null
  tecnico_nome: string | null
  status: string
  prioridade: string | null
  total: number | null
  data_abertura: string | null
  updated_at: string | null
  entregue_em?: string | null
}

const SELECT_OS = 'id, company_id, numero, cliente_nome, equipamento, placa, modelo, marca, ano, km, tecnico_nome, status, prioridade, total, data_abertura, updated_at, entregue_em'

// RD-41 · cor CATEGÓRICA por etapa (accent do card). Ramps que NÃO são o semáforo
// (verde/amarelo/vermelho) — a lei reserva os 3 ao tempo/SLA. Um tom por coluna.
const COL_COR: Record<string, string> = {
  aberta: '#3D6FA8',              // azul
  aguardando_aprovacao: '#7C3AED', // roxo
  em_execucao: '#0F766E',        // teal
  aguardando_peca: '#0891B2',    // ciano
  pronta: '#4F46E5',             // indigo
  entregue: '#6B7280',           // cinza
}

// Placa formatada (ABC-1234 / ABC1D23). Usa a coluna estruturada; senão tenta
// extrair do texto livre 'equipamento'. Retorna null se não achar.
function placaDe(o: OS): string | null {
  const raw = o.placa || (o.equipamento ? (o.equipamento.toUpperCase().match(/[A-Z]{3}[- ]?[0-9][0-9A-Z][0-9]{2}/)?.[0] ?? null) : null)
  if (!raw) return null
  const p = raw.replace(/[- ]/g, '').toUpperCase()
  return p.length === 7 ? `${p.slice(0, 3)}-${p.slice(3)}` : p
}
// Modelo/descrição do veículo pro card (estruturado > texto livre).
function veiculoDe(o: OS): string {
  const partes = [o.marca, o.modelo].filter(Boolean).join(' ')
  return partes || o.equipamento || 'Veículo'
}
// Nome do mecânico pro card — quando o campo guarda o e-mail do usuário (dado legado),
// mostra o nome derivado em vez de "fulano@gmail.com".
function tituloCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}
function mecanicoLabel(nome: string | null): string {
  const t = (nome ?? '').trim()
  if (!t) return 'sem mecânico'
  if (t.includes('@')) {
    const local = t.split('@')[0].replace(/[._]+/g, ' ').trim()
    return local ? tituloCase(local) : 'sem mecânico'
  }
  return tituloCase(t)  // GEAN/gean → "Gean"
}
// chave de identidade p/ dedup/comparação (case/acentos-insensível o bastante p/ o filtro)
const normKey = (s: string | null) => (s ?? '').trim().toLowerCase()

// Semáforo pelo TEMPO na coluna atual (proxy: updated_at). Verde < 1 dia,
// amarelo 1–3 dias, vermelho > 3 dias. Prioridade 'alta'/'urgente' força vermelho.
function semaforo(o: OS): { cor: string; horas: number } {
  const ref = o.updated_at ?? o.data_abertura
  const horas = ref ? Math.max(0, (Date.now() - new Date(ref).getTime()) / 3_600_000) : 0
  if ((o.prioridade ?? '').match(/alta|urgente/i)) return { cor: C.vermelho, horas }
  if (horas > 72) return { cor: C.vermelho, horas }
  if (horas > 24) return { cor: C.amarelo, horas }
  return { cor: C.verde, horas }
}
// tempo curto p/ o card compacto: "agora" · "5h" · "3d"
function tempoCurto(horas: number): string {
  if (horas < 1) return 'agora'
  if (horas < 24) return `${Math.floor(horas)}h`
  return `${Math.floor(horas / 24)}d`
}
function inicialMec(nome: string | null): string {
  const t = mecanicoLabel(nome)
  return t === 'sem mecânico' ? '—' : t.charAt(0).toUpperCase()
}
// "entregue hoje" no fuso de São Paulo
const ehHojeSP = (iso: string | null | undefined): boolean => {
  if (!iso) return false
  const tz = 'America/Sao_Paulo'
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: tz }) === new Date().toLocaleDateString('pt-BR', { timeZone: tz })
}

export default function PatioKanbanPage() {
  const router = useRouter()
  const { companyIds } = useCompanyIds()
  const companyId = companyIds.length === 1 ? companyIds[0] : null
  // RD-41 · Auxiliar (OPERATOR) → abre a Visão de Execução (sem R$/gerencial).
  const { isOperator } = useAcesso(companyId)

  const [oss, setOss] = useState<OS[]>([])
  const [execOs, setExecOs] = useState<OS | null>(null)   // OPERATOR: visão de execução em contexto
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [salvandoId, setSalvandoId] = useState<string | null>(null)
  const [filtroMec, setFiltroMec] = useState<string>('todos')
  const [cardAberto, setCardAberto] = useState<OS | null>(null)   // tablet: tap → picker de status
  const [dragId, setDragId] = useState<string | null>(null)       // desktop: drag
  const [mecLimpos, setMecLimpos] = useState<string[]>([])        // lista LIMPA de mecânicos (RPC)
  type MecOS = { id: string; mecanico_nome: string; papel: string; ativo: boolean }
  const [mecsOS, setMecsOS] = useState<MecOS[]>([])               // mecânicos da OS aberta
  const [novoMec, setNovoMec] = useState('')                      // input p/ novo nome
  const [salvandoMec, setSalvandoMec] = useState(false)
  // RD-41 · assinaturas tipadas (checklist_ciente / entrega) da OS aberta
  const [assinaturasCard, setAssinaturasCard] = useState<string[]>([])
  const [assinarEntregaOs, setAssinarEntregaOs] = useState<OS | null>(null)
  const [entregueTotal, setEntregueTotal] = useState(0)   // total de entregues (p/ "ver histórico (N)")

  const carregar = useCallback(async () => {
    if (!companyId) { setLoading(false); return }
    setLoading(true); setErro(null)
    const { data, error } = await supabase
      .from('erp_os')
      .select(SELECT_OS)
      .eq('company_id', companyId)
      .not('status', 'in', '("entregue","cancelada")')  // pátio = carros ativos; entregues recentes entram via coluna própria abaixo
      .order('updated_at', { ascending: true })
      .limit(400)
    if (error) { setErro(error.message); setLoading(false); return }
    // Entregues recentes (a coluna filtra só as de HOJE; o resto vira "ver histórico").
    const { data: entregues } = await supabase
      .from('erp_os')
      .select(SELECT_OS)
      .eq('company_id', companyId).eq('status', 'entregue')
      .order('entregue_em', { ascending: false, nullsFirst: false }).limit(60)
    setOss([...(data ?? []), ...(entregues ?? [])] as OS[])
    // total de entregues (pro contador do histórico)
    const { count } = await supabase.from('erp_os').select('id', { count: 'exact', head: true })
      .eq('company_id', companyId).eq('status', 'entregue')
    setEntregueTotal(count ?? 0)
    setLoading(false)
  }, [companyId])

  useEffect(() => { void carregar() }, [carregar])

  // lista LIMPA do seletor (dedup identidade + Title Case + sem e-mail/TESTE/staff PS — via RPC)
  const carregarMecanicos = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_mecanicos', { p_company_id: companyId })
    setMecLimpos((Array.isArray(data) ? data.map((r: { nome: string }) => r.nome) : []))
  }, [companyId])
  useEffect(() => { void carregarMecanicos() }, [carregarMecanicos])

  // mecânicos da OS aberta (responsável + auxiliares)
  const carregarMecsOS = useCallback(async (osId: string) => {
    const { data } = await supabase.rpc('fn_os_mecanicos_listar', { p_os_id: osId })
    setMecsOS((Array.isArray(data) ? data : []) as MecOS[])
  }, [])
  // RD-41 · quais assinaturas (checklist_ciente/entrega) a OS já tem (helper simples)
  const recarregarAssinaturas = async (osId: string) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_os_assinaturas_listar', { p_company_id: companyId, p_os_id: osId })
    setAssinaturasCard(Array.isArray(data) ? data.map((r: { tipo: string }) => r.tipo) : [])
  }
  useEffect(() => {
    if (!cardAberto) { setMecsOS([]); setAssinaturasCard([]); return }
    void carregarMecsOS(cardAberto.id)
    void recarregarAssinaturas(cardAberto.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardAberto, carregarMecsOS, companyId])

  const filtradas = useMemo(
    () => (filtroMec === 'todos' ? oss : oss.filter((o) => normKey(o.tecnico_nome) === normKey(filtroMec))),
    [oss, filtroMec],
  )

  // designar responsável / adicionar auxiliar / remover — via RPC, com trilha no banco
  async function designar(rpc: 'fn_os_designar_responsavel' | 'fn_os_add_auxiliar', nome: string) {
    if (!cardAberto || !nome.trim()) return
    setSalvandoMec(true)
    const { data, error } = await supabase.rpc(rpc, { p_os_id: cardAberto.id, p_nome: nome.trim() })
    setSalvandoMec(false)
    const res = data as { ok?: boolean; erro?: string } | null
    if (error || !res?.ok) { setErro(error?.message || res?.erro || 'Falha ao designar mecânico'); return }
    setNovoMec('')
    await Promise.all([carregarMecsOS(cardAberto.id), carregarMecanicos(), carregar()])
  }
  async function removerMec(id: string) {
    if (!cardAberto) return
    setSalvandoMec(true)
    const { data, error } = await supabase.rpc('fn_os_remover_mecanico', { p_os_mecanico_id: id })
    setSalvandoMec(false)
    const res = data as { ok?: boolean; erro?: string } | null
    if (error || !res?.ok) { setErro(error?.message || res?.erro || 'Falha ao remover'); return }
    await Promise.all([carregarMecsOS(cardAberto.id), carregar()])
  }

  // A ação central: muda o status da OS (drag OU tap-picker). RLS escopa por
  // empresa; ainda travo por company_id (defense-in-depth). Otimista + refetch.
  async function mover(os: OS, novoStatus: string) {
    if (novoStatus === os.status) { setCardAberto(null); return }
    setSalvandoId(os.id)
    setOss((prev) => prev.map((o) => (o.id === os.id ? { ...o, status: novoStatus, updated_at: new Date().toISOString() } : o)))
    const { error } = await supabase.from('erp_os')
      .update({ status: novoStatus, updated_at: new Date().toISOString() })
      .eq('id', os.id).eq('company_id', os.company_id)
    setSalvandoId(null); setCardAberto(null)
    if (error) { setErro(error.message); void carregar(); return }
  }

  if (!companyId) {
    return (
      <div style={{ padding: 24, background: C.bg, minHeight: '100vh', color: C.espressoM }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold }}>Oficina</div>
        <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: C.espresso, margin: '4px 0 8px' }}>🚗 Pátio</h1>
        <div>Selecione uma empresa para ver o pátio.</div>
      </div>
    )
  }

  return (
    <div style={{ background: C.bg, minHeight: '100vh', padding: '16px 12px 40px' }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: C.gold, fontWeight: 700 }}>Oficina</div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, fontWeight: 400, color: C.espresso, margin: '2px 0 0' }}>🚗 Pátio</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filtroMec} onChange={(e) => setFiltroMec(e.target.value)}
            style={{ padding: '10px 12px', fontSize: 14, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espresso }}>
            <option value="todos">👥 Todos os mecânicos</option>
            {mecLimpos.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button onClick={() => void carregar()} title="Atualizar"
            style={{ padding: '10px 14px', fontSize: 14, fontWeight: 600, borderRadius: 8, border: `1px solid ${C.border}`, background: C.white, color: C.espresso, cursor: 'pointer' }}>↻</button>
        </div>
      </div>

      {erro && <div style={{ background: '#FEE2E2', color: C.vermelho, padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>{erro}</div>}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: C.espressoM }}>Carregando o pátio…</div>
      ) : (
        // Board compacto: cabe numa tela; cada coluna rola por dentro. Cor categórica por etapa.
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', height: 'calc(100vh - 150px)', paddingBottom: 4, WebkitOverflowScrolling: 'touch' }}>
          {COLUNAS.map((col) => {
            const cor = COL_COR[col.status] ?? C.espressoD
            const entregueCol = col.status === 'entregue'
            let cards = filtradas.filter((o) => o.status === col.status)
            if (entregueCol) cards = cards.filter((o) => ehHojeSP(o.entregue_em ?? o.updated_at))
            const histN = entregueCol ? Math.max(0, entregueTotal - cards.length) : 0
            return (
              <div key={col.status}
                onDragOver={(e) => { e.preventDefault() }}
                onDrop={() => { const o = oss.find((x) => x.id === dragId); if (o) void mover(o, col.status); setDragId(null) }}
                style={{ flex: '0 0 200px', minWidth: 200, background: '#FFFDF9', border: `1px solid ${C.border}`, borderTop: `3px solid ${cor}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 4px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.espresso }}>{col.icone} {entregueCol ? 'Entregue hoje' : col.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: cor, background: cor + '18', borderRadius: 20, padding: '1px 8px' }}>{cards.length}</span>
                </div>
                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minHeight: 0 }}>
                  {cards.length === 0 && <div style={{ padding: '14px 6px', color: C.espressoD, fontSize: 11, textAlign: 'center' }}>vazio</div>}
                  {cards.map((o) => {
                    const sem = semaforo(o)
                    const placa = placaDe(o)
                    const alta = (o.prioridade ?? '').match(/alta|urgente/i)
                    return (
                      <div key={o.id}
                        draggable={!isOperator}
                        onDragStart={() => { if (!isOperator) setDragId(o.id) }}
                        onClick={() => (isOperator ? setExecOs(o) : setCardAberto(o))}
                        style={{ background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${cor}`, borderRadius: 8, padding: '7px 9px', cursor: 'pointer', opacity: salvandoId === o.id ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {/* linha 1: placa (destaque) + tempo na coluna (semáforo/SLA) */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: 0.5, color: C.espresso, fontFamily: 'ui-monospace, Menlo, monospace' }}>{placa ?? 'sem placa'}</span>
                          <span title={`${Math.floor(sem.horas)}h na coluna`} style={{ fontSize: 9.5, fontWeight: 700, color: sem.cor, background: sem.cor + '18', borderRadius: 20, padding: '1px 7px', whiteSpace: 'nowrap' }}>{tempoCurto(sem.horas)}</span>
                        </div>
                        {/* linha 2: veículo · cliente (menor) */}
                        <div style={{ fontSize: 11, color: C.espressoM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{veiculoDe(o)} · {o.cliente_nome || '—'}</div>
                        {/* linha 3: OS# + alertas + mecânico (inicial) */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 9.5, fontFamily: 'ui-monospace, Menlo, monospace', color: C.espressoD, fontWeight: 600 }}>{o.numero || 'sem nº'}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {alta && <span title="Prioridade alta" style={{ fontSize: 10 }}>🔴</span>}
                            {o.status === 'aguardando_aprovacao' && <span title="Aguardando aprovação do cliente" style={{ fontSize: 10 }}>⚠️</span>}
                            <span title={mecanicoLabel(o.tecnico_nome)} style={{ width: 18, height: 18, borderRadius: 999, background: cor + '22', color: cor, fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{inicialMec(o.tecnico_nome)}</span>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {entregueCol && histN > 0 && (
                  <button onClick={() => router.push('/dashboard/oficina/entregues')}
                    style={{ fontSize: 11, fontWeight: 700, color: cor, background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 2px', textAlign: 'left' }}>
                    ver histórico ({histN}) →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Tablet: tap no card → picker de status GRANDE (2 toques, sem formulário) */}
      {cardAberto && (
        <div onClick={() => setCardAberto(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.45)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: C.white, borderRadius: '16px 16px 0 0', padding: 16, width: '100%', maxWidth: 520, boxShadow: '0 -4px 24px rgba(61,35,20,0.2)' }}>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.espresso }}>{placaDe(cardAberto) ?? `🚗 ${veiculoDe(cardAberto)}`}</div>
              <div style={{ fontSize: 12, color: C.espressoM }}>{veiculoDe(cardAberto)} · {cardAberto.cliente_nome || '—'}</div>
            </div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoD, textAlign: 'center', margin: '10px 0 8px' }}>Mover para</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {COLUNAS.map((col) => (
                <button key={col.status} onClick={() => void mover(cardAberto, col.status)}
                  disabled={col.status === cardAberto.status}
                  style={{
                    padding: '14px 10px', fontSize: 14, fontWeight: 700, borderRadius: 10, cursor: col.status === cardAberto.status ? 'default' : 'pointer',
                    border: `1px solid ${col.status === cardAberto.status ? C.gold : C.border}`,
                    background: col.status === cardAberto.status ? C.bg : C.white,
                    color: col.status === cardAberto.status ? C.gold : C.espresso, opacity: col.status === cardAberto.status ? 0.7 : 1,
                  }}>
                  {col.icone} {col.label}{col.status === cardAberto.status ? ' ✓' : ''}
                </button>
              ))}
            </div>

            {/* Designar mecânico — responsável + auxiliares, em qualquer coluna. Trilha no banco. */}
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoD, marginBottom: 6 }}>Mecânico</div>
              {mecsOS.filter((m) => m.ativo).length === 0 && (
                <div style={{ fontSize: 12, color: C.espressoM, marginBottom: 6 }}>Sem mecânico designado.</div>
              )}
              {mecsOS.filter((m) => m.ativo).map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: 14 }}>
                  <span style={{ color: C.espresso }}>
                    {m.papel === 'responsavel' ? '🔧 ' : '➕ '}<b>{tituloCase(m.mecanico_nome)}</b>
                    <span style={{ color: C.espressoM, fontSize: 12 }}> · {m.papel === 'responsavel' ? 'Responsável' : 'Auxiliar'}</span>
                  </span>
                  <button onClick={() => void removerMec(m.id)} disabled={salvandoMec}
                    style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.vermelho, cursor: 'pointer' }}>remover</button>
                </div>
              ))}
              <input list="mec-limpos" value={novoMec} onChange={(e) => setNovoMec(e.target.value)}
                placeholder="Nome do mecânico" enterKeyHint="done"
                style={{ width: '100%', marginTop: 8, padding: '11px 12px', fontSize: 15, borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, color: C.espresso }} />
              <datalist id="mec-limpos">{mecLimpos.map((m) => <option key={m} value={m} />)}</datalist>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => void designar('fn_os_designar_responsavel', novoMec)} disabled={salvandoMec || !novoMec.trim()}
                  style={{ flex: 1, padding: '12px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: 'none', background: C.gold, color: C.white, cursor: salvandoMec || !novoMec.trim() ? 'default' : 'pointer', opacity: salvandoMec || !novoMec.trim() ? 0.6 : 1 }}>Responsável</button>
                <button onClick={() => void designar('fn_os_add_auxiliar', novoMec)} disabled={salvandoMec || !novoMec.trim()}
                  style={{ flex: 1, padding: '12px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, color: C.espresso, cursor: salvandoMec || !novoMec.trim() ? 'default' : 'pointer', opacity: salvandoMec || !novoMec.trim() ? 0.6 : 1 }}>+ Auxiliar</button>
              </div>
            </div>

            {/* RD-41 · assinaturas operacionais do cliente (checklist na entrada, entrega na saída) */}
            <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: C.espressoD, marginBottom: 6 }}>Assinaturas do cliente</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: assinaturasCard.includes('checklist_ciente') ? C.verde : C.espressoD }}>
                  {assinaturasCard.includes('checklist_ciente') ? '✓' : '○'} Ciente do checklist
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: assinaturasCard.includes('entrega') ? C.verde : C.espressoD }}>
                  {assinaturasCard.includes('entrega') ? '✓' : '○'} Entrega
                </span>
              </div>
              <button onClick={() => setAssinarEntregaOs(cardAberto)}
                style={{ width: '100%', padding: '12px', fontSize: 14, fontWeight: 700, borderRadius: 10, border: `1px solid ${C.border}`, background: C.white, color: C.espresso, cursor: 'pointer' }}>
                ✍️ {assinaturasCard.includes('entrega') ? 'Refazer assinatura de entrega' : 'Assinar entrega'}
              </button>
            </div>

            <button onClick={() => { router.push(`/dashboard/os?os=${cardAberto.id}`) }}
              style={{ width: '100%', marginTop: 10, padding: '12px', fontSize: 13, fontWeight: 600, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.espresso, cursor: 'pointer' }}>
              📋 Abrir a Ordem de Serviço
            </button>
            <button onClick={() => setCardAberto(null)}
              style={{ width: '100%', marginTop: 8, padding: '10px', fontSize: 13, color: C.espressoM, background: 'transparent', border: 'none', cursor: 'pointer' }}>Fechar</button>
          </div>
        </div>
      )}

      {/* RD-41 · Assinar entrega (saída) — a partir do card no Pátio. */}
      {assinarEntregaOs && companyId && (
        <AssinaturaModal
          osId={assinarEntregaOs.id}
          tipo="entrega"
          titulo="Assinar entrega"
          subtitulo="Recebi o veículo com o serviço finalizado."
          aberto
          onFechar={() => setAssinarEntregaOs(null)}
          onAssinado={() => { if (assinarEntregaOs) void recarregarAssinaturas(assinarEntregaOs.id) }}
        />
      )}

      {/* RD-41 · Visão de Execução (Auxiliar/OPERATOR): abre em contexto pelo clique no card. */}
      {execOs && companyId && (
        <VisaoExecucaoModal
          companyId={companyId}
          osId={execOs.id}
          osResumo={{ numero: execOs.numero, placa: placaDe(execOs), marca: execOs.marca, modelo: execOs.modelo, cliente_nome: execOs.cliente_nome }}
          aberto
          onFechar={() => { setExecOs(null); void carregar() }}
        />
      )}
    </div>
  )
}
