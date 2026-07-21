'use client'
// OFICINA · DIAGNÓSTICO TÉCNICO (laudo do mecânico). Mobile-first (o mecânico usa celular).
// Escolhe a OS do pátio → registra causa provável + itens (serviços do tempário + peças) + severidade.
// 🚫 SEM preço, SEM financeiro, SEM mudar status — só o laudo técnico (RD: financeiro é da GE).
import React, { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Stethoscope, ChevronLeft, Plus, Trash2, Search, Wrench, Package, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PlacaInline } from '../_components/PlacaInline'
import SolicitarPecaModal from '@/components/oficina/SolicitarPecaModal'

const ESP = '#3D2314'; const BG = '#FAF7F2'; const GOLD = '#C8941A'; const LINE = '#E7DECF'; const ESP60 = 'rgba(61,35,20,0.55)'
const OK = '#166534'; const RED = '#A32D2D'; const AMBER = '#B45309'
const SEVERIDADES = [
  { v: 'critico', l: 'Crítico', c: RED },
  { v: 'recomendado', l: 'Recomendado', c: AMBER },
  { v: 'futuro', l: 'Futuro', c: ESP60 },
]

type ItemLaudo = {
  tipo: 'servico' | 'peca'; servico_id?: string | null; produto_id?: string | null; descricao: string
  quantidade?: string; tempo_estimado_h?: string; severidade: string; observacao?: string
  _estoque?: number | null; _codigo?: string | null    // só p/ exibição (peça do catálogo)
}
type OSLinha = { id: string; numero: string; cliente_nome: string | null; placa: string | null; marca: string | null; modelo: string | null; status: string; defeito_relatado: string | null; tem_laudo?: boolean }
type Tempario = { id: string; codigo: string | null; nome: string; tempo_padrao_h: number | null }
type Peca = { id: string; codigo: string | null; nome: string; marca: string | null; unidade: string | null; preco_venda: number | null; estoque_atual: number | null; status_estoque: string | null }

