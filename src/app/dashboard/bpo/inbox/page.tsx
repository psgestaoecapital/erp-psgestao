'use client'

import { useState, useEffect, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { PSGC_COLORS } from '@/lib/psgc-tokens'
import PSGCButton from '@/components/psgc/PSGCButton'

type InboxItem = {
  item_id: string
  company_id: string
  empresa: string
  tipo_origem: 'tarefa' | 'alerta' | 'classificacao' | 'manual' | 'cliente'
  titulo: string
  descricao: string | null
  categoria: string | null
  prioridade: 'urgente' | 'alta' | 'normal' | 'baixa'
  sla_vence_em: string | null
  horas_ate_sla: number | null
  status_sla: 'atrasado' | 'urgente' | 'hoje' | 'ok' | 'sem_sla'
  ia_confianca: number | null
  ia_acao_sugerida: string | null
  ia_contexto: string | null
  created_at: string
}

export default function BPOInboxPage() {
  const [items, setItems] = useState<InboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<InboxItem | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string>('')
  const [filterEmpresa, setFilterEmpresa] = useState<string>('todas')
  const [filterPrioridade, setFilterPrioridade] = useState<string>('todas')
  const [filterTipo, setFilterTipo] = useState<string>('todos')
  const [busca, setBusca] = useState<string>('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Paleta local: nomes preservados, valores referenciam PSGC_COLORS.
  const C = {
    espresso: PSGC_COLORS.espresso,
    offwhite: PSGC_COLORS.offWhite,
    card: PSGC_COLORS.offWhite,
    dourado: PSGC_COLORS.dourado,
    douradoClaro: PSGC_COLORS.douradoSoft,
    txt: PSGC_COLORS.espresso,
    txtMedio: PSGC_COLORS.espressoLight,
    txtClaro: PSGC_COLORS.espressoLight,
    border: PSGC_COLORS.offWhiteDarker,
    atrasado: PSGC_COLORS.alta,
    urgente: PSGC_COLORS.media,
    hoje: PSGC_COLORS.douradoAlerta,
    ok: PSGC_COLORS.baixa,
  }

  // Cor da confianca IA por faixa (3 niveis - reuso padrao Etapa 2E)
  const corConfianca = (pct: number) => {
    if (pct >= 80) return PSGC_COLORS.baixa
    if (pct >= 60) return PSGC_COLORS.dourado
    return PSGC_COLORS.alta
  }

  const slaColor = (status: string) => {
    switch (status) {
      case 'atrasado': return C.atrasado
      case 'urgente': return C.urgente
      case 'hoje': return C.hoje
      case 'ok': return C.ok
      default: return C.txtClaro
    }
  }

  const slaLabel = (status: string, horas: number | null) => {
    if (status === 'sem_sla') return 'Sem SLA'
    if (status === 'atrasado') return `Atrasado ${Math.abs(horas ?? 0).toFixed(0)}h`
    if (horas === null) return '-'
    if (horas < 1) return `${Math.round(horas * 60)}min`
    if (horas < 24) return `${horas.toFixed(0)}h`
    return `${Math.floor(horas / 24)}d`
  }

  const prioridadeColor = (p: string) => {
    switch (p) {
      case 'urgente': return C.atrasado
      case 'alta': return C.urgente
      case 'normal': return C.dourado
      default: return C.txtClaro
    }
  }

  useEffect(() => {
    loadCurrentUser()
  }, [])

  useEffect(() => {
    if (userId) loadInbox()
  }, [userId])

  async function loadCurrentUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profile } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('email', user.email)
      .single()

    if (profile) {
      setUserId(profile.id)
      setUserName(profile.full_name)
    }
  }

  async function loadInbox() {
    if (!userId) return
    setLoading(true)

    const { data, error } = await supabase.rpc('fn_inbox_operador', {
      p_user_id: userId,
    })

    if (!error && data) {
      setItems(data as InboxItem[])
    }
    setLoading(false)
  }

  const empresas = useMemo(() => {
    const set = new Set<string>()
    items.forEach(i => set.add(i.empresa))
    return Array.from(set).sort()
  }, [items])

  const itemsFiltered = useMemo(() => {
    return items.filter(i => {
      if (filterEmpresa !== 'todas' && i.empresa !== filterEmpresa) return false
      if (filterPrioridade !== 'todas' && i.prioridade !== filterPrioridade) return false
      if (filterTipo !== 'todos' && i.tipo_origem !== filterTipo) return false
      if (busca && !i.titulo.toLowerCase().includes(busca.toLowerCase())) return false
      return true
    })
  }, [items, filterEmpresa, filterPrioridade, filterTipo, busca])

  const stats = useMemo(() => {
    const atrasados = items.filter(i => i.status_sla === 'atrasado').length
    const urgentes = items.filter(i => i.status_sla === 'urgente' || i.prioridade === 'urgente').length
    const hoje = items.filter(i => i.status_sla === 'hoje').length
    return { total: items.length, atrasados, urgentes, hoje }
  }, [items])

  async function handleAction(item: InboxItem, action: 'aprovar' | 'rejeitar' | 'escalar') {
    setActionLoading(item.item_id)

    const updates: Record<string, unknown> = {
      status: action === 'aprovar' || action === 'rejeitar' ? 'concluido' : 'pendente',
      resolvido_em: new Date().toISOString(),
      resolvido_por: userId,
    }

    if (action === 'escalar') {
      updates.prioridade = 'urgente'
      updates.operador_notas = `Escalado em ${new Date().toISOString()}`
    }

    const { error } = await supabase
      .from('bpo_inbox_items')
      .update(updates)
      .eq('id', item.item_id)

    if (!error) {
      if (item.tipo_origem === 'alerta') {
        await supabase
          .from('bpo_alertas')
          .update({ status: action === 'aprovar' ? 'resolvido' : 'rejeitado' })
          .eq('id', item.item_id)
      }
      if (item.tipo_origem === 'classificacao') {
        await supabase
          .from('bpo_classificacoes')
          .update({ status: action === 'aprovar' ? 'aprovado' : 'rejeitado' })
          .eq('id', item.item_id)
      }

      await loadInbox()
      setSelectedItem(null)
    }
    setActionLoading(null)
  }

  // ─── Sub-componentes (DENTRO do componente principal pra closure sobre C) ───

  function KpiCard({ label, valor, cor }: { label: string; valor: number; cor: string }) {
    return (
      <div style={{
        backgroundColor: 'rgba(255,255,255,0.1)', // PRESERVADO: overlay no header espresso
        padding: '10px 16px',
        borderRadius: 8,
        minWidth: 90,
        textAlign: 'center',
        borderLeft: `3px solid ${cor}`,
      }}>
        <div style={{ fontSize: 24, fontWeight: 'bold', fontFamily: 'Georgia, serif', color: cor }}>{valor}</div>
        <div style={{ fontSize: 10, color: C.offwhite, textTransform: 'uppercase', letterSpacing: 1, marginTop: 2 }}>{label}</div>
      </div>
    )
  }

  function Badge({ label, bg }: { label: string; bg: string }) {
    return (
      <span style={{
        fontSize: 10,
        padding: '3px 8px',
        backgroundColor: bg,
        color: C.offwhite,
        borderRadius: 4,
        fontWeight: 'bold',
        letterSpacing: 1,
      }}>
        {label}
      </span>
    )
  }

  function ItemCard({ item, selected, onClick }: {
    item: InboxItem
    selected: boolean
    onClick: () => void
  }) {
    return (
      <div
        onClick={onClick}
        style={{
          backgroundColor: C.offwhite,
          padding: '12px 16px',
          borderRadius: 8,
          border: selected ? `2px solid ${prioridadeColor(item.prioridade)}` : '2px solid transparent',
          borderLeft: `6px solid ${prioridadeColor(item.prioridade)}`,
          cursor: 'pointer',
          boxShadow: selected ? '0 4px 12px rgba(61,35,20,0.1)' : '0 1px 3px rgba(61,35,20,0.04)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 'bold', color: C.txtClaro, textTransform: 'uppercase', letterSpacing: 1 }}>
                {item.empresa}
              </span>
              {item.ia_confianca !== null && (
                <span style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  backgroundColor: corConfianca(item.ia_confianca),
                  color: C.offwhite,
                  borderRadius: 4,
                  fontWeight: 'bold',
                }}>
                  IA {item.ia_confianca}%
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 'bold', color: C.txt, marginBottom: 4 }}>
              {item.titulo}
            </div>
            {item.descricao && (
              <div style={{ fontSize: 12, color: C.txtMedio, lineHeight: 1.4 }}>
                {item.descricao.length > 120 ? item.descricao.substring(0, 120) + '...' : item.descricao}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{
              fontSize: 11,
              fontWeight: 'bold',
              color: slaColor(item.status_sla),
              padding: '4px 8px',
              backgroundColor: slaColor(item.status_sla) + '15',
              borderRadius: 4,
              whiteSpace: 'nowrap',
            }}>
              {slaLabel(item.status_sla, item.horas_ate_sla)}
            </div>
            {item.ia_acao_sugerida && (
              <div style={{ fontSize: 10, color: C.txtMedio, marginTop: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
                IA: {item.ia_acao_sugerida}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  function DetailPanel({ item, onClose, onAction, actionLoading }: {
    item: InboxItem
    onClose: () => void
    onAction: (item: InboxItem, action: 'aprovar' | 'rejeitar' | 'escalar') => void
    actionLoading: boolean
  }) {
    return (
      <div style={{ backgroundColor: C.offwhite, borderRadius: 12, padding: 24, boxShadow: '0 4px 16px rgba(61,35,20,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 'bold', color: C.txtClaro, textTransform: 'uppercase', letterSpacing: 2 }}>
              {item.empresa}
            </div>
            <div style={{ fontSize: 20, fontFamily: 'Georgia, serif', fontWeight: 'bold', color: C.txt, marginTop: 4 }}>
              {item.titulo}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: C.txtClaro }}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          <Badge label={item.tipo_origem.toUpperCase()} bg={C.espresso} />
          <Badge label={item.prioridade.toUpperCase()} bg={prioridadeColor(item.prioridade)} />
          <Badge label={item.status_sla.toUpperCase()} bg={slaColor(item.status_sla)} />
          {item.categoria && <Badge label={item.categoria} bg={C.dourado} />}
        </div>

        {item.descricao && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 'bold', color: C.txtMedio, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Descricao
            </div>
            <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5 }}>
              {item.descricao}
            </div>
          </div>
        )}

        {item.ia_contexto && (
          <div style={{
            marginBottom: 16,
            padding: '12px 14px',
            backgroundColor: PSGC_COLORS.dourado + '10',
            borderLeft: `3px solid ${C.dourado}`,
            borderRadius: 4,
          }}>
            <div style={{ fontSize: 10, fontWeight: 'bold', color: C.dourado, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              Analise da IA {item.ia_confianca !== null && `- Confianca ${item.ia_confianca}%`}
            </div>
            <div style={{ fontSize: 13, color: C.txt, lineHeight: 1.5 }}>
              {item.ia_contexto}
            </div>
            {item.ia_acao_sugerida && (
              <div style={{ fontSize: 12, color: C.espresso, marginTop: 8, fontWeight: 'bold' }}>
                Acao sugerida: <span style={{ color: C.dourado }}>{item.ia_acao_sugerida}</span>
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
          <PSGCButton
            variant="success"
            size="md"
            disabled={actionLoading}
            fullWidth
            onClick={() => onAction(item, 'aprovar')}
          >
            {actionLoading ? '...' : 'Aprovar'}
          </PSGCButton>
          <PSGCButton
            variant="danger"
            size="md"
            disabled={actionLoading}
            fullWidth
            onClick={() => onAction(item, 'rejeitar')}
          >
            Rejeitar
          </PSGCButton>
          <PSGCButton
            variant="attention"
            size="md"
            disabled={actionLoading}
            fullWidth
            onClick={() => onAction(item, 'escalar')}
          >
            Escalar
          </PSGCButton>
        </div>
      </div>
    )
  }

  const selectStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    fontSize: 13,
    backgroundColor: C.offwhite,
    cursor: 'pointer',
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: 'calc(100vh - 64px)', fontFamily: 'inherit', margin: -24, padding: 0 }}>
      {/* HEADER ESPRESSO FULL-WIDTH */}
      <div style={{ backgroundColor: C.espresso, padding: '24px 32px', color: C.offwhite }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: C.douradoClaro, fontWeight: 'bold', letterSpacing: 2 }}>
              CENTRAL BPO PS GESTAO
            </div>
            <h1 style={{ fontSize: 32, fontFamily: 'Georgia, serif', margin: '4px 0 0 0', fontWeight: 'bold' }}>
              Inbox do Operador
            </h1>
            <div style={{ fontSize: 13, color: C.douradoClaro, marginTop: 4 }}>
              {userName} - {itemsFiltered.length} de {stats.total} tarefas
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <KpiCard label="Total" valor={stats.total} cor={C.douradoClaro} />
            <KpiCard label="Atrasados" valor={stats.atrasados} cor={C.atrasado} />
            <KpiCard label="Urgentes" valor={stats.urgentes} cor={C.urgente} />
            <KpiCard label="Hoje" valor={stats.hoje} cor={C.hoje} />
          </div>
        </div>
      </div>

      {/* FILTER BAR */}
      <div style={{
        padding: '16px 32px',
        backgroundColor: C.offwhite,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
      }}>
        <input
          type="text"
          placeholder="Buscar por titulo..."
          value={busca}
          onChange={ev => setBusca(ev.target.value)}
          style={{ padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 13, minWidth: 220, backgroundColor: C.offwhite, color: C.txt }}
        />
        <select value={filterEmpresa} onChange={ev => setFilterEmpresa(ev.target.value)} style={selectStyle}>
          <option value="todas">Todas empresas</option>
          {empresas.map(emp => <option key={emp} value={emp}>{emp}</option>)}
        </select>
        <select value={filterPrioridade} onChange={ev => setFilterPrioridade(ev.target.value)} style={selectStyle}>
          <option value="todas">Todas prioridades</option>
          <option value="urgente">Urgente</option>
          <option value="alta">Alta</option>
          <option value="normal">Normal</option>
          <option value="baixa">Baixa</option>
        </select>
        <select value={filterTipo} onChange={ev => setFilterTipo(ev.target.value)} style={selectStyle}>
          <option value="todos">Todos tipos</option>
          <option value="classificacao">Classificacao IA</option>
          <option value="alerta">Alerta</option>
          <option value="tarefa">Tarefa de rotina</option>
          <option value="cliente">Solicitacao cliente</option>
        </select>
        <PSGCButton variant="primary" size="sm" onClick={loadInbox}>
          Atualizar
        </PSGCButton>
      </div>

      {/* LAYOUT 2 COLUNAS */}
      <div style={{ padding: '16px 32px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: selectedItem ? '1 1 500px' : '1 1 100%', minWidth: 0 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: C.txtMedio }}>Carregando inbox...</div>
          ) : itemsFiltered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: C.txtMedio, backgroundColor: C.offwhite, borderRadius: 8 }}>
              <div style={{ fontSize: 48, marginBottom: 12, color: C.ok }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 'bold', color: C.txt }}>Inbox vazio</div>
              <div style={{ fontSize: 13, marginTop: 4 }}>Todas as tarefas estao concluidas.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {itemsFiltered.map(item => (
                <ItemCard
                  key={item.item_id}
                  item={item}
                  selected={selectedItem?.item_id === item.item_id}
                  onClick={() => setSelectedItem(item)}
                />
              ))}
            </div>
          )}
        </div>

        {selectedItem && (
          <div style={{ flex: '1 1 400px', position: 'sticky', top: 16, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
            <DetailPanel
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
              onAction={handleAction}
              actionLoading={actionLoading === selectedItem.item_id}
            />
          </div>
        )}
      </div>
    </div>
  )
}
