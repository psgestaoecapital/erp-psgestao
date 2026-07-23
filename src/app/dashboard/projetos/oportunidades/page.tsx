'use client'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { labelUsuario } from '@/lib/usuarioLabel'
import OportunidadeFormModal, { type OportunidadeRow } from './OportunidadeFormModal'
import OportunidadesKanban from './OportunidadesKanban'

type Row = {
  id: string
  company_id: string
  cliente_id: string | null
  titulo: string
  etapa: string
  valor_estimado: number | null
  origem: string | null
  obra_endereco: string | null
  obra_cidade: string | null
  obra_bairro: string | null
  probabilidade: number | null
  responsavel_id: string | null
  responsavel_nome: string | null
  data_prevista_fechamento: string | null
  observacoes: string | null
  created_at: string
  erp_clientes: { nome_fantasia: string | null; razao_social: string | null } | null
}

type ResumoCRM = {
  abertas?: number
  ganhas_mes?: number
  valor_pipeline?: number
}

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'

const ETAPAS: { v: string; l: string; bg: string; fg: string }[] = [
  { v: 'prospeccao',       l: 'Prospecção',       bg: '#F0E9DE', fg: '#6b5444' },
  { v: 'visita_agendada',  l: 'Visita agendada',  bg: '#FFF3D6', fg: '#7A5A0F' },
  { v: 'visita_feita',     l: 'Visita feita',     bg: '#E7DED3', fg: '#3D2314' },
  { v: 'orcando',          l: 'Orçando',          bg: '#FCE9C2', fg: '#7A5A0F' },
  { v: 'proposta_enviada', l: 'Proposta enviada', bg: '#FAD18A', fg: '#5A3D08' },
  { v: 'negociacao',       l: 'Negociação',       bg: '#F4B860', fg: '#3D2314' },
  { v: 'ganho',            l: 'Ganho',            bg: '#DCEFD7', fg: '#1F5A1F' },
  { v: 'perdido',          l: 'Perdido',          bg: '#F4D6D6', fg: '#7A1F1F' },
]

