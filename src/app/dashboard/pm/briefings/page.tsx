'use client'
// BRIEFINGS (P&M). Sobre agency_briefings, escopado por company_id (RD-45). Entrada estruturada
// (objetivo/público/referências) que vira Job. Tema Espresso claro. Reusa o padrão de Leads/Propostas.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO = '#C8941A'
const BORDA = '#E7DED3'
const TEXTM = '#6b5444'
const GREEN = '#1F5A1F'

const STATUS: Record<string, { l: string; cor: string }> = {
  novo: { l: 'Novo', cor: '#FFF3D6' },
  em_analise: { l: 'Em análise', cor: '#FCE9C2' },
  aprovado: { l: 'Aprovado', cor: '#DCEFD7' },
  virou_job: { l: 'Virou job', cor: '#E7DED3' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }

type Briefing = {
  id: string; company_id: string; cliente_id: string | null; titulo: string
  descricao: string | null; objetivo: string | null; publico_alvo: string | null
  referencias: string | null; tipo_servico: string | null; prioridade: string | null
  status: string; created_at: string
}
type ClienteOpt = { id: string; nome: string; nome_fantasia: string | null }

export default function BriefingsPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [briefings, setBriefings] = useState<Briefing[]>([])
  const [clientes, setClientes] = useState<ClienteOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState({ cliente_id: '', titulo: '', objetivo: '', publico_alvo: '', referencias: '', tipo_servico: '' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setBriefings([]); setLoading(false); return }
    setLoading(true)
    const [b, c] = await Promise.all([
      supabase.from('agency_briefings').select('*').eq('company_id', empresa).order('created_at', { ascending: false }),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa).order('nome'),
    ])
    setBriefings((b.data ?? []) as Briefing[])
    setClientes((c.data ?? []) as ClienteOpt[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const nomeCliente = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const kpis = useMemo(() => ({
    total: briefings.length,
    pendentes: briefings.filter((b) => ['novo', 'em_analise'].includes(b.status)).length,
    viraramJob: briefings.filter((b) => b.status === 'virou_job').length,
  }), [briefings])

  async function criar() {
    if (!empresa) return
    if (!form.titulo.trim()) { setToast('Informe o título do briefing.'); return }
    setBusy(true)
    const { error } = await supabase.from('agency_briefings').insert({
      company_id: empresa, cliente_id: form.cliente_id || null, titulo: form.titulo.trim(),
      objetivo: form.objetivo.trim() || null, publico_alvo: form.publico_alvo.trim() || null,
      referencias: form.referencias.trim() || null, tipo_servico: form.tipo_servico.trim() || null, status: 'novo',
    })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setNovo(false); setForm({ cliente_id: '', titulo: '', objetivo: '', publico_alvo: '', referencias: '', tipo_servico: '' })
    setToast('Briefing CRIADO.'); void carregar()
  }

  async function virarJob(b: Briefing) {
    if (!empresa) return
    if (!confirm(`Transformar "${b.titulo}" em Job de produção?`)) return
    setBusy(true)
    const { error } = await supabase.from('agency_jobs').insert({
      company_id: empresa, cliente_id: b.cliente_id, briefing_id: b.id,
      titulo: b.titulo, descricao: b.objetivo, tipo: b.tipo_servico ?? 'social', status: 'nao_iniciada', prioridade: 'normal',
    })
    if (!error) await supabase.from('agency_briefings').update({ status: 'virou_job', updated_at: new Date().toISOString() }).eq('id', b.id)
    setBusy(false)
    setToast(error ? `Erro: ${error.message}` : 'Job CRIADO a partir do briefing.'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎯 P&amp;M · Comercial</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Briefings</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Entrada estruturada da demanda → vira Job de produção.</p>
          </div>
          <button onClick={() => setNovo(true)} style={btnPri}>+ Novo briefing</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Briefings" v={String(kpis.total)} />
          <Kpi l="Pendentes" v={String(kpis.pendentes)} />
          <Kpi l="Viraram job" v={String(kpis.viraramJob)} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : briefings.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              Registre o briefing da reunião com o cliente.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {briefings.map((b) => {
                const cfg = stCfg(b.status)
                return (
                  <div key={b.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 700 }}>{b.titulo}<span style={{ color: TEXTM, fontWeight: 400 }}> · {nomeCliente(b.cliente_id)}</span></div>
                      {b.objetivo && <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{b.objetivo}</div>}
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: cfg.cor, padding: '3px 10px', borderRadius: 999 }}>{cfg.l}</span>
                    {b.status !== 'virou_job'
                      ? <button disabled={busy} onClick={() => virarJob(b)} style={btnGanhar}>→ Virar job</button>
                      : <span style={{ fontSize: 11, color: GREEN, fontWeight: 700 }}>✓ em produção</span>}
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {novo && (
        <div style={overlay} onClick={() => setNovo(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>Novo briefing</h2>
            <label style={lbl}>Cliente
              <select style={inp} value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}>
                <option value="">—</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia ?? c.nome}</option>)}
              </select>
            </label>
            <label style={lbl}>Título *<input style={inp} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} /></label>
            <label style={lbl}>Objetivo<textarea rows={2} style={{ ...inp, resize: 'vertical' }} value={form.objetivo} onChange={(e) => setForm({ ...form, objetivo: e.target.value })} /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Público-alvo<input style={inp} value={form.publico_alvo} onChange={(e) => setForm({ ...form, publico_alvo: e.target.value })} /></label>
              <label style={lbl}>Tipo de serviço<input style={inp} value={form.tipo_servico} onChange={(e) => setForm({ ...form, tipo_servico: e.target.value })} placeholder="social, design, vídeo…" /></label>
            </div>
            <label style={lbl}>Referências<input style={inp} value={form.referencias} onChange={(e) => setForm({ ...form, referencias: e.target.value })} placeholder="links, exemplos" /></label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => setNovo(false)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={criar} style={btnPri}>{busy ? 'Salvando…' : 'CRIAR'}</button>
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
const btnGanhar: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 40 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
