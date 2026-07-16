'use client'
// LEADS · CRM de entrada da agência (P&M). Funil sobre agency_leads, escopado por company_id (RD-45).
// Reusa o padrão do Workspace (producao): empresa do localStorage, tema Espresso claro.
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESPRESSO = '#3D2314'
const OFFWHITE = '#FAF7F2'
const DOURADO = '#C8941A'
const BORDA = '#E7DED3'
const TEXTM = '#6b5444'
const GREEN = '#1F5A1F'
const RED = '#7A1F1F'

const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const ORIGENS: { v: string; l: string }[] = [
  { v: 'prospeccao_ia_fria', l: 'Prospecção IA (fria)' },
  { v: 'indicacao', l: 'Indicação' },
  { v: 'trafego_pago', l: 'Tráfego pago' },
  { v: 'relacionamento', l: 'Relacionamento' },
]
const ETAPAS: { v: string; l: string; cor: string }[] = [
  { v: 'novo', l: 'Novo', cor: '#F0E9DE' },
  { v: 'atendimento', l: 'Atendimento', cor: '#FFF3D6' },
  { v: 'reuniao_agendada', l: 'Reunião agendada', cor: '#FCE9C2' },
  { v: 'entendimento', l: 'Entendimento', cor: '#FAD18A' },
  { v: 'proposta', l: 'Proposta', cor: '#F4B860' },
  { v: 'negociacao', l: 'Negociação', cor: '#E8A93A' },
  { v: 'ganho', l: 'Ganho', cor: '#DCEFD7' },
  { v: 'perdido', l: 'Perdido', cor: '#F4D6D6' },
]
const etapaCfg = (v: string) => ETAPAS.find((e) => e.v === v) ?? { v, l: v, cor: OFFWHITE }
const origemL = (v: string) => ORIGENS.find((o) => o.v === v)?.l ?? v

type Lead = {
  id: string; company_id: string; nome: string; empresa: string | null
  origem: string; canal_contato: string | null; etapa: string
  reuniao_agendada_em: string | null; valor_estimado: number | null
  responsavel_id: string | null; cliente_id: string | null
  motivo_perda: string | null; observacoes: string | null; criado_em: string
}