function useCompanyId(): string | null {
  const [id, setId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => {
      if (typeof window === 'undefined') return null
      const v = localStorage.getItem('ps_empresa_sel')
      if (!v || v === 'consolidado' || v.startsWith('group_')) return null
      return v
    }
    setId(read())
    const t = setInterval(() => { const v = read(); setId((p) => (p === v ? p : v)) }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

export default function DiagnosticoPage() {
  const companyId = useCompanyId()
  const router = useRouter()
  const [lista, setLista] = useState<OSLinha[]>([])
  const [osSel, setOsSel] = useState<OSLinha | null>(null)
  const [diagnostico, setDiagnostico] = useState('')
  const [km, setKm] = useState('')
  const [itens, setItens] = useState<ItemLaudo[]>([])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // busca no tempário
  const [buscaServ, setBuscaServ] = useState('')
  const [sugestoes, setSugestoes] = useState<Tempario[]>([])
  // busca de peça no catálogo/estoque
  const [buscaPeca, setBuscaPeca] = useState('')
  const [sugestoesPeca, setSugestoesPeca] = useState<Peca[]>([])
  const [solicitarAberto, setSolicitarAberto] = useState(false)  // R5 · modal solicitar peça ao dono

  const carregarLista = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_oficina_os_fila', { p_company_id: companyId, p_etapa: 'diagnostico' })
    setLista((data as OSLinha[]) ?? [])
  }, [companyId])
  const setPlacaLocal = (osId: string, placa: string) => setLista((p) => p.map((o) => (o.id === osId ? { ...o, placa } : o)))

  useEffect(() => { void carregarLista() }, [carregarLista])

  const abrirOS = async (os: OSLinha) => {
    if (!companyId) return
    setOsSel(os)
    const { data } = await supabase.rpc('fn_oficina_diagnostico_obter', { p_company_id: companyId, p_os_id: os.id })
    const d = data as { os?: { diagnostico?: string; km?: number }; itens?: ItemLaudo[] } | null
    setDiagnostico(d?.os?.diagnostico ?? '')
    setKm(d?.os?.km ? String(d.os.km) : '')
    setItens((d?.itens ?? []).map((i) => ({
      tipo: i.tipo === 'peca' ? 'peca' : 'servico', servico_id: i.servico_id ?? null, produto_id: i.produto_id ?? null,
      descricao: i.descricao ?? '', quantidade: i.quantidade != null ? String(i.quantidade) : '1',
      tempo_estimado_h: i.tempo_estimado_h != null ? String(i.tempo_estimado_h) : '',
      severidade: i.severidade ?? 'recomendado', observacao: i.observacao ?? '',
    })))
  }

  // busca no tempário (debounce simples)
  useEffect(() => {
    if (!companyId || buscaServ.trim().length < 2) { setSugestoes([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('erp_oficina_servicos')
        .select('id, codigo, nome, tempo_padrao_h')
        .eq('company_id', companyId).eq('ativo', true).eq('excluida', false)
        .ilike('nome', `%${buscaServ.trim()}%`).order('nome').limit(8)
      setSugestoes((data as Tempario[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [buscaServ, companyId])

  const addServicoTempario = (s: Tempario) => {
    setItens((p) => [...p, { tipo: 'servico', servico_id: s.id, descricao: s.nome, quantidade: '1', tempo_estimado_h: s.tempo_padrao_h != null ? String(s.tempo_padrao_h) : '', severidade: 'recomendado' }])
    setBuscaServ(''); setSugestoes([])
  }

  // busca de peça no catálogo/estoque (debounce)
  useEffect(() => {
    if (!companyId || buscaPeca.trim().length < 2) { setSugestoesPeca([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('fn_oficina_pecas_buscar', { p_company_id: companyId, p_termo: buscaPeca.trim() })
      setSugestoesPeca((data as Peca[]) ?? [])
    }, 300)
    return () => clearTimeout(t)
  }, [buscaPeca, companyId])

  const addPecaCatalogo = (p: Peca) => {
    setItens((prev) => [...prev, { tipo: 'peca', produto_id: p.id, descricao: p.nome, quantidade: '1', severidade: 'recomendado', _estoque: p.estoque_atual, _codigo: p.codigo }])
    setBuscaPeca(''); setSugestoesPeca([])
  }
  const addLinha = (tipo: 'servico' | 'peca') => setItens((p) => [...p, { tipo, descricao: '', quantidade: '1', tempo_estimado_h: '', severidade: 'recomendado' }])
  const setItem = (i: number, patch: Partial<ItemLaudo>) => setItens((p) => p.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))
  const delItem = (i: number) => setItens((p) => p.filter((_, idx) => idx !== i))

  const salvar = async () => {
    if (!companyId || !osSel) return
    setSalvando(true)
    const { data, error } = await supabase.rpc('fn_oficina_diagnostico_salvar', {
      p_company_id: companyId, p_os_id: osSel.id,
      p_dados: { diagnostico, km, itens: itens.filter((i) => i.descricao.trim().length > 0).map((i) => ({
        tipo: i.tipo, servico_id: i.servico_id ?? null, produto_id: i.produto_id ?? null,
        descricao: i.descricao, quantidade: i.quantidade, tempo_estimado_h: i.tempo_estimado_h,
        severidade: i.severidade, observacao: i.observacao ?? null,
      })) },
    })
    setSalvando(false)
    const j = data as { ok?: boolean; erro?: string; itens?: number } | null
    if (error || j?.ok === false) { setMsg('❌ ' + (error?.message || j?.erro)); return }
    setMsg(`✅ Laudo salvo — ${j?.itens ?? 0} item(ns). Próximo: aprovação do cliente.`)
    await carregarLista()
    setTimeout(() => setOsSel(null), 1400)
  }

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 4000); return () => clearTimeout(t) }, [msg])

  if (!companyId) return <div style={{ padding: 24, color: ESP60, background: BG, minHeight: '100vh' }}>Selecione uma empresa específica no topo para abrir o Diagnóstico.</div>

  // LISTA de OS (escolher qual diagnosticar)
  if (!osSel) return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 40px' }}>
        <button onClick={() => router.push('/dashboard/oficina/patio')} style={linkBtn}><ChevronLeft size={16} /> Pátio</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Diagnóstico</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '2px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Stethoscope size={22} /> Qual veículo diagnosticar?</h1>
        {lista.length === 0 && <div style={{ color: ESP60, fontSize: 14, padding: '20px 0' }}>Nenhum veículo ativo no pátio. Faça a recepção primeiro.</div>}
        {lista.map((os) => (
          <div key={os.id} onClick={() => void abrirOS(os)} style={{ width: '100%', textAlign: 'left', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 12, padding: 14, marginBottom: 10, cursor: 'pointer' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <PlacaInline companyId={companyId} osId={os.id} placa={os.placa} onSaved={(p) => setPlacaLocal(os.id, p)} />
              <span style={{ fontSize: 11, color: ESP60 }}>{os.numero}</span>
            </div>
            <div style={{ fontSize: 13, color: ESP, marginTop: 3 }}>{[os.marca, os.modelo].filter(Boolean).join(' ') || 'Veículo'}{os.cliente_nome ? ` · ${os.cliente_nome}` : ''}</div>
            {os.defeito_relatado && <div style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>“{os.defeito_relatado}”</div>}
            {os.tem_laudo && <div style={{ fontSize: 11, fontWeight: 700, color: OK, marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check size={13} /> já tem laudo — toque p/ editar</div>}
          </div>
        ))}
      </div>
      {msg && <Toast>{msg}</Toast>}
    </div>
  )

  // FORMULÁRIO do laudo
  return (
    <div style={{ background: BG, minHeight: '100vh', color: ESP }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '16px 14px 96px' }}>
        <button onClick={() => setOsSel(null)} style={linkBtn}><ChevronLeft size={16} /> Trocar veículo</button>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: GOLD, fontWeight: 700, marginTop: 6 }}>🔧 Oficina · Diagnóstico · {osSel.numero}</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '2px 0 4px' }}>{osSel.placa} · {osSel.marca} {osSel.modelo}</h1>
        {osSel.defeito_relatado && <div style={{ fontSize: 13, color: ESP60, marginBottom: 12 }}>Queixa do cliente: “{osSel.defeito_relatado}”</div>}

        <Sec titulo="Causa provável (o que o carro tem)">
          <textarea value={diagnostico} onChange={(e) => setDiagnostico(e.target.value)} rows={3} placeholder="Ex.: barulho ao frear — pastilha dianteira gasta e disco com sulco." style={{ ...inp, resize: 'vertical' }} />
          <Campo l="KM confirmado"><input value={km} onChange={(e) => setKm(e.target.value.replace(/\D/g, ''))} inputMode="numeric" style={inp} /></Campo>
        </Sec>

        <Sec titulo="Serviços & peças necessárias">
          {/* busca no tempário */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', background: '#fff' }}>
              <Search size={16} color={ESP60} />
              <input value={buscaServ} onChange={(e) => setBuscaServ(e.target.value)} placeholder="Buscar serviço no tempário…" style={{ ...inp, border: 'none', padding: '10px 0' }} />
            </div>
            {sugestoes.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.08)' }}>
                {sugestoes.map((s) => (
                  <button key={s.id} onClick={() => addServicoTempario(s)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 14 }}>{s.nome}</span>
                    {s.tempo_padrao_h != null && <span style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>{s.tempo_padrao_h}h</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* busca de peça no catálogo/estoque */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: `1px solid ${LINE}`, borderRadius: 10, padding: '0 10px', background: '#fff' }}>
              <Package size={16} color={ESP60} />
              <input value={buscaPeca} onChange={(e) => setBuscaPeca(e.target.value)} placeholder="Buscar peça no estoque (código/nome)…" style={{ ...inp, border: 'none', padding: '10px 0' }} />
            </div>
            {sugestoesPeca.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, marginTop: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.08)', maxHeight: 260, overflowY: 'auto' }}>
                {sugestoesPeca.map((p) => (
                  <button key={p.id} onClick={() => addPecaCatalogo(p)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', background: 'none', border: 'none', borderBottom: `1px solid ${LINE}`, cursor: 'pointer' }}>
                    {/* 🚫 SEM preço na tela do mecânico (R4) — R$ fica só na Aprovação/Orçamento. Aqui: nome + estoque. */}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>{p.nome}</span>
                    </div>
                    <div style={{ fontSize: 11, color: ESP60, marginTop: 2 }}>
                      {p.codigo ? `${p.codigo} · ` : ''}estoque {p.estoque_atual != null ? Number(p.estoque_atual) : '—'} {p.unidade ?? ''}
                      {p.status_estoque && p.status_estoque !== 'ok' ? ` · ${p.status_estoque}` : ''}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* R5 · mecânico solicita peça ao dono (foto + qtd, sem preço) → alerta pro dono decidir */}
          <button onClick={() => setSolicitarAberto(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: `1px dashed ${GOLD}`, background: 'rgba(200,148,26,0.06)', color: ESP, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
            <Package size={16} color={GOLD} /> Solicitar peça ao dono
          </button>

          {itens.map((it, i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 12, padding: 12, marginBottom: 10, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: it.tipo === 'peca' ? GOLD : ESP, display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                  {it.tipo === 'peca' ? <><Package size={14} /> Peça</> : <><Wrench size={14} /> Serviço</>}
                  {it.tipo === 'peca' && it.produto_id && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: OK, background: 'rgba(22,101,52,0.08)', borderRadius: 6, padding: '2px 6px' }}>
                      catálogo{it._estoque != null ? ` · estoque ${Number(it._estoque)}` : ''}
                    </span>
                  )}
                </span>
                <button onClick={() => delItem(i)} style={{ background: 'none', border: 'none', color: RED, cursor: 'pointer', padding: 4 }}><Trash2 size={16} /></button>
              </div>
              <input value={it.descricao} onChange={(e) => setItem(i, { descricao: e.target.value })} placeholder={it.tipo === 'peca' ? 'Qual peça?' : 'Qual serviço?'} style={{ ...inp, marginBottom: 8 }} />
              <div style={{ display: 'grid', gridTemplateColumns: it.tipo === 'peca' ? '1fr' : '1fr 1fr', gap: 8, marginBottom: 8 }}>
                {it.tipo === 'peca'
                  ? <Campo l="Qtd"><input value={it.quantidade} onChange={(e) => setItem(i, { quantidade: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" style={inp} /></Campo>
                  : <Campo l="Tempo estimado (h)"><input value={it.tempo_estimado_h} onChange={(e) => setItem(i, { tempo_estimado_h: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" style={inp} /></Campo>}
                {it.tipo === 'servico' && <Campo l="Qtd"><input value={it.quantidade} onChange={(e) => setItem(i, { quantidade: e.target.value.replace(/[^\d.,]/g, '') })} inputMode="decimal" style={inp} /></Campo>}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SEVERIDADES.map((s) => (
                  <button key={s.v} onClick={() => setItem(i, { severidade: s.v })} style={{ ...chip, borderColor: it.severidade === s.v ? s.c : LINE, background: it.severidade === s.v ? s.c : '#fff', color: it.severidade === s.v ? '#fff' : s.c }}>{s.l}</button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => addLinha('servico')} style={{ ...btnLine, flex: 1 }}><Plus size={15} /> Serviço</button>
            <button onClick={() => addLinha('peca')} style={{ ...btnLine, flex: 1 }}><Plus size={15} /> Peça</button>
          </div>
        </Sec>
      </div>

      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: '#fff', borderTop: `1px solid ${LINE}`, padding: '10px 14px', display: 'flex', justifyContent: 'center' }}>
        <button onClick={salvar} disabled={salvando} style={{ ...btnGold, maxWidth: 560, width: '100%', fontSize: 15, minHeight: 48 }}>
          {salvando ? 'Salvando…' : 'Salvar laudo'}
        </button>
      </div>
      {msg && <Toast>{msg}</Toast>}
      {osSel && companyId && (
        <SolicitarPecaModal companyId={companyId} osId={osSel.id} aberto={solicitarAberto}
          onFechar={() => setSolicitarAberto(false)}
          onEnviada={() => setMsg('Solicitação enviada ao responsável.')} />
      )}
    </div>
  )
}

function Sec({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: ESP60, fontWeight: 700, marginBottom: 10 }}>{titulo}</div>
      {children}
    </div>
  )
}
function Campo({ l, children }: { l: string; children: React.ReactNode }) {
  return <div><div style={{ fontSize: 11, color: ESP60, marginBottom: 4 }}>{l}</div>{children}</div>
}
function Toast({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'fixed', bottom: 74, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 16px', borderRadius: 999, fontSize: 13, zIndex: 70, maxWidth: '92%', textAlign: 'center' }}>{children}</div>
}
const inp: CSSProperties = { width: '100%', padding: '11px 12px', border: `1px solid ${LINE}`, borderRadius: 10, fontSize: 15, background: '#fff', color: ESP, outline: 'none', fontFamily: 'inherit' }
const btnGold: CSSProperties = { background: GOLD, color: '#3D2314', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
const btnLine: CSSProperties = { background: '#fff', color: ESP, border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 12px', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4 }
const chip: CSSProperties = { border: `1px solid ${LINE}`, borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }
const linkBtn: CSSProperties = { background: 'none', border: 'none', color: ESP60, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', padding: 0 }
