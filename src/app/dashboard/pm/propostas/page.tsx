'use client'
// PROPOSTAS / ORÇAMENTOS (P&M). Sobre agency_propostas, escopado por company_id (RD-45).
// Criação via fn_agency_proposta_criar (valida acesso + soma itens no servidor).
// Aprovar → status 'aprovada' + gera contrato (fn_agency_proposta_aprovar). Tema Espresso claro.
// Cliente unificado em erp_clientes (base mestre, regra-mãe b9333675): o picker busca erp_clientes e
// envia erp_cliente_id; o backend resolve/cria o agency_cliente (fn_agency_cliente_resolver) e grava os
// dois, coerentes — assim Lead → Proposta → Contrato casam pelo mesmo cliente.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
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
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

const STATUS: Record<string, { l: string; cor: string }> = {
  rascunho: { l: 'Rascunho', cor: '#F0E9DE' },
  enviada: { l: 'Enviada', cor: '#FFF3D6' },
  aprovada: { l: 'Aprovada', cor: '#DCEFD7' },
  recusada: { l: 'Recusada', cor: '#F4D6D6' },
}
const stCfg = (v: string) => STATUS[v] ?? { l: v, cor: OFFWHITE }

type Item = { tipo_servico: string; descricao: string; quantidade: number; unidade: string; valor_unitario: number; valor_total: number; servico_id?: string | null; entregaveis?: string[] }
type ServicoOpt = { id: string; nome: string; tipo: string; area: string | null; valor_base: number | null; unidade: string | null; periodicidade: string | null; horas_estimadas: number | null; entregaveis: string[] | null }
type Proposta = {
  id: string; company_id: string; cliente_id: string | null; briefing_id: string | null; numero: string | null
  titulo: string; descricao: string | null; itens: Item[] | null; valor_total: number | null
  desconto: number | null; valor_final: number | null; condicao_pagamento: string | null; status: string
  data_envio: string | null; data_aprovacao: string | null; contrato_id: string | null; created_at: string
  erp_cliente_id: string | null; observacoes: string | null   // PM-QW #15 · usados na edição (select '*' já traz)
}
type ClienteOpt = { id: string; nome: string; nome_fantasia: string | null; telefone: string | null }

const itemVazio = (): Item => ({ tipo_servico: '', descricao: '', quantidade: 1, unidade: 'un', valor_unitario: 0, valor_total: 0, servico_id: null })

