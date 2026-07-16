'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

export type VisitaFotoRef = { path: string; name?: string }

export type VisitaInicial = {
  id?: string
  oportunidade_id: string
  data_visita: string | null
  responsavel_id: string | null
  status: 'agendada' | 'realizada' | 'cancelada'
  endereco: string | null
  anotacoes: string | null
  gps_lat: number | null
  gps_lng: number | null
  fotos: VisitaFotoRef[] | null
}

export type OportunidadeOpt = {
  id: string
  titulo: string
  obra_endereco: string | null
  cliente_nome: string | null
}

interface Props {
  companyId: string
  /** se nao passar, exibe seletor de oportunidade carregando do company */
  oportunidadeFixa?: OportunidadeOpt | null
  initial?: VisitaInicial | null
  onClose: () => void
  onSaved: (visitaId: string) => void
}

type UserOpt = { id: string; email: string | null; full_name?: string | null }

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO  = '#C8941A'
const BORDA    = '#E7DED3'
const TEXTM    = '#6b5444'

function nowLocalInput(): string {
  const d = new Date()
  const tzMin = d.getTimezoneOffset()
  d.setMinutes(d.getMinutes() - tzMin)
  return d.toISOString().slice(0, 16)
}

export default function VisitaFormModal({ companyId, oportunidadeFixa, initial, onClose, onSaved }: Props) {
  const isEdit = !!initial?.id

  // Oportunidade selecionada (id) — pre-seleciona se fixa ou se initial
  const [oportunidadeId, setOportunidadeId] = useState<string>(
    oportunidadeFixa?.id ?? initial?.oportunidade_id ?? '',
  )
  const [oportunidades, setOportunidades] = useState<OportunidadeOpt[]>(
    oportunidadeFixa ? [oportunidadeFixa] : [],
  )

  const [data, setData] = useState<string>(() => {
    if (initial?.data_visita) {
      const d = new Date(initial.data_visita)
      const tz = d.getTimezoneOffset()
      d.setMinutes(d.getMinutes() - tz)
      return d.toISOString().slice(0, 16)
    }
    return nowLocalInput()
  })
  const [responsavelId, setResponsavelId] = useState<string>(initial?.responsavel_id ?? '')
  const [status, setStatus] = useState<'agendada' | 'realizada' | 'cancelada'>(initial?.status ?? 'agendada')
  const [endereco, setEndereco] = useState<string>(initial?.endereco ?? oportunidadeFixa?.obra_endereco ?? '')
  const [anotacoes, setAnotacoes] = useState<string>(initial?.anotacoes ?? '')
  const [files, setFiles] = useState<File[]>([])
  const [fotosExistentes, setFotosExistentes] = useState<VisitaFotoRef[]>(initial?.fotos ?? [])
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(
    initial?.gps_lat != null && initial?.gps_lng != null
      ? { lat: Number(initial.gps_lat), lng: Number(initial.gps_lng) }
      : null,
  )
  const [users, setUsers] = useState<UserOpt[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // Carrega usuarios ATIVOS da empresa (todos — decisao CEO). Escopo por company_id (RD-45).
  useEffect(() => {
    supabase
      .from('user_companies')
      .select('users(id, email, full_name, is_active)')
      .eq('company_id', companyId)
      .then(({ data }) => {
        const list = (data ?? []) as unknown as Array<{ users: (UserOpt & { is_active?: boolean }) | (UserOpt & { is_active?: boolean })[] | null }>
        const flat: UserOpt[] = []
        for (const r of list) {
          const u = Array.isArray(r.users) ? r.users[0] : r.users
          if (u && (u.is_active ?? true)) flat.push({ id: u.id, email: u.email, full_name: u.full_name })
        }
        flat.sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '', 'pt-BR'))
        setUsers(flat)
      })
  }, [companyId])

  // Carrega oportunidades abertas do company (se nao fixa)
  useEffect(() => {
    if (oportunidadeFixa) return
    supabase
      .from('erp_crm_oportunidade')
      .select('id, titulo, obra_endereco, etapa, erp_clientes(nome_fantasia, razao_social)')
      .eq('company_id', companyId)
      .not('etapa', 'in', '(ganho,perdido)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as unknown as Array<{
          id: string; titulo: string; obra_endereco: string | null
          erp_clientes: { nome_fantasia: string | null; razao_social: string | null } | null
        }>
        const list: OportunidadeOpt[] = rows.map((r) => ({
          id: r.id,
          titulo: r.titulo,
          obra_endereco: r.obra_endereco,
          cliente_nome: r.erp_clientes?.nome_fantasia ?? r.erp_clientes?.razao_social ?? null,
        }))
        setOportunidades(list)
      })
  }, [companyId, oportunidadeFixa])

  // Quando troca oportunidade, sugere endereco da obra
  useEffect(() => {
    if (!oportunidadeId || initial) return
    const o = oportunidades.find((x) => x.id === oportunidadeId)
    if (o?.obra_endereco && !endereco) setEndereco(o.obra_endereco)
  }, [oportunidadeId, oportunidades, initial, endereco])

  function capturarGPS() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErr('Geolocalização não disponível neste navegador.')
      return
    }
    setErr(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (e) => setErr(`GPS falhou: ${e.message}`),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  function removerFotoExistente(idx: number) {
    setFotosExistentes((prev) => prev.filter((_, i) => i !== idx))
  }

  async function salvar() {
    if (!oportunidadeId) { setErr('Selecione a oportunidade.'); return }
    if (!data) { setErr('Informe a data/hora.'); return }
    setSaving(true)
    setErr(null)

    // Upload novas fotos para bucket visitas/{oportunidade_id}
    const fotosNovas: VisitaFotoRef[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const safe = f.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${companyId}/visitas/${oportunidadeId}/${Date.now()}_${i}_${safe}`
      const up = await supabase.storage.from('projetos-plantas').upload(path, f, { upsert: false })
      if (up.error) { setSaving(false); setErr(`Upload falhou: ${up.error.message}`); return }
      fotosNovas.push({ path, name: f.name })
    }
    const fotosTodas = [...fotosExistentes, ...fotosNovas]

    const { data: rpc, error } = await supabase.rpc('fn_crm_visita_salvar', {
      p_id: initial?.id ?? null,
      p_oportunidade_id: oportunidadeId,
      p_data_visita: new Date(data).toISOString(),
      p_responsavel_id: responsavelId || null,
      p_status: status,
      p_endereco: endereco || null,
      p_anotacoes: anotacoes || null,
      p_gps_lat: gps?.lat ?? null,
      p_gps_lng: gps?.lng ?? null,
      p_fotos: fotosTodas,
    })
    setSaving(false)
    if (error) { setErr(`Erro: ${error.message}`); return }
    const r = rpc as { ok?: boolean; visita_id?: string; erro?: string } | null
    if (!r || r.ok === false) { setErr(`Erro: ${r?.erro ?? 'falha'}`); return }
    onSaved(r.visita_id!)
  }

  return (
    <div style={overlay}>
      <div style={card}>
        <div style={head}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: ESPRESSO, margin: 0 }}>
            {isEdit ? 'Editar visita' : 'Registrar visita'}
          </h2>
          <button onClick={onClose} style={closeBtn} aria-label="Fechar">✕</button>
        </div>

        {!oportunidadeFixa && (
          <label style={lbl}>
            Oportunidade *
            <Combobox
              value={oportunidadeId}
              onChange={setOportunidadeId}
              disabled={isEdit}
              placeholder="Digite pra buscar (obra, cliente)…"
              vazioTexto="Nenhuma oportunidade aberta nesta empresa."
              options={oportunidades.map((o) => ({ id: o.id, label: o.titulo, sub: o.cliente_nome }))}
            />
          </label>
        )}
        {oportunidadeFixa && (
          <div style={{ ...lblTxt, marginBottom: 8 }}>
            Oportunidade: <strong style={{ color: ESPRESSO }}>{oportunidadeFixa.titulo}</strong>
          </div>
        )}

        <div style={grid}>
          <label style={lbl}>
            Data / hora *
            <input type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} style={inp} />
          </label>
          <label style={lbl}>
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={inp}>
              <option value="agendada">agendada</option>
              <option value="realizada">realizada</option>
              <option value="cancelada">cancelada</option>
            </select>
          </label>
          <label style={lbl}>
            Responsável
            <Combobox
              value={responsavelId}
              onChange={setResponsavelId}
              placeholder="Digite pra buscar o vendedor…"
              vazioTexto="Nenhum usuário nesta empresa. Cadastre em Acessos."
              options={users.map((u) => ({ id: u.id, label: u.full_name ?? u.email ?? u.id.slice(0, 8), sub: u.full_name ? u.email : null }))}
            />
          </label>
        </div>

        <label style={{ ...lbl, marginTop: 10 }}>
          Endereço
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)} style={inp} placeholder="rua, nº, bairro" />
        </label>

        <label style={{ ...lbl, marginTop: 10 }}>
          Anotações
          <textarea
            rows={3}
            value={anotacoes}
            onChange={(e) => setAnotacoes(e.target.value)}
            style={{ ...inp, resize: 'vertical' }}
            placeholder="Medidas, observações do cliente, riscos…"
          />
        </label>

        <div style={{ marginTop: 10 }}>
          <div style={lblTxt}>Fotos</div>
          {fotosExistentes.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {fotosExistentes.map((f, i) => (
                <span key={f.path} style={fotoChip}>
                  📎 {f.name ?? `foto ${i + 1}`}
                  <button onClick={() => removerFotoExistente(i)} style={fotoX} aria-label="Remover">×</button>
                </span>
              ))}
            </div>
          )}
          <input
            type="file"
            multiple
            accept="image/*"
            capture="environment"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            style={{ fontSize: 13 }}
          />
          {files.length > 0 && <p style={{ fontSize: 12, color: TEXTM, marginTop: 4 }}>{files.length} nova(s) foto(s) a enviar</p>}
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={capturarGPS} style={btnSec}>📍 Capturar GPS</button>
          {gps && <span style={{ fontSize: 12, color: TEXTM }}>lat {gps.lat.toFixed(5)} · lng {gps.lng.toFixed(5)}</span>}
        </div>

        {err && <p style={{ color: '#b00', fontSize: 13, marginTop: 8 }}>Erro: {err}</p>}

        <div style={actions}>
          <button onClick={onClose} style={btnGhost}>Cancelar</button>
          <button onClick={salvar} disabled={saving} style={btnPrimary}>
            {saving ? 'Salvando…' : isEdit ? 'SALVAR' : 'REGISTRAR'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Combobox com busca (mobile-first): digita pra filtrar, toca pra escolher. Reusa nas 2 listas.
function Combobox({ value, options, onChange, placeholder, vazioTexto, disabled }: {
  value: string
  options: { id: string; label: string; sub?: string | null }[]
  onChange: (id: string) => void
  placeholder: string
  vazioTexto?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const selecionado = options.find((o) => o.id === value)
  const termo = q.trim().toLowerCase()
  const filtradas = termo
    ? options.filter((o) => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(termo))
    : options
  return (
    <div style={{ position: 'relative' }}>
      <input
        style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
        disabled={disabled}
        placeholder={placeholder}
        value={open ? q : (selecionado ? `${selecionado.label}${selecionado.sub ? ` · ${selecionado.sub}` : ''}` : '')}
        onFocus={() => { if (!disabled) { setOpen(true); setQ('') } }}
        onChange={(e) => setQ(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && !disabled && (
        <div style={dropdown}>
          {filtradas.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: TEXTM }}>{vazioTexto ?? 'Nada encontrado.'}</div>
          ) : filtradas.slice(0, 50).map((o) => (
            <button
              key={o.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(o.id); setOpen(false); setQ('') }}
              style={{ ...dropItem, background: o.id === value ? OFFWHITE : '#fff' }}
            >
              <span style={{ fontWeight: 600, color: ESPRESSO }}>{o.label}</span>
              {o.sub && <span style={{ color: TEXTM, marginLeft: 6 }}>· {o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const dropdown: CSSProperties = {
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 60, marginTop: 2,
  background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 8,
  boxShadow: '0 6px 20px rgba(0,0,0,.12)', maxHeight: 240, overflowY: 'auto',
}
const dropItem: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none',
  padding: '10px 12px', fontSize: 13, cursor: 'pointer', minHeight: 40,
  borderBottom: `1px solid ${OFFWHITE}`,
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  padding: 16, zIndex: 50, overflow: 'auto',
}
const card: CSSProperties = {
  background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 640,
}
const head: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
}
const closeBtn: CSSProperties = {
  border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', minWidth: 44, minHeight: 44,
}
const grid: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10,
}
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM }
const lblTxt: CSSProperties = { fontSize: 12, color: TEXTM, marginBottom: 4 }
const inp: CSSProperties = {
  border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40,
  background: '#fff', color: ESPRESSO,
  colorScheme: 'light' as CSSProperties['colorScheme'],
}
const actions: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }
const btnGhost: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', minHeight: 44,
}
const btnPrimary: CSSProperties = {
  border: 'none', background: DOURADO, color: '#fff', borderRadius: 10,
  padding: '10px 16px', cursor: 'pointer', fontWeight: 600, minHeight: 44,
}
const btnSec: CSSProperties = {
  border: `1px solid ${BORDA}`, background: '#fff', color: ESPRESSO,
  borderRadius: 8, padding: '8px 12px', fontSize: 12, cursor: 'pointer', minHeight: 36,
}
const fotoChip: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  border: `1px solid ${BORDA}`, background: OFFWHITE, color: ESPRESSO,
  borderRadius: 999, padding: '2px 8px', fontSize: 11,
}
const fotoX: CSSProperties = {
  border: 'none', background: 'transparent', color: '#9A1F1F',
  cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0,
}
