'use client'
// PROPOSTAS / ORÇAMENTOS (P&M). Sobre agency_propostas, escopado por company_id (RD-45).
// Aprovar → status 'aprovada' + gera agency_contratos (lado P&M; post financeiro na GE é etapa
// separada com régua RD-53). Tema Espresso claro. Reusa o padrão do Leads.
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

const STATUS: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: '#F0E9DE' },
  enviada: { l: 'Enviada', cor: '#FFF3D6' },
  aprovada: { l: 'Aprovada', cor: '#DCEFD7' },
  recusada: { l: 'Recusada', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }

type Proposta = {
  id: string; company_id: string; cliente_id: string | null; numero: string | null
  titulo: string; descricao: string | null; itens: unknown; valor_total: number | null
  valor_final: number | null; condicao_pagamento: string | null; status: string
  data_envio: string | null; data_aprovacao: string | null; created_at: string
}
type ClienteOpt = { id: string; nome: string; nome_fantasia: string | null }

export default function PropostasPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [propostas, setPropostas] = useState<Proposta[]>([])
  const [clientes, setClientes] = useState<ClienteOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState({ cliente_id: '', titulo: '', valor: '', condicao: 'Mensal' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = async () => {
    if (!empresa) { setPropostas([]); setLoading(false); return }
    setLoading(true)
    const [p, c] = await Promise.all([
      supabase.from('agency_propostas').select('*').eq('company_id', empresa).order('created_at', { ascending: false }),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', empresa).order('nome'),
    ])
    setPropostas((p.data ?? []) as Proposta[])
    setClientes((c.data ?? []) as ClienteOpt[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const nomeCliente = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const kpis = useMemo(() => ({
    total: propostas.length,
    pendentes: propostas.filter((p) => ['rascunho', 'enviada'].includes(p.status)).length,
    aprovadas: propostas.filter((p) => p.status === 'aprovada').length,
    valorAprovado: propostas.filter((p) => p.status === 'aprovada').reduce((s, p) => s + Number(p.valor_final ?? 0), 0),
  }), [propostas])

  async function criar() {
    if (!empresa) return
    if (!form.titulo.trim()) { setToast('Informe o título da proposta.'); return }
    setBusy(true)
    const valor = form.valor ? Number(form.valor) : 0
    const { error } = await supabase.from('agency_propostas').insert({
      company_id: empresa, cliente_id: form.cliente_id || null, titulo: form.titulo.trim(),
      valor_total: valor, valor_final: valor, condicao_pagamento: form.condicao, status: 'rascunho',
    })
    setBusy(false)
    if (error) { setToast(`Erro: ${error.message}`); return }
    setNovo(false); setForm({ cliente_id: '', titulo: '', valor: '', condicao: 'Mensal' })
    setToast('Proposta CRIADA.'); void carregar()
  }

  async function mudarStatus(p: Proposta, status: string) {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === 'enviada') patch.data_envio = new Date().toISOString().slice(0, 10)
    await supabase.from('agency_propostas').update(patch).eq('id', p.id)
    setToast(`Proposta ALTERADA para ${stCfg(status).l}.`); void carregar()
  }

  async function aprovar(p: Proposta) {
    if (!empresa) return
    if (!confirm(`Aprovar "${p.titulo}"?\nIsto marca a proposta como APROVADA e GERA um contrato recorrente na agência.`)) return
    setBusy(true)
    await supabase.from('agency_propostas').update({ status: 'aprovada', data_aprovacao: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }).eq('id', p.id)
    // gera contrato P&M (lado agência; post financeiro na GE = etapa separada com régua RD-53)
    const { error } = await supabase.from('agency_contratos').insert({
      company_id: empresa, cliente_id: p.cliente_id, proposta_id: p.id, tipo: 'recorrente',
      fee_mensal: p.valor_final, dia_vencimento: 10, data_inicio: new Date().toISOString().slice(0, 10), status: 'ativo',
    })
    setBusy(false)
    setToast(error ? `Aprovada (contrato: ${error.message})` : 'Proposta APROVADA · contrato CRIADO.')
    void carregar()
  }

  if (!empresa) return <div style={{ padding: 32, color: TEXTM, background: OFFWHITE, minHeight: '100vh' }}>Selecione uma empresa no topo.</div>

  return (
    <div style={{ background: OFFWHITE, minHeight: '100vh', padding: '24px 18px', color: ESPRESSO }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: DOURADO, fontWeight: 700 }}>🎯 P&amp;M · Comercial</div>
            <h1 style={{ fontSize: 26, fontWeight: 700, margin: '2px 0 0' }}>Propostas · Orçamentos</h1>
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Proposta comercial → aprovação → contrato. Escopo por empresa.</p>
          </div>
          <button onClick={() => setNovo(true)} style={btnPri}>+ Nova proposta</button>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
          <Kpi l="Propostas" v={String(kpis.total)} />
          <Kpi l="Pendentes" v={String(kpis.pendentes)} />
          <Kpi l="Aprovadas" v={String(kpis.aprovadas)} />
          <Kpi l="Valor aprovado" v={brl(kpis.valorAprovado)} />
        </div>

        {loading ? <div style={{ padding: 40, textAlign: 'center', color: TEXTM }}>Carregando…</div>
          : propostas.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: TEXTM, background: '#fff', border: `1px dashed ${BORDA}`, borderRadius: 12 }}>
              Crie a primeira proposta a partir de um lead.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {propostas.map((p) => {
                const cfg = stCfg(p.status)
                return (
                  <div key={p.id} style={{ background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700 }}>{p.titulo}{p.numero ? <span style={{ color: TEXTM, fontWeight: 400 }}> · {p.numero}</span> : null}</div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>{nomeCliente(p.cliente_id)} · {brl(Number(p.valor_final ?? p.valor_total ?? 0))} · {p.condicao_pagamento ?? '—'}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: cfg.cor, padding: '3px 10px', borderRadius: 999 }}>{cfg.l}</span>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {p.status === 'rascunho' && <button onClick={() => mudarStatus(p, 'enviada')} style={btnSec}>📨 Enviar</button>}
                      {['rascunho', 'enviada'].includes(p.status) && <button disabled={busy} onClick={() => aprovar(p)} style={btnGanhar}>✓ Aprovar</button>}
                      {['rascunho', 'enviada'].includes(p.status) && <button onClick={() => mudarStatus(p, 'recusada')} style={btnPerder}>✕ Recusar</button>}
                      {p.status === 'aprovada' && <span style={{ fontSize: 11, color: GREEN, fontWeight: 700 }}>→ contrato gerado</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {novo && (
        <div style={overlay} onClick={() => setNovo(false)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>Nova proposta</h2>
            <label style={lbl}>Cliente
              <select style={inp} value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}>
                <option value="">—</option>
                {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia ?? c.nome}</option>)}
              </select>
            </label>
            <label style={lbl}>Título *<input style={inp} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Gestão de redes + tráfego" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label style={lbl}>Valor<input style={inp} type="number" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} /></label>
              <label style={lbl}>Condição
                <select style={inp} value={form.condicao} onChange={(e) => setForm({ ...form, condicao: e.target.value })}>
                  <option>Mensal</option><option>Projeto (à vista)</option><option>Projeto (parcelado)</option>
                </select>
              </label>
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
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const btnGanhar: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 40 }
const btnPerder: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
