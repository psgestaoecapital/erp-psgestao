'use client'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import VisitaFormModal, { type VisitaInicial, type OportunidadeOpt } from '@/components/crm/VisitaFormModal'

type Row = {
  id: string
  company_id: string
  oportunidade_id: string
  data_visita: string | null
  responsavel_id: string | null
  status: 'agendada' | 'realizada' | 'cancelada'
  endereco: string | null
  anotacoes: string | null
  gps_lat: number | null
  gps_lng: number | null
  fotos: Array<{ path: string; name?: string }> | null
  created_at: string
  erp_crm_oportunidade: {
    id: string
    titulo: string
    obra_endereco: string | null
    erp_clientes: { nome_fantasia: string | null; razao_social: string | null } | null
  } | null
}

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'
const TEXTM    = '#6b5444'

const STATUS_CFG: Record<string, { l: string; bg: string; fg: string }> = {
  agendada:  { l: 'Agendada',  bg: '#FFF3D6', fg: '#7A5A0F' },
  realizada: { l: 'Realizada', bg: '#DCEFD7', fg: '#1F5A1F' },
  cancelada: { l: 'Cancelada', bg: '#F4D6D6', fg: '#7A1F1F' },
}

const fmtDT = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

export default function VisitasPage() {
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<'todas' | 'agendada' | 'realizada' | 'cancelada'>('todas')
  const [responsaveis, setResponsaveis] = useState<Array<{ id: string; email: string | null }>>([])
  const [editing, setEditing] = useState<VisitaInicial | null | undefined>(undefined)
  const [toast, setToast] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!empresaUnica) { setRows([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase
      .from('erp_crm_visita')
      .select('id, company_id, oportunidade_id, data_visita, responsavel_id, status, endereco, anotacoes, gps_lat, gps_lng, fotos, created_at, erp_crm_oportunidade(id, titulo, obra_endereco, erp_clientes(nome_fantasia, razao_social))')
      .eq('company_id', empresaUnica)
      .order('data_visita', { ascending: false, nullsFirst: false })
    setRows((data ?? []) as unknown as Row[])
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    if (!empresaUnica) return
    // Usuários via RPC SECURITY DEFINER (users tem RLS: join direto vem vazio p/ não-admin).
    supabase
      .rpc('fn_usuarios_da_empresa', { p_company_id: empresaUnica })
      .then(({ data }) => {
        setResponsaveis((data ?? []) as { id: string; email: string | null }[])
      })
  }, [empresaUnica])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const filtradas = useMemo(() => {
    if (filtroStatus === 'todas') return rows
    return rows.filter((r) => r.status === filtroStatus)
  }, [rows, filtroStatus])

  function abrirEdicao(r: Row) {
    setEditing({
      id: r.id,
      oportunidade_id: r.oportunidade_id,
      data_visita: r.data_visita,
      responsavel_id: r.responsavel_id,
      status: r.status,
      endereco: r.endereco,
      anotacoes: r.anotacoes,
      gps_lat: r.gps_lat,
      gps_lng: r.gps_lng,
      fotos: r.fotos,
    })
  }

  if (!empresaUnica) {
    return (
      <div className="p-4 max-w-3xl mx-auto" style={{ color: ESPRESSO }}>
        <header className="mb-4">
          <h1 className="text-xl font-bold">📍 Visitas técnicas</h1>
        </header>
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Selecione uma empresa específica</p>
          <p className="text-sm opacity-70">Use o trocador da TopNav para escolher uma empresa.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-w-5xl mx-auto" style={{ color: ESPRESSO }}>
      <header className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">📍 Visitas técnicas</h1>
          <p className="text-sm opacity-70">Vendedor em campo: agenda, registra e fotografa.</p>
        </div>
        <button onClick={() => setEditing(null)} style={btnNovo}>+ Nova visita</button>
      </header>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div role="tablist" aria-label="Status" style={chipsWrap}>
          {(['todas','agendada','realizada','cancelada'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              style={{ ...chipBtn, ...(filtroStatus === s ? chipBtnActive : {}) }}
            >
              {s === 'todas' ? 'Todas' : STATUS_CFG[s].l}
            </button>
          ))}
        </div>
        <span className="text-xs opacity-60 ml-auto">{filtradas.length} visita(s)</span>
      </div>

      {loading && <p className="opacity-60">Carregando…</p>}

      {!loading && filtradas.length === 0 && (
        <div className="rounded-xl p-6 text-center" style={{ background: OFFWHITE }}>
          <p className="font-medium">Nenhuma visita ainda.</p>
          <p className="text-sm opacity-70">Clique em &ldquo;+ Nova visita&rdquo; para registrar.</p>
        </div>
      )}

      <div className="space-y-2">
        {filtradas.map((r) => {
          const cfg = STATUS_CFG[r.status] ?? { l: r.status, bg: OFFWHITE, fg: ESPRESSO }
          const resp = responsaveis.find((u) => u.id === r.responsavel_id)
          const op = r.erp_crm_oportunidade
          const cliNome = op?.erp_clientes?.nome_fantasia ?? op?.erp_clientes?.razao_social ?? null
          const nFotos = (r.fotos ?? []).length
          return (
            <div
              key={r.id}
              className="rounded-xl border p-4"
              style={{ borderColor: BORDA, background: '#fff' }}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <div className="font-semibold" style={{ color: ESPRESSO }}>{fmtDT(r.data_visita)}</div>
                  {op && (
                    <div className="text-sm" style={{ color: TEXTM }}>
                      <Link href={`/dashboard/projetos/oportunidades/${op.id}`} style={{ color: DOURADO, textDecoration: 'underline' }}>
                        {op.titulo}
                      </Link>
                      {cliNome && <span> · {cliNome}</span>}
                    </div>
                  )}
                  {r.endereco && <div className="text-xs" style={{ color: TEXTM }}>{r.endereco}</div>}
                </div>
                <span className="text-[11px] px-2 py-1 rounded-full font-medium" style={{ background: cfg.bg, color: cfg.fg }}>
                  {cfg.l}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: TEXTM }}>
                {resp && <span>resp: {resp.email}</span>}
                {nFotos > 0 && <span>{nFotos} foto(s)</span>}
                {r.gps_lat != null && r.gps_lng != null && (
                  <span>📍 lat {Number(r.gps_lat).toFixed(4)}, lng {Number(r.gps_lng).toFixed(4)}</span>
                )}
              </div>
              <div className="mt-3 flex gap-2 flex-wrap">
                <button onClick={() => abrirEdicao(r)} style={btnSec}>Editar</button>
                {op && (
                  <Link href={`/dashboard/projetos/oportunidades/${op.id}`} style={btnSec as React.CSSProperties}>
                    Abrir oportunidade →
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {editing !== undefined && (
        <VisitaFormModal
          companyId={empresaUnica}
          oportunidadeFixa={editing?.oportunidade_id
            ? rowParaOportunidadeOpt(rows.find((r) => r.id === editing?.id))
            : null}
          initial={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            const eraEdit = !!editing?.id
            setEditing(undefined)
            setToast(eraEdit ? 'Visita ALTERADA.' : 'Visita REGISTRADA.')
            reload()
          }}
        />
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function rowParaOportunidadeOpt(r: Row | undefined): OportunidadeOpt | null {
  const op = r?.erp_crm_oportunidade
  if (!op) return null
  return {
    id: op.id,
    titulo: op.titulo,
    obra_endereco: op.obra_endereco,
    cliente_nome: op.erp_clientes?.nome_fantasia ?? op.erp_clientes?.razao_social ?? null,
  }
}

const btnNovo: CSSProperties = {
  background: DOURADO, color: '#fff', border: 'none', borderRadius: 10,
  padding: '10px 16px', fontWeight: 600, cursor: 'pointer', minHeight: 44,
}
const btnSec: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO,
  borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer',
  minHeight: 36, textDecoration: 'none', display: 'inline-block',
}
const chipsWrap: CSSProperties = {
  display: 'inline-flex', border: `1px solid ${BORDA}`, borderRadius: 999,
  background: '#fff', padding: 2,
}
const chipBtn: CSSProperties = {
  border: 'none', background: 'transparent', color: TEXTM,
  borderRadius: 999, padding: '6px 14px', fontSize: 12, cursor: 'pointer',
  minHeight: 32, fontWeight: 600,
}
const chipBtnActive: CSSProperties = { background: DOURADO, color: '#fff' }
const toastStyle: CSSProperties = {
  position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  background: ESPRESSO, color: '#fff', padding: '10px 16px', borderRadius: 10,
  fontSize: 13, zIndex: 60, maxWidth: '90vw',
}