export default function LeadsPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [fOrigem, setFOrigem] = useState('todas')
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState<{ nome: string; empresa: string; origem: string; valor_estimado: string; canal_contato: string }>(
    { nome: '', empresa: '', origem: 'trafego_pago', valor_estimado: '', canal_contato: '' })
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const carregar = async () => {
    if (!empresa) { setLeads([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('agency_leads').select('*').eq('company_id', empresa).order('criado_em', { ascending: false })
    setLeads((data ?? []) as Lead[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const filtrados = useMemo(() => fOrigem === 'todas' ? leads : leads.filter((l) => l.origem === fOrigem), [leads, fOrigem])
  const kpis = useMemo(() => ({
    total: leads.length,
    emAberto: leads.filter((l) => !['ganho', 'perdido'].includes(l.etapa)).length,
    ganhos: leads.filter((l) => l.etapa === 'ganho').length,
    pipeline: leads.filter((l) => !['ganho', 'perdido'].includes(l.etapa)).reduce((s, l) => s + Number(l.valor_estimado ?? 0), 0),
  }), [leads])

  async function criar() {
    if (!empresa) return
    if (!form.nome.trim()) { setToast('Informe o nome do contato.'); return }
    setBusy(true)
    const { error } = await supabase.from('agency_leads').insert({
      company_id: empresa, nome: form.nome.trim(), empresa: form.empresa.trim() || null,
      origem: form.origem, canal_contato: form.canal_contato.trim() || null,
      valor_estimado: form.valor_estimado ? Number(form.valor_estimado) : null, etapa: 'novo',
    })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setNovo(false); setForm({ nome: '', empresa: '', origem: 'trafego_pago', valor_estimado: '', canal_contato: '' })
    setToast('Lead CRIADO.'); void carregar()
  }

  async function moverEtapa(l: Lead, etapa: string) {
    const patch: Record<string, unknown> = { etapa, atualizado_em: new Date().toISOString() }
    await supabase.from('agency_leads').update(patch).eq('id', l.id)
    setToast(`Lead ALTERADO para ${etapaCfg(etapa).l}.`); void carregar()
  }

  async function ganhar(l: Lead) {
    if (!empresa) return
    if (!confirm(`Marcar "${l.nome}" como GANHO?\nIsto CRIA um cliente na agência a partir do lead.`)) return
    setBusy(true)
    let clienteId = l.cliente_id
    if (!clienteId) {
      const { data: c, error: e1 } = await supabase.from('agency_clientes')
        .insert({ company_id: empresa, nome: l.empresa || l.nome, nome_fantasia: l.empresa || l.nome, status: 'ativo', tipo_contrato: 'recorrente' })
        .select('id').single()
      if (e1) { setBusy(false); setToast(`Erro: ${e1.message}`); return }
      clienteId = (c as { id: string }).id
    }
    await supabase.from('agency_leads').update({ etapa: 'ganho', cliente_id: clienteId, atualizado_em: new Date().toISOString() }).eq('id', l.id)
    setBusy(false); setToast('Lead GANHO · cliente CRIADO.'); void carregar()
  }

  async function perder(l: Lead) {
    const motivo = prompt('Motivo da perda (opcional):', '')
    if (motivo === null) return
    await supabase.from('agency_leads').update({ etapa: 'perdido', motivo_perda: motivo || null, atualizado_em: new Date().toISOString() }).eq('id', l.id)
    setToast('Lead marcado como PERDIDO.'); void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎯 P&amp;M · Comercial</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Leads · CRM de entrada</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Funil da agência: da prospecção ao ganho. Escopo por empresa.</p>
          </div>
          <button onClick={() => setNovo(true)} style={btnPri}>+ Novo lead</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Leads" v={String(kpis.total)} />
          <Kpi l="Em aberto" v={String(kpis.emAberto)} />
          <Kpi l="Ganhos" v={String(kpis.ganhos)} />
          <Kpi l="Pipeline" v={brl(kpis.pipeline)} />
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: TEXTM }}>Origem:</span>
          <select value={fOrigem} onChange={(e) => setFOrigem(e.target.value)} style={inp}>
            <option value="todas">Todas</option>
            {ORIGENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : filtrados.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              Nenhum lead ainda. Cadastre o primeiro contato.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {filtrados.map((l) => {
                const cfg = etapaCfg(l.etapa)
                const fim = ['ganho', 'perdido'].includes(l.etapa)
                return (
                  <div key={l.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700 }}>{l.nome}{l.empresa ? <span style={{ color: TEXTM, fontWeight: 400 }}> · {l.empresa}</span> : null}</div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{origemL(l.origem)}{l.canal_contato ? ` · ${l.canal_contato}` : ''}{l.valor_estimado ? ` · ${brl(Number(l.valor_estimado))}` : ''}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: cfg.cor, padding: '3px 10px', borderRadius: 999 }}>{cfg.l}</span>
                    {!fim && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <select value={l.etapa} onChange={(e) => moverEtapa(l, e.target.value)} style={{ ...inp, minWidth: 150 }}>
                          {ETAPAS.filter((e) => !['ganho', 'perdido'].includes(e.v)).map((e) => <option key={e.v} value={e.v}>{e.l}</option>)}
                        </select>
                        <button disabled={busy} onClick={() => ganhar(l)} style={btnGanhar}>✓ Ganhar</button>
                        <button onClick={() => perder(l)} style={btnPerder}>✕ Perder</button>
                      </div>
                    )}
                    {l.etapa === 'perdido' && l.motivo_perda && <span style={{ fontSize: 11, color: RED }}>motivo: {l.motivo_perda}</span>}
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {novo && (
        <div style={overlay} onClick={() => setNovo(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>Novo lead</h2>
            <label style={lbl}>Nome do contato *<input style={inp} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
            <label style={lbl}>Empresa<input style={inp} value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} /></label>
            <label style={lbl}>Origem *
              <select style={inp} value={form.origem} onChange={(e) => setForm({ ...form, origem: e.target.value })}>
                {ORIGENS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Canal<input style={inp} value={form.canal_contato} onChange={(e) => setForm({ ...form, canal_contato: e.target.value })} placeholder="whatsapp, ligação…" /></label>
              <label style={lbl}>Valor estimado<input style={inp} type="number" value={form.valor_estimado} onChange={(e) => setForm({ ...form, valor_estimado: e.target.value })} /></label>
            </div>
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
const btnPerder: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
