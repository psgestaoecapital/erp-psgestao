'use client'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Plus, Trash2, Check, Printer, FileText, ChevronLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'
const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const TOP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const BOTTOM = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

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
    const t = setInterval(() => {
      const v = read()
      setId((prev) => (prev === v ? prev : v))
    }, 800)
    return () => clearInterval(t)
  }, [])
  return id
}

type Proc = { id: string; nome: string; cor: string; valor?: number; duracao_min: number }
type Item = { id?: string; procedimento_id?: string; descricao: string; dente: string | null; valor: number; status?: string; ordem: number }
type Pac = { id: string; nome: string }
type Plano = { id: string; titulo: string; status: string; valor_total: number; criado_em: string }

export default function TratamentoPage() {
  const companyId = useCompanyId()
  const [busca, setBusca] = useState('')
  const [pacs, setPacs] = useState<Pac[]>([])
  const [pac, setPac] = useState<Pac | null>(null)
  const [planos, setPlanos] = useState<Plano[]>([])
  const [procs, setProcs] = useState<Proc[]>([])
  const [editando, setEditando] = useState(false)
  const [planoId, setPlanoId] = useState<string | null>(null)
  const [itens, setItens] = useState<Item[]>([])
  const [desconto, setDesconto] = useState(0)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [procSel, setProcSel] = useState<string>('')
  const [valorItem, setValorItem] = useState<number>(0)

  useEffect(() => {
    if (!companyId || busca.length < 2) { setPacs([]); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('erp_odonto_paciente').select('id,nome')
        .eq('company_id', companyId).eq('ativo', true).ilike('nome', `%${busca}%`).limit(8)
      if (alive) setPacs((data as Pac[]) ?? [])
    })()
    return () => { alive = false }
  }, [busca, companyId])

  const carregarProcs = useCallback(async () => {
    if (!companyId) return
    const { data } = await supabase.from('erp_odonto_procedimento')
      .select('id,nome,cor,valor,duracao_min').eq('company_id', companyId).eq('ativo', true)
    setProcs((data as Proc[]) ?? [])
  }, [companyId])
  useEffect(() => { carregarProcs() }, [carregarProcs])

  const carregarPlanos = useCallback(async (p: Pac) => {
    if (!companyId) return
    const { data } = await supabase.rpc('fn_odonto_planos_paciente', { p_company_id: companyId, p_paciente_id: p.id })
    setPlanos((data as Plano[]) ?? [])
  }, [companyId])

  const escolherPac = (p: Pac) => { setPac(p); setPacs([]); setBusca(''); carregarPlanos(p); setEditando(false) }

  const novoPlano = () => { setPlanoId(null); setItens([]); setDesconto(0); setSel(new Set()); setEditando(true) }
  const abrirPlano = async (id: string) => {
    const { data } = await supabase.rpc('fn_odonto_plano_obter', { p_id: id })
    const d = data as { itens: Item[]; plano: { desconto: number } | null }
    setPlanoId(id)
    setItens((d?.itens ?? []).map((i) => ({ ...i })))
    setDesconto(Number(d?.plano?.desconto ?? 0))
    setSel(new Set())
    setEditando(true)
  }

  const toggleDente = (d: number) => {
    const k = String(d)
    const n = new Set(sel)
    if (n.has(k)) n.delete(k); else n.add(k)
    setSel(n)
  }
  const dentesComItem = useMemo(() => {
    const m: Record<string, string> = {}
    itens.forEach((i) => { if (i.dente) m[i.dente] = procs.find((p) => p.id === i.procedimento_id)?.cor || GOLD })
    return m
  }, [itens, procs])

  const addItem = () => {
    const proc = procs.find((p) => p.id === procSel)
    if (!proc) { alert('Escolha um procedimento'); return }
    const v = valorItem || proc.valor || 0
    const alvos: (string | null)[] = sel.size ? Array.from(sel) : [null]
    const novos: Item[] = alvos.map((d, ix) => ({
      procedimento_id: proc.id, descricao: proc.nome, dente: d,
      valor: v, ordem: itens.length + ix, status: 'proposto',
    }))
    setItens([...itens, ...novos]); setSel(new Set()); setValorItem(0); setProcSel('')
  }
  const removerItem = (ix: number) => setItens(itens.filter((_, i) => i !== ix))

  const total = useMemo(
    () => Math.max(0, itens.reduce((s, i) => s + Number(i.valor || 0), 0) - Number(desconto || 0)),
    [itens, desconto],
  )

  const salvar = async (status: 'orcamento' | 'rascunho' = 'orcamento'): Promise<string | null> => {
    if (!companyId || !pac) return null
    const { data, error } = await supabase.rpc('fn_odonto_plano_salvar', {
      p_company_id: companyId,
      p_plano: { paciente_id: pac.id, titulo: `Plano ${new Date().toLocaleDateString('pt-BR')}`, status, desconto },
      p_itens: itens,
      p_plano_id: planoId,
    })
    if (error) { alert(error.message); return null }
    const id = (data as { id: string })?.id ?? null
    if (id) setPlanoId(id)
    carregarPlanos(pac)
    return id
  }
  const aprovar = async () => {
    let id = planoId
    if (!id) id = await salvar('orcamento')
    if (!id) return
    const quem = prompt('Aprovado por (nome do paciente/responsável):') || 'Paciente'
    const { error } = await supabase.rpc('fn_odonto_plano_aprovar', { p_id: id, p_aprovado_por: quem })
    if (error) { alert(error.message); return }
    if (pac) carregarPlanos(pac)
    alert('Orçamento aprovado.')
  }

  if (!companyId) return (
    <div style={{ background: BG, color: ESP60, minHeight: '100%' }} className="p-6 text-sm">
      Selecione uma empresa especifica no topo do menu para abrir os planos de tratamento.
    </div>
  )

  if (!pac) return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6 max-w-2xl mx-auto">
      <div className="text-xs font-semibold tracking-widest uppercase" style={{ color: GOLD }}>Plano de tratamento</div>
      <h1 className="text-2xl sm:text-3xl mt-1 mb-4" style={{ fontFamily: 'ui-serif,Georgia,serif', fontWeight: 600 }}>Selecione o paciente</h1>
      <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
        <Search size={16} style={{ color: ESP60 }} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome…" className="flex-1 outline-none text-sm" style={{ color: ESP }} />
      </div>
      <div className="mt-2">
        {pacs.map((p) => (
          <button key={p.id} onClick={() => escolherPac(p)} className="w-full text-left px-3 py-2.5 rounded-xl mb-1" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            {p.nome}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div style={{ background: BG, color: ESP, minHeight: '100%' }} className="p-4 sm:p-6 max-w-3xl mx-auto">
      <button onClick={() => setPac(null)} className="text-sm inline-flex items-center gap-1 mb-2" style={{ color: ESP60 }}>
        <ChevronLeft size={16} /> trocar paciente
      </button>
      <h1 className="text-2xl font-semibold" style={{ fontFamily: 'ui-serif,Georgia,serif' }}>{pac.nome}</h1>

      {!editando && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold">Planos</span>
            <button onClick={novoPlano} className="px-3 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1" style={{ background: GOLD, color: '#fff' }}>
              <Plus size={15} /> Novo plano
            </button>
          </div>
          {planos.length === 0 && (
            <div className="rounded-xl p-6 text-center text-sm" style={{ border: `1px dashed ${LINE}`, color: ESP60 }}>Nenhum plano ainda.</div>
          )}
          {planos.map((p) => (
            <button key={p.id} onClick={() => abrirPlano(p.id)} className="w-full flex items-center justify-between px-3 py-3 rounded-xl mb-1" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
              <span className="text-sm"><FileText size={14} className="inline mr-1" />{p.titulo} · <span style={{ color: ESP60 }}>{p.status}</span></span>
              <b>{money(Number(p.valor_total))}</b>
            </button>
          ))}
        </div>
      )}

      {editando && (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl p-3" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="text-xs font-semibold mb-2" style={{ color: ESP60 }}>Selecione os dentes (FDI)</div>
            {[TOP, BOTTOM].map((arc, ai) => (
              <div key={ai} className="flex gap-1 justify-center mb-1 overflow-x-auto">
                {arc.map((d) => {
                  const k = String(d)
                  const has = dentesComItem[k]
                  const on = sel.has(k)
                  return (
                    <button key={d} onClick={() => toggleDente(d)} title={`Dente ${d}`}
                      style={{ width: 26, height: 34, flexShrink: 0, borderRadius: 6, fontSize: 10, fontWeight: 600,
                        background: has || (on ? GOLD : '#fff'),
                        color: has || on ? '#fff' : ESP,
                        border: on ? `2px solid ${ESP}` : `1px solid ${LINE}` }}>
                      {d}
                    </button>
                  )
                })}
              </div>
            ))}
            <div className="text-[11px] text-center mt-1" style={{ color: ESP60 }}>arcada superior / inferior · toque para marcar</div>
          </div>

          <div className="rounded-2xl p-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            <div className="flex-1">
              <label className="block text-xs font-medium mb-1">Procedimento</label>
              <select value={procSel} onChange={(e) => { setProcSel(e.target.value); const p = procs.find((x) => x.id === e.target.value); setValorItem(p?.valor ?? 0) }}
                className="w-full rounded-xl px-3 py-2 text-sm bg-white outline-none" style={{ border: `1px solid ${LINE}`, color: ESP }}>
                <option value="">Escolher…</option>
                {procs.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div style={{ width: 120 }}>
              <label className="block text-xs font-medium mb-1">Valor (R$)</label>
              <input type="number" value={valorItem} onChange={(e) => setValorItem(Number(e.target.value))} className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ border: `1px solid ${LINE}`, color: ESP }} />
            </div>
            <button onClick={addItem} className="px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1" style={{ background: ESP, color: '#fff' }}>
              <Plus size={15} /> {sel.size ? `Add ${sel.size} dente(s)` : 'Add geral'}
            </button>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ background: '#fff', border: `1px solid ${LINE}` }}>
            {itens.length === 0 && (
              <div className="p-5 text-center text-sm" style={{ color: ESP60 }}>Nenhum item. Marque dentes e adicione procedimentos.</div>
            )}
            {itens.map((i, ix) => (
              <div key={ix} className="flex items-center gap-2 px-3 py-2.5" style={{ borderBottom: `1px solid ${LINE}` }}>
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: procs.find((p) => p.id === i.procedimento_id)?.cor || GOLD }} />
                <span className="text-sm flex-1">{i.descricao}{i.dente ? ` · dente ${i.dente}` : ' · geral'}</span>
                <b className="text-sm">{money(Number(i.valor))}</b>
                <button onClick={() => removerItem(ix)} style={{ color: '#A65A3A' }}><Trash2 size={15} /></button>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: `1px solid ${LINE}` }}>
              <span className="text-sm" style={{ color: ESP60 }}>Desconto (R$)</span>
              <input type="number" value={desconto} onChange={(e) => setDesconto(Number(e.target.value))} className="w-28 text-right rounded-lg px-2 py-1 text-sm outline-none" style={{ border: `1px solid ${LINE}`, color: ESP }} />
            </div>
            <div className="flex items-center justify-between px-3 py-3" style={{ background: BG }}>
              <span className="font-semibold">Total</span>
              <span className="text-lg font-bold" style={{ color: GOLD }}>{money(total)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => salvar('orcamento')} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#fff', border: `1px solid ${LINE}`, color: ESP }}>Salvar orçamento</button>
            <button onClick={aprovar} className="flex-1 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2" style={{ background: GOLD, color: '#fff' }}>
              <Check size={16} /> Aprovar
            </button>
            <button onClick={() => window.print()} className="px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2" style={{ background: ESP, color: '#fff' }}>
              <Printer size={16} /> Imprimir
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
