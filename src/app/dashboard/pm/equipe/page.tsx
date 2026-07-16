'use client'
// EQUIPE (P&M). Sobre agency_equipe — custo/hora por pessoa é a BASE da margem (sem isso, margem=R$0).
// Escopo por company_id (RD-45). Tema Espresso. Reusa o padrão de Leads/Propostas.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'; const OFFWHITE = '#FAF7F2'; const DOURADO = '#C8941A'
const BORDA = '#E7DED3'; const TEXTM = '#6b5444'; const RED = '#7A1F1F'
const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

type Membro = {
  id: string; company_id: string; user_id: string | null; nome: string; cargo: string | null
  setor: string | null; custo_hora: number | null; jornada_horas_dia: number | null; ativo: boolean
}

export default function EquipePage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)
  const [membros, setMembros] = useState<Membro[]>([])
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState<Partial<Membro> | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setMembros([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('agency_equipe').select('*').eq('company_id', empresa).order('nome')
    setMembros((data ?? []) as Membro[]); setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const kpis = useMemo(() => ({
    total: membros.filter((m) => m.ativo).length,
    custoMedio: membros.length ? membros.reduce((s, m) => s + Number(m.custo_hora ?? 0), 0) / membros.length : 0,
  }), [membros])

  async function salvar() {
    if (!empresa || !edit) return
    if (!edit.nome?.trim()) { setToast('Informe o nome.'); return }
    setBusy(true)
    const payload = {
      company_id: empresa, nome: edit.nome.trim(), cargo: edit.cargo ?? null, setor: edit.setor ?? null,
      custo_hora: edit.custo_hora != null ? Number(edit.custo_hora) : null,
      jornada_horas_dia: edit.jornada_horas_dia != null ? Number(edit.jornada_horas_dia) : 8, ativo: edit.ativo ?? true,
    }
    const { error } = edit.id
      ? await supabase.from('agency_equipe').update(payload).eq('id', edit.id)
      : await supabase.from('agency_equipe').insert(payload)
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setEdit(null); setToast(edit.id ? 'Membro ALTERADO.' : 'Membro CRIADO.'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🏭 P&amp;M · Produção</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Equipe</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Custo/hora por pessoa — a base do cálculo de margem.</p>
          </div>
          <button onClick={() => setEdit({ ativo: true, jornada_horas_dia: 8 })} style={btnPri}>+ Novo membro</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Membros ativos" v={String(kpis.total)} />
          <Kpi l="Custo/hora médio" v={brl(kpis.custoMedio)} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : membros.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              Cadastre a equipe com o custo/hora — sem isso a margem por job sai R$ 0.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {membros.map((m) => (
                <div key={m.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontWeight: 700 }}>{m.nome}{!m.ativo && <span style={{ color: RED, fontSize: 11, fontWeight: 400 }}> · inativo</span>}</div>
                    <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{m.cargo ?? '—'}{m.setor ? ` · ${m.setor}` : ''} · {m.jornada_horas_dia ?? 8}h/dia</div>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: 110 }}>
                    <div style={{ fontWeight: 700, color: m.custo_hora ? ESPRESSO : RED }}>{m.custo_hora ? `${brl(Number(m.custo_hora))}/h` : 'sem custo/h'}</div>
                  </div>
                  <button onClick={() => setEdit(m)} style={btnSec}>Editar</button>
                </div>
              ))}
            </div>
          )}
      </div>

      {edit && (
        <div style={overlay} onClick={() => setEdit(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{edit.id ? 'Editar membro' : 'Novo membro'}</h2>
            <label style={lbl}>Nome *<input style={inp} value={edit.nome ?? ''} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Cargo<input style={inp} value={edit.cargo ?? ''} onChange={(e) => setEdit({ ...edit, cargo: e.target.value })} /></label>
              <label style={lbl}>Setor<input style={inp} value={edit.setor ?? ''} onChange={(e) => setEdit({ ...edit, setor: e.target.value })} /></label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Custo/hora (R$)<input type="number" style={inp} value={edit.custo_hora ?? ''} onChange={(e) => setEdit({ ...edit, custo_hora: e.target.value === '' ? null : Number(e.target.value) })} /></label>
              <label style={lbl}>Jornada (h/dia)<input type="number" style={inp} value={edit.jornada_horas_dia ?? 8} onChange={(e) => setEdit({ ...edit, jornada_horas_dia: Number(e.target.value) })} /></label>
            </div>
            <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={edit.ativo ?? true} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /> Ativo
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setEdit(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={salvar} style={btnPri}>{busy ? 'Salvando…' : (edit.id ? 'SALVAR' : 'CRIAR')}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

function Kpi({ l, v }: { l: string; v: string }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, color: TEXTM, fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: ESPRESSO, marginTop: 2 }}>{v}</div>
    </div>
  )
}
const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40, background: '#fff', color: ESPRESSO }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM, marginTop: 8 }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 42 }
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 460, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