export default function PropostasPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [propostas, setPropostas] = useState<Proposta[]>([])
  const [clientes, setClientes] = useState<ClienteOpt[]>([])
  const [catalogo, setCatalogo] = useState<ServicoOpt[]>([])   // serviços do catálogo p/ irrigar os itens
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)   // PM-QW #15 · id em edição (modal reusada)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const prefill = useRef<{ cliente_id?: string; briefing_id?: string; titulo?: string }>({})

  // formulário da nova proposta (com editor de itens)
  const [fCliente, setFCliente] = useState('')       // erp_cliente_id (base mestre)
  const [fTitulo, setFTitulo] = useState('')
  const [fCondicao, setFCondicao] = useState('Mensal')
  const [fDesconto, setFDesconto] = useState('')
  const [fObs, setFObs] = useState('')
  const [itens, setItens] = useState<Item[]>([itemVazio()])

  // destaque de uma proposta vinda do card do lead (?proposta=<id>)
  const [destaque, setDestaque] = useState<string | null>(null)
  // aprovação → contrato recorrente na GE + comissão
  const [apr, setApr] = useState<Proposta | null>(null)
  const [aprForm, setAprForm] = useState({ fee: '', dia: '10', periodicidade: 'mensal', comPct: '', comBase: 'fee', comTipo: 'unica' })

  const carregar = async () => {
    if (!empresa) { setPropostas([]); setLoading(false); return }
    setLoading(true)
    const [p, c, cat] = await Promise.all([
      supabase.from('agency_propostas').select('*').eq('company_id', empresa).is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('agency_clientes').select('id, nome, nome_fantasia, telefone').eq('company_id', empresa).order('nome'),
      supabase.rpc('fn_agency_servico_listar_proposta', { p_company_id: empresa }),
    ])
    setPropostas((p.data ?? []) as Proposta[])
    setClientes((c.data ?? []) as ClienteOpt[])
    setCatalogo(((cat.data as { servicos?: ServicoOpt[] } | null)?.servicos ?? []) as ServicoOpt[])
    setLoading(false)
  }
  useEffect(() => { void carregar() }, [empresa]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])
  // rola até a proposta destacada (vinda do card do lead) quando a lista carrega
  useEffect(() => {
    if (!destaque || loading) return
    const el = document.getElementById(`prop-${destaque}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [destaque, loading, propostas])

  function abrirNovo(cliId?: string, tit?: string) {
    setEditId(null)
    setFCliente(cliId ?? '')
    setFTitulo(tit ?? '')
    setFCondicao('Mensal'); setFDesconto(''); setFObs('')
    setItens([itemVazio()])
    setNovo(true)
  }

  // PM-QW #15 · abrir a MESMA modal em modo edição (pré-preenchida). A modal é o "detalhe" da proposta.
  function abrirEditar(p: Proposta) {
    setEditId(p.id)
    setFCliente(p.erp_cliente_id ?? p.cliente_id ?? '')
    setFTitulo(p.titulo ?? '')
    setFCondicao(p.condicao_pagamento ?? 'Mensal')
    setFDesconto(p.desconto ? String(p.desconto) : '')
    setFObs(p.observacoes ?? '')
    const its = (Array.isArray(p.itens) ? p.itens : []) as Partial<Item>[]
    setItens(its.length ? its.map((it) => ({ ...itemVazio(), ...it, quantidade: num(it.quantidade), valor_unitario: num(it.valor_unitario), valor_total: num(it.valor_total) })) : [itemVazio()])
    setNovo(true)
  }

  async function salvarEdicao() {
    if (!editId) return
    if (!fTitulo.trim()) { setToast('Informe o título da proposta.'); return }
    setBusy(true)
    const itensLimpos = itens
      .filter((it) => it.tipo_servico.trim() || it.descricao.trim() || num(it.valor_total) > 0)
      .map((it) => ({ ...it, quantidade: num(it.quantidade), valor_unitario: num(it.valor_unitario), valor_total: num(it.valor_total) }))
    const { data, error } = await supabase.rpc('fn_agency_proposta_editar', {
      p_id: editId,
      p_patch: {
        titulo: fTitulo.trim(), itens: itensLimpos, valor_total: somaItens,
        desconto: descNum, condicao_pagamento: fCondicao, observacoes: fObs.trim() || null,
      },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setNovo(false); setEditId(null)
    setToast('Proposta ALTERADA.'); void carregar()
  }

  async function excluir(p: Proposta) {
    if (!window.confirm(`Excluir a proposta "${p.titulo}"? Ela sai da lista (exclusão reversível, nada é apagado de vez).`)) return
    const { data, error } = await supabase.rpc('fn_agency_proposta_excluir', { p_id: p.id })
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Proposta EXCLUÍDA.'); void carregar()
  }

  // pré-preenchimento vindo de Lead/Briefing (?erp_cliente_id / ?briefing_id / ?titulo) — abre já o modal.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const q = new URLSearchParams(window.location.search)
    const prop = q.get('proposta') || undefined
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (prop) { setDestaque(prop); return } // veio do card do lead → destaca a proposta existente/criada
    const cli = q.get('erp_cliente_id') || q.get('cliente_id') || undefined
    const brf = q.get('briefing_id') || undefined
    const tit = q.get('titulo') || undefined
    if (!(cli || brf || tit)) return
    prefill.current = { cliente_id: cli, briefing_id: brf, titulo: tit }
    const t = setTimeout(() => abrirNovo(cli, tit), 0) // fora do ciclo do effect (evita setState síncrono)
    return () => clearTimeout(t)
  }, [])

  const nomeCliente = (id: string | null) => { const c = clientes.find((x) => x.id === id); return c ? (c.nome_fantasia ?? c.nome) : '—' }
  const kpis = useMemo(() => ({
    total: propostas.length,
    pendentes: propostas.filter((p) => ['rascunho', 'enviada'].includes(p.status)).length,
    aprovadas: propostas.filter((p) => p.status === 'aprovada').length,
    valorAprovado: propostas.filter((p) => p.status === 'aprovada').reduce((s, p) => s + num(p.valor_final ?? 0), 0),
  }), [propostas])

  // totais ao vivo
  const somaItens = useMemo(() => itens.reduce((s, it) => s + num(it.valor_total), 0), [itens])
  const descNum = num(fDesconto)
  const valorFinal = Math.max(somaItens - descNum, 0)
  const propEdit = editId ? (propostas.find((x) => x.id === editId) ?? null) : null   // PM-QW #15 · proposta em edição

  function setItem(i: number, patch: Partial<Item>) {
    setItens((arr) => arr.map((it, idx) => {
      if (idx !== i) return it
      const next = { ...it, ...patch }
      next.valor_total = num(next.quantidade) * num(next.valor_unitario)
      return next
    }))
  }
  const addItem = () => setItens((a) => [...a, itemVazio()])
  const rmItem = (i: number) => setItens((a) => (a.length === 1 ? a : a.filter((_, idx) => idx !== i)))

  async function criar() {
    if (!empresa) return
    if (!fTitulo.trim()) { setToast('Informe o título da proposta.'); return }
    setBusy(true)
    const itensLimpos = itens
      .filter((it) => it.tipo_servico.trim() || it.descricao.trim() || num(it.valor_total) > 0)
      .map((it) => ({ ...it, quantidade: num(it.quantidade), valor_unitario: num(it.valor_unitario), valor_total: num(it.valor_total) }))
    const { data, error } = await supabase.rpc('fn_agency_proposta_criar', {
      p_campos: {
        company_id: empresa,
        erp_cliente_id: fCliente || null,   // base mestre; o backend resolve/cria o agency_cliente
        briefing_id: prefill.current.briefing_id || null,
        titulo: fTitulo.trim(),
        itens: itensLimpos,
        valor_total: somaItens,
        desconto: descNum,
        condicao_pagamento: fCondicao,
        observacoes: fObs.trim() || null,
      },
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    prefill.current = {}
    setNovo(false)
    setToast('Proposta CRIADA.'); void carregar()
  }

  async function mudarStatus(p: Proposta, status: string) {
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (status === 'enviada') patch.data_envio = new Date().toISOString()
    await supabase.from('agency_propostas').update(patch).eq('id', p.id)
    setToast(`Proposta ALTERADA para ${stCfg(status).l}.`); void carregar()
  }

  function compartilhar(p: Proposta) {
    const c = clientes.find((x) => x.id === p.cliente_id)
    const tel = (c?.telefone ?? '').replace(/\D/g, '')
    const txt = encodeURIComponent(`*${p.titulo}*\nProposta ${nomeCliente(p.cliente_id)}\nValor: ${brl(num(p.valor_final ?? p.valor_total))}\nCondição: ${p.condicao_pagamento ?? '—'}`)
    const url = tel ? `https://wa.me/55${tel}?text=${txt}` : `https://wa.me/?text=${txt}`
    window.open(url, '_blank', 'noopener')
  }

  function abrirAprovar(p: Proposta) {
    setAprForm({ fee: String(p.valor_final ?? p.valor_total ?? ''), dia: '10', periodicidade: 'mensal', comPct: '', comBase: 'fee', comTipo: 'unica' })
    setApr(p)
  }

  async function confirmarAprovar() {
    if (!apr) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_agency_proposta_aprovar', {
      p_proposta_id: apr.id,
      p_fee_mensal: aprForm.fee ? Number(aprForm.fee) : null,
      p_dia_vencimento: Number(aprForm.dia) || 10,
      p_periodicidade: aprForm.periodicidade,
      p_data_inicio: new Date().toISOString().slice(0, 10),
      p_comissao_percentual: aprForm.comPct ? Number(aprForm.comPct) : 0,
      p_comissao_tipo: aprForm.comTipo,
      p_comissao_base: aprForm.comBase,
    })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string; contrato_numero?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setApr(null)
    setToast(j.contrato_numero ? `APROVADA · contrato ${j.contrato_numero} criado na GE` : 'Proposta APROVADA.')
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
            <p style={{ fontSize: 13, color: TEXTM, margin: '4px 0 0' }}>Itens → totais ao vivo → envio → aprovação vira contrato. Escopo por empresa.</p>
          </div>
          <button onClick={() => abrirNovo()} style={btnPri}>+ Nova proposta</button>
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
                const nItens = Array.isArray(p.itens) ? p.itens.length : 0
                return (
                  <div key={p.id} id={`prop-${p.id}`} style={{ background: p.id === destaque ? '#FBF3DE' : '#fff', border: `${p.id === destaque ? 2 : 1}px solid ${p.id === destaque ? DOURADO : BORDA}`, borderRadius: 12, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <div style={{ fontWeight: 700 }}>{p.titulo}{p.numero ? <span style={{ color: TEXTM, fontWeight: 400 }}> · {p.numero}</span> : null}</div>
                      <div style={{ fontSize: 12, color: TEXTM, marginTop: 2 }}>
                        {nomeCliente(p.cliente_id)} · {brl(num(p.valor_final ?? p.valor_total ?? 0))} · {p.condicao_pagamento ?? '—'}
                        {nItens > 0 ? ` · ${nItens} ${nItens === 1 ? 'item' : 'itens'}` : ''}
                        {num(p.desconto) > 0 ? ` · desc. ${brl(num(p.desconto))}` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: cfg.cor, padding: '3px 10px', borderRadius: 999 }}>{cfg.l}</span>
                    {/* PM-QW #15 · pedido do Luzardo: card só com Editar + Excluir. As demais ações
                        (Enviar/WhatsApp/Aprovar/Recusar) ficam no detalhe = a modal de edição. */}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => abrirEditar(p)} style={btnSec}>✏️ Editar</button>
                      <button onClick={() => void excluir(p)} style={{ ...btnSec, borderColor: RED, color: RED }}>🗑️ Excluir</button>
                      {p.status === 'aprovada' && p.contrato_id && (
                        <a href="/dashboard/pm/contratos" style={{ ...btnGanhar, textDecoration: 'none' }}>→ Ver contrato</a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </div>

      {novo && (
        <div style={overlay} onClick={() => setNovo(false)}>
          <div style={{ ...modal, maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 12px' }}>{editId ? 'Editar proposta' : 'Nova proposta'}</h2>

            {/* PM-QW #15 · "detalhe": ações de status ficam aqui (fora do card). Só na edição. */}
            {propEdit && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', background: '#FBF6EA', border: `1px solid ${BORDA}`, borderRadius: 10, padding: '8px 10px', marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: ESPRESSO, background: stCfg(propEdit.status).cor, padding: '3px 10px', borderRadius: 999 }}>{stCfg(propEdit.status).l}</span>
                {propEdit.status === 'rascunho' && <button onClick={() => { void mudarStatus(propEdit, 'enviada'); setNovo(false) }} style={btnSec}>📨 Enviar</button>}
                {['rascunho', 'enviada'].includes(propEdit.status) && <button onClick={() => compartilhar(propEdit)} style={btnSec}>🟢 WhatsApp</button>}
                {['rascunho', 'enviada'].includes(propEdit.status) && <button disabled={busy} onClick={() => { setNovo(false); abrirAprovar(propEdit) }} style={btnGanhar}>✓ Aprovar</button>}
                {['rascunho', 'enviada'].includes(propEdit.status) && <button onClick={() => { void mudarStatus(propEdit, 'recusada'); setNovo(false) }} style={btnPerder}>✕ Recusar</button>}
                {propEdit.status === 'aprovada' && propEdit.contrato_id && <a href="/dashboard/pm/contratos" style={{ ...btnGanhar, textDecoration: 'none' }}>→ Ver contrato</a>}
              </div>
            )}

            <ClienteField value={fCliente} onChange={(id) => setFCliente(id)} empresa={empresa} setToast={setToast} />

            <label style={lbl}>Título *<input style={inp} value={fTitulo} onChange={(e) => setFTitulo(e.target.value)} placeholder="Ex.: Gestão de redes + tráfego" /></label>

            <div style={{ fontSize: 11, fontWeight: 700, color: DOURADO, textTransform: 'uppercase', letterSpacing: 0.5, margin: '14px 0 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Itens do orçamento</span>
              <button onClick={addItem} style={btnSec}>+ Item</button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {itens.map((it, i) => (
                <div key={i} style={{ border: `1px solid ${BORDA}`, borderRadius: 10, padding: 10, background: '#FDFBF7' }}>
                  {catalogo.length > 0 && (
                    <select
                      style={{ ...inp, marginBottom: 8 }}
                      value={it.servico_id ?? ''}
                      onChange={(e) => {
                        const s = catalogo.find((x) => x.id === e.target.value)
                        if (!s) { setItem(i, { servico_id: null }); return }
                        setItem(i, { servico_id: s.id, tipo_servico: s.nome, descricao: it.descricao || (s.area ?? ''), unidade: s.unidade ?? it.unidade, valor_unitario: s.valor_base ?? 0, entregaveis: s.entregaveis ?? [] })
                      }}
                    >
                      <option value="">Do catálogo… (ou digite abaixo)</option>
                      {catalogo.map((s) => <option key={s.id} value={s.id}>{s.nome}{s.valor_base != null ? ` — ${brl(s.valor_base)}${s.unidade ? '/' + s.unidade : ''}` : ''}</option>)}
                    </select>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input style={inp} value={it.tipo_servico} onChange={(e) => setItem(i, { tipo_servico: e.target.value, servico_id: null })} placeholder="Tipo (ex.: Social)" />
                    <input style={inp} value={it.descricao} onChange={(e) => setItem(i, { descricao: e.target.value })} placeholder="Descrição" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '0.7fr 0.7fr 1fr 1fr auto', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <input style={inp} type="number" min={0} value={it.quantidade} onChange={(e) => setItem(i, { quantidade: num(e.target.value) })} placeholder="Qtd" />
                    <input style={inp} value={it.unidade} onChange={(e) => setItem(i, { unidade: e.target.value })} placeholder="un" />
                    <input style={inp} type="number" min={0} step="0.01" value={it.valor_unitario} onChange={(e) => setItem(i, { valor_unitario: num(e.target.value) })} placeholder="Valor unit." />
                    <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', color: ESPRESSO }}>{brl(it.valor_total)}</div>
                    <button onClick={() => rmItem(i)} disabled={itens.length === 1} title="Remover" style={{ ...btnSec, borderColor: RED, color: RED, opacity: itens.length === 1 ? 0.4 : 1 }}>✕</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <label style={lbl}>Desconto (R$)<input style={inp} type="number" min={0} step="0.01" value={fDesconto} onChange={(e) => setFDesconto(e.target.value)} placeholder="0" /></label>
              <label style={lbl}>Condição
                <select style={inp} value={fCondicao} onChange={(e) => setFCondicao(e.target.value)}>
                  <option>Mensal</option><option>Projeto (à vista)</option><option>Projeto (parcelado)</option>
                </select>
              </label>
            </div>

            <div style={{ background: '#FBF6EA', border: `1px solid ${BORDA}`, borderRadius: 10, padding: '10px 12px', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Row l="Subtotal (itens)" v={brl(somaItens)} />
              <Row l="Desconto" v={`− ${brl(descNum)}`} />
              <div style={{ height: 1, background: BORDA, margin: '2px 0' }} />
              <Row l="Valor final" v={brl(valorFinal)} big />
            </div>

            <label style={lbl}>Observações<textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} value={fObs} onChange={(e) => setFObs(e.target.value)} /></label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button onClick={() => { setNovo(false); setEditId(null) }} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={editId ? salvarEdicao : criar} style={btnPri}>{busy ? 'Salvando…' : (editId ? 'SALVAR' : 'CRIAR')}</button>
            </div>
          </div>
        </div>
      )}

      {apr && (
        <div style={overlay} onClick={() => setApr(null)}>
          <div style={modal} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 4px' }}>Aprovar proposta</h2>
            <p style={{ fontSize: 12.5, color: TEXTM, margin: '0 0 12px' }}>{apr.titulo} · {nomeCliente(apr.cliente_id)}</p>
            <div style={{ background: '#FBF6EA', border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 12, color: ESPRESSO, marginBottom: 10 }}>
              Ao aprovar: nasce um <strong>contrato recorrente na GE</strong> (o faturamento passa a ser automático) e a <strong>comissão do comercial</strong>.
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: DOURADO, textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0' }}>Contrato (fee recorrente)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <label style={lbl}>Fee mensal (R$)<input style={inp} type="number" value={aprForm.fee} onChange={(e) => setAprForm({ ...aprForm, fee: e.target.value })} placeholder="0 = sem contrato" /></label>
              <label style={lbl}>Dia venc.<input style={inp} type="number" min={1} max={28} value={aprForm.dia} onChange={(e) => setAprForm({ ...aprForm, dia: e.target.value })} /></label>
              <label style={lbl}>Periodicidade
                <select style={inp} value={aprForm.periodicidade} onChange={(e) => setAprForm({ ...aprForm, periodicidade: e.target.value })}>
                  <option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option>
                </select>
              </label>
            </div>
            <div style={{ fontSize: 10.5, color: TEXTM, marginTop: 2 }}>Fee 0 → aprova sem contrato recorrente (ex.: projeto avulso). A comissão ainda é gerada.</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: DOURADO, textTransform: 'uppercase', letterSpacing: 0.5, margin: '12px 0 4px' }}>Comissão do comercial</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <label style={lbl}>Percentual (%)<input style={inp} type="number" value={aprForm.comPct} onChange={(e) => setAprForm({ ...aprForm, comPct: e.target.value })} placeholder="0" /></label>
              <label style={lbl}>Base
                <select style={inp} value={aprForm.comBase} onChange={(e) => setAprForm({ ...aprForm, comBase: e.target.value })}>
                  <option value="fee">Fee mensal</option><option value="contrato">Valor da proposta</option>
                </select>
              </label>
              <label style={lbl}>Tipo
                <select style={inp} value={aprForm.comTipo} onChange={(e) => setAprForm({ ...aprForm, comTipo: e.target.value })}>
                  <option value="unica">Única</option><option value="recorrente">Recorrente</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setApr(null)} style={btnGhost}>Cancelar</button>
              <button disabled={busy} onClick={confirmarAprovar} style={btnPri}>{busy ? 'Aprovando…' : 'Aprovar e gerar contrato'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </div>
  )
}

// Autocomplete sobre erp_clientes (base mestre, via fn_cliente_buscar) + cadastro rápido inline
// (fn_cliente_criar_inline). Igual ao picker dos Leads (regra-mãe b9333675). value = erp_cliente_id.
function ClienteField({ value, onChange, empresa, setToast }: {
  value: string; onChange: (erpId: string) => void; empresa: string; setToast: (s: string) => void
}) {
  const [q, setQ] = useState('')
  const [nomeSel, setNomeSel] = useState('')
  const [sug, setSug] = useState<{ id: string; nome: string; doc: string | null }[]>([])
  const [buscando, setBuscando] = useState(false)
  const [open, setOpen] = useState(false)
  const [criando, setCriando] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // nome do cliente pré-selecionado (prefill) — busca deferida (evita setState síncrono no effect)
  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      if (!value) { setNomeSel(''); return }
      const { data } = await supabase.from('erp_clientes').select('nome_fantasia, razao_social').eq('id', value).maybeSingle()
      if (!alive) return
      const d = (data ?? {}) as { nome_fantasia?: string | null; razao_social?: string | null }
      setNomeSel(d.nome_fantasia ?? d.razao_social ?? '')
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [value])

  function buscar(t: string) {
    setQ(t); setOpen(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const term = t.trim()
      if (term.length < 2) { setSug([]); return }
      setBuscando(true)
      try {
        const { data } = await supabase.rpc('fn_cliente_buscar', { p_company_id: empresa, p_termo: term, p_limit: 8 })
        const res = ((data as { resultados?: { cliente_id: string; nome: string; cnpj_cpf: string | null }[] } | null)?.resultados) ?? []
        setSug(res.map((r) => ({ id: r.cliente_id, nome: r.nome, doc: r.cnpj_cpf })))
      } finally { setBuscando(false) }
    }, 250)
  }
  function escolher(c: { id: string; nome: string }) { onChange(c.id); setNomeSel(c.nome); setOpen(false); setSug([]); setQ('') }
  async function criarInline() {
    const nome = (novoNome || q).trim()
    if (!nome) { setToast('Digite o nome/empresa do cliente.'); return }
    const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: empresa, p_nome: nome, p_cpf_cnpj: null, p_extra: {} })
    if (error) { setToast(`Erro ao criar cliente: ${error.message}`); return }
    const id = data as string | null
    if (id) { onChange(id); setNomeSel(nome) }
    setCriando(false); setNovoNome(''); setOpen(false); setSug([])
    setToast('Cliente CRIADO na GE e vinculado.')
  }

  return (
    <div style={{ position: 'relative' }}>
      <label style={lbl}>Cliente (cadastro GE)
        {value ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ ...inp, flex: 1, display: 'flex', alignItems: 'center' }}>{nomeSel || 'Cliente selecionado'}</div>
            <button onClick={() => { onChange(''); setNomeSel(''); setQ('') }} style={btnSec}>Trocar</button>
          </div>
        ) : (
          <input style={inp} value={q} onChange={(e) => buscar(e.target.value)}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Buscar cliente da GE…" />
        )}
      </label>
      {!value && open && (q.trim().length >= 2 || criando) && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: `1px solid ${BORDA}`, borderRadius: 8, marginTop: 2, boxShadow: '0 6px 20px rgba(0,0,0,.10)', maxHeight: 240, overflowY: 'auto' }}>
          {buscando && <div style={{ padding: '8px 10px', fontSize: 12, color: TEXTM }}>Buscando…</div>}
          {sug.map((c) => (
            <div key={c.id} onMouseDown={(e) => { e.preventDefault(); escolher(c) }}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: `1px solid ${BORDA}` }}>
              {c.nome}{c.doc ? <span style={{ color: TEXTM, fontSize: 11, marginLeft: 6 }}>· {c.doc}</span> : null}
            </div>
          ))}
          {!criando ? (
            <div onMouseDown={(e) => { e.preventDefault(); setCriando(true); setNovoNome(q) }}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, color: DOURADO, fontWeight: 700 }}>
              + Cadastrar cliente{q.trim() ? ` "${q.trim()}"` : ''} na GE
            </div>
          ) : (
            <div style={{ padding: 10, display: 'flex', gap: 6 }} onMouseDown={(e) => e.preventDefault()}>
              <input style={{ ...inp, flex: 1 }} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do cliente" autoFocus />
              <button onMouseDown={(e) => { e.preventDefault(); void criarInline() }} style={btnPri}>Criar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ l, v, big }: { l: string; v: string; big?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: big ? 15 : 12.5, color: big ? ESPRESSO : TEXTM, fontWeight: big ? 700 : 400 }}>
      <span>{l}</span><span>{v}</span>
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

const inp: CSSProperties = { border: `1px solid ${BORDA}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, minHeight: 40, background: '#fff', color: ESPRESSO, width: '100%' }
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: TEXTM, marginTop: 8 }
const btnPri: CSSProperties = { border: 'none', background: DOURADO, color: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 700, minHeight: 42 }
const btnGhost: CSSProperties = { border: `1px solid ${BORDA}`, background: '#fff', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', minHeight: 42 }
const btnSec: CSSProperties = { border: `1px solid ${BORDA}`, color: ESPRESSO, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const btnGanhar: CSSProperties = { border: `1px solid ${GREEN}`, color: GREEN, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 600, minHeight: 40 }
const btnPerder: CSSProperties = { border: `1px solid ${RED}`, color: RED, background: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', minHeight: 40 }
const overlay: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, zIndex: 50, overflow: 'auto' }
const modal: CSSProperties = { background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 480, marginTop: 40 }
const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESPRESSO, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