const brl = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function OportunidadesPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [rows, setRows] = useState<Row[]>([])
  const [resumo, setResumo] = useState<ResumoCRM | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<OportunidadeRow | null | undefined>(undefined)
  const [filtroEtapa, setFiltroEtapa] = useState<string>('todas')
  const [filtroResp, setFiltroResp] = useState<string>('todos')
  const [busca, setBusca] = useState('')
  const [responsaveis, setResponsaveis] = useState<Array<{ id: string; email: string | null; full_name?: string | null }>>([])
  const [toast, setToast] = useState<string | null>(null)
  const [excluindoId, setExcluindoId] = useState<string | null>(null)
  const [countKanban, setCountKanban] = useState(0)
  const [kanbanKey, setKanbanKey] = useState(0)

  const reload = useCallback(async () => {
    if (!empresaUnica) { setRows([]); setResumo(null); setLoading(false); return }
    setLoading(true)
    const [lista, pipe] = await Promise.all([
      supabase
        .from('erp_crm_oportunidade')
        .select('id, company_id, cliente_id, titulo, etapa, valor_estimado, origem, obra_endereco, obra_cidade, obra_bairro, probabilidade, responsavel_id, responsavel_nome, data_prevista_fechamento, observacoes, created_at, erp_clientes(nome_fantasia, razao_social)')
        .eq('company_id', empresaUnica)
        .order('created_at', { ascending: false }),
      supabase.rpc('fn_crm_pipeline', { p_company_id: empresaUnica }),
    ])
    setRows((lista.data ?? []) as unknown as Row[])
    const r = pipe.data as { resumo?: ResumoCRM } | null
    setResumo(r?.resumo ?? null)
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  function rowParaForm(r: Row): OportunidadeRow {
    return {
      id: r.id,
      company_id: r.company_id,
      cliente_id: r.cliente_id,
      titulo: r.titulo,
      etapa: r.etapa,
      valor_estimado: r.valor_estimado,
      origem: r.origem,
      obra_endereco: r.obra_endereco,
      obra_cidade: r.obra_cidade,
      obra_bairro: r.obra_bairro,
      responsavel_id: r.responsavel_id,
      responsavel_nome: r.responsavel_nome,
      data_prevista_fechamento: r.data_prevista_fechamento,
      probabilidade: r.probabilidade,
      observacoes: r.observacoes,
    }
  }

  async function excluir(r: Row) {
    if (!confirm(`Tem certeza que deseja EXCLUIR a oportunidade "${r.titulo}"?\n\nIsso remove tambem todas as interacoes e visitas vinculadas. Nao pode ser desfeito.`)) return
    setExcluindoId(r.id)
    const { error } = await supabase.from('erp_crm_oportunidade').delete().eq('id', r.id)
    setExcluindoId(null)
    if (error) {
      const msg = /permission|rls|policy/i.test(error.message)
        ? 'Sem permissao para excluir esta oportunidade.'
        : `Erro ao excluir: ${error.message}`
      setToast(msg)
      return
    }
    setToast(`Oportunidade EXCLUIDA: "${r.titulo}".`)
    reload()
  }

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!empresaUnica) return
    // Usuários via RPC SECURITY DEFINER (users tem RLS: join direto vem vazio p/ não-admin).
    supabase
      .rpc('fn_usuarios_da_empresa', { p_company_id: empresaUnica })
      .then(({ data }) => {
        setResponsaveis((data ?? []) as { id: string; email: string | null; full_name?: string | null }[])
      })
  }, [empresaUnica])

  if (!empresaUnica) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: ESPRESSO }}>
        <header className="mb-4">
          <h1 className="text-xl font-bold">🎯 Oportunidades · Funil</h1>
        </header>
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm opacity-70">Use o trocador da TopNav para escolher uma empresa.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 w-full" style={{ color: ESPRESSO }}>
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">🎯 Oportunidades · Funil</h1>
          <p className="text-sm opacity-70">CRM de obra: leads, propostas e negociação.</p>
        </div>
        <button onClick={() => setEditing(null)} style={btnNovo}>+ Nova oportunidade</button>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4" style={{ maxWidth: 640 }}>
        <Kpi titulo="Em aberto"     valor={String(resumo?.abertas ?? 0)} />
        <Kpi titulo="Ganhas no mês" valor={String(resumo?.ganhas_mes ?? 0)} />
        <Kpi titulo="Pipeline (R$)" valor={brl(resumo?.valor_pipeline)} destaque />
      </div>

      {/* Filtros herdados da antiga Lista — agora sempre visíveis (Kanban é a única visão) */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <select value={filtroEtapa} onChange={(e) => setFiltroEtapa(e.target.value)} style={selSt}>
          <option value="todas">Todas as etapas</option>
          {ETAPAS.map((e) => <option key={e.v} value={e.v}>{e.l}</option>)}
        </select>
        <select value={filtroResp} onChange={(e) => setFiltroResp(e.target.value)} style={selSt}>
          <option value="todos">Todos os responsáveis</option>
          {responsaveis.map((u) => <option key={u.id} value={u.id}>{labelUsuario(u, responsaveis)}</option>)}
        </select>
        <input
          placeholder="Buscar por título ou cliente…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ ...selSt, minWidth: 200, flex: 1 }}
        />
        {loading && <span className="text-xs opacity-60">Carregando…</span>}
        <span className="text-xs opacity-60 ml-auto">{countKanban} oportunidade(s)</span>
      </div>

      <OportunidadesKanban
        companyId={empresaUnica}
        refreshKey={kanbanKey}
        filtroEtapa={filtroEtapa}
        filtroResp={filtroResp}
        busca={busca}
        onCount={setCountKanban}
        onEdit={(id) => { const r = rows.find((x) => x.id === id); if (r) setEditing(rowParaForm(r)) }}
        onExcluir={(id) => { const r = rows.find((x) => x.id === id); if (r) excluir(r) }}
        excluindoId={excluindoId}
        onMoved={(m) => { setToast(m); reload(); setKanbanKey((k) => k + 1) }}
        onError={(m) => setToast(m)}
      />

      {editing !== undefined && (
        <OportunidadeFormModal
          companyId={empresaUnica}
          initial={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            const eraEdicao = !!editing?.id
            setEditing(undefined)
            setToast(eraEdicao ? 'Oportunidade ALTERADA.' : 'Oportunidade CRIADA.')
            reload(); setKanbanKey((k) => k + 1)
          }}
        />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ titulo, valor, destaque }: { titulo: string; valor: string; destaque?: boolean }) {
  return (
    <div className="rounded-xl p-3" style={{ background: OFFWHITE, minHeight: 76 }}>
      <div className="text-[11px] uppercase opacity-60 leading-tight">{titulo}</div>
      <div className="font-bold leading-tight" style={{ color: destaque ? DOURADO : ESPRESSO, fontSize: 18 }}>{valor}</div>
    </div>
  )
}

const btnNovo: CSSProperties = {
  background: DOURADO, color: '#fff', border: 'none', borderRadius: 10,
  padding: '10px 16px', fontWeight: 600, cursor: 'pointer', minHeight: 44,
}
const selSt: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 8,
  padding: '8px 10px', fontSize: 13, color: ESPRESSO, minHeight: 40,
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
const toastStyle: CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: ESPRESSO, color: '#fff', padding: '10px 16px', borderRadius: 10,
  fontSize: 13, zIndex: 60, maxWidth: '90vw',
}
