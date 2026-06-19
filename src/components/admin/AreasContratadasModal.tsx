'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

type AreaStatus = {
  area_slug: string
  nome_menu: string
  status_comercial: string | null
  ordem: number
  habilitada: boolean
  plano_principal_id: string | null
}

type Grupo = 'disponiveis' | 'em_dev' | 'roadmap'

interface Props {
  companyId: string
  companyName: string
  onClose: () => void
}

const GRUPO_LABEL: Record<Grupo, string> = {
  disponiveis: 'Disponíveis',
  em_dev: 'Em desenvolvimento',
  roadmap: 'Roadmap',
}

function classificar(status: string | null): Grupo {
  if (status === 'piloto' || status === 'em_producao') return 'disponiveis'
  if (status === 'backlog') return 'em_dev'
  return 'roadmap'
}

function BadgeStatus({ status }: { status: string | null }) {
  if (status === 'piloto') {
    return (
      <span style={{ ...badgeBase, background: '#FAEEDA', color: '#854F0B' }}>
        Piloto
      </span>
    )
  }
  if (status === 'backlog' || status === 'futuro') {
    return (
      <span style={{ ...badgeBase, background: 'rgba(61,35,20,0.08)', color: 'rgba(61,35,20,0.70)' }}>
        Em breve
      </span>
    )
  }
  return null
}

export default function AreasContratadasModal({ companyId, companyName, onClose }: Props) {
  const [areas, setAreas] = useState<AreaStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function carregar() {
    setLoading(true)
    setErr(null)
    const { data, error } = await supabase.rpc('fn_empresa_areas_status', {
      p_company_id: companyId,
    })
    if (error) setErr(error.message)
    else setAreas((data ?? []) as AreaStatus[])
    setLoading(false)
  }

  useEffect(() => { carregar() }, [companyId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  async function toggle(area: AreaStatus) {
    setToggling(area.area_slug)
    const novoEstado = !area.habilitada
    const { data, error } = await supabase.rpc('fn_empresa_area_toggle', {
      p_company_id: companyId,
      p_area_slug: area.area_slug,
      p_habilitar: novoEstado,
    })
    setToggling(null)
    if (error) {
      setToast(`Erro: ${error.message}`)
      return
    }
    const r = data as { ok?: boolean; acao?: string; erro?: string } | null
    if (r?.erro) {
      setToast(`Erro: ${r.erro}`)
      return
    }
    setAreas((prev) =>
      prev.map((a) => (a.area_slug === area.area_slug ? { ...a, habilitada: novoEstado } : a))
    )
    setToast(
      novoEstado
        ? `Habilitou ${area.nome_menu}`
        : `Desabilitou ${area.nome_menu}`
    )
  }

  // agrupa preservando ordem original
  const grupos: Record<Grupo, AreaStatus[]> = {
    disponiveis: [],
    em_dev: [],
    roadmap: [],
  }
  for (const a of areas) grupos[classificar(a.status_comercial)].push(a)

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#3D2314', margin: 0 }}>
              Áreas contratadas
            </h2>
            <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.60)', margin: '2px 0 0 0' }}>
              {companyName}
            </p>
          </div>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>

        {loading && (
          <p style={{ fontSize: 13, color: 'rgba(61,35,20,0.55)', textAlign: 'center', padding: 24 }}>
            Carregando…
          </p>
        )}

        {err && !loading && (
          <p style={{ fontSize: 13, color: '#9A1F1F', padding: '12px 0' }}>
            Erro: {err}
          </p>
        )}

        {!loading && !err && areas.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {(['disponiveis', 'em_dev', 'roadmap'] as Grupo[]).map((g) => {
              const itens = grupos[g]
              if (itens.length === 0) return null
              return (
                <section key={g}>
                  <div style={grupoLabel}>{GRUPO_LABEL[g]}</div>
                  <ul style={listCard}>
                    {itens.map((a, i) => (
                      <li key={a.area_slug}>
                        {i > 0 && <div style={divisor} />}
                        <ItemArea
                          area={a}
                          toggling={toggling === a.area_slug}
                          onToggle={() => toggle(a)}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        )}

        {toast && <div style={toastStyle}>{toast}</div>}
      </div>
    </div>
  )
}

function ItemArea({
  area,
  toggling,
  onToggle,
}: {
  area: AreaStatus
  toggling: boolean
  onToggle: () => void
}) {
  return (
    <div style={itemRow}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: '#3D2314' }}>
            {area.nome_menu}
          </span>
          <BadgeStatus status={area.status_comercial} />
        </div>
        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginTop: 2 }}>
          {area.habilitada ? 'Contratado' : 'Não contratado'}
          {area.plano_principal_id && ` · ${area.plano_principal_id}`}
        </div>
      </div>
      <Toggle on={area.habilitada} loading={toggling} onClick={onToggle} />
    </div>
  )
}

function Toggle({
  on,
  loading,
  onClick,
}: {
  on: boolean
  loading: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-pressed={on}
      style={{
        position: 'relative',
        width: 44,
        height: 24,
        borderRadius: 12,
        border: 'none',
        background: on ? '#C8941A' : 'rgba(61,35,20,0.20)',
        cursor: loading ? 'wait' : 'pointer',
        flexShrink: 0,
        transition: 'background 0.15s',
        opacity: loading ? 0.6 : 1,
        minWidth: 44,
        minHeight: 24,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 22 : 2,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left 0.15s',
          boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
        }}
      />
    </button>
  )
}

const overlay: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 16,
  zIndex: 100,
  overflow: 'auto',
}
const card: CSSProperties = {
  background: '#FAF7F2',
  borderRadius: 16,
  padding: 20,
  width: '100%',
  maxWidth: 560,
  marginTop: '4vh',
}
const head: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 16,
}
const closeBtn: CSSProperties = {
  border: 'none',
  background: 'none',
  fontSize: 20,
  cursor: 'pointer',
  color: '#3D2314',
  minWidth: 44,
  minHeight: 44,
}
const badgeBase: CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '2px 8px',
  borderRadius: 4,
  fontWeight: 600,
}
const grupoLabel: CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontWeight: 500,
  color: 'rgba(61,35,20,0.45)',
  paddingLeft: 4,
  paddingBottom: 6,
}
const listCard: CSSProperties = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  background: '#fff',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: '0 0 0 0.5px rgba(61,35,20,0.10)',
}
const divisor: CSSProperties = {
  height: 0.5,
  background: 'rgba(61,35,20,0.08)',
  margin: '0 12px',
}
const itemRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px',
  minHeight: 44,
}
const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 20,
  left: '50%',
  transform: 'translateX(-50%)',
  background: '#3D2314',
  color: '#fff',
  padding: '10px 16px',
  borderRadius: 10,
  fontSize: 13,
  zIndex: 110,
  maxWidth: '90vw',
}
