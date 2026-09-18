'use client'

// #59 PDOIS parte 2 · picker de cliente com cadastro rápido (padrão b9333675 dos Leads/Propostas).
// Reusa fn_cliente_buscar ({resultados:[{cliente_id,nome,cnpj_cpf}]}) e fn_cliente_criar_inline (→ uuid).
// value = erp_cliente_id. Autônomo (estilos próprios, Espresso/Dourado) para servir modais de contrato.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const C = { espresso: '#3D2314', espressoM: '#6B5D4F', border: '#E0D8CC', gold: '#C8941A', white: '#FFFFFF' }
const inp: React.CSSProperties = { width: '100%', minHeight: 38, padding: '8px 10px', fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.espresso, outline: 'none', boxSizing: 'border-box' }
const btnSec: React.CSSProperties = { minHeight: 38, padding: '0 12px', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 6, background: 'transparent', color: C.espresso, cursor: 'pointer' }
const btnPri: React.CSSProperties = { minHeight: 38, padding: '0 14px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 6, background: C.gold, color: C.white, cursor: 'pointer' }

interface Props {
  companyId: string
  value: string
  onChange: (erpId: string, nome?: string) => void
  onToast?: (s: string) => void
  placeholder?: string
}

export default function ClientePickerInline({ companyId, value, onChange, onToast, placeholder }: Props) {
  const [q, setQ] = useState('')
  const [nomeSel, setNomeSel] = useState('')
  const [sug, setSug] = useState<{ id: string; nome: string; doc: string | null }[]>([])
  const [buscando, setBuscando] = useState(false)
  const [open, setOpen] = useState(false)
  const [criando, setCriando] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        const { data } = await supabase.rpc('fn_cliente_buscar', { p_company_id: companyId, p_termo: term, p_limit: 8 })
        const res = ((data as { resultados?: { cliente_id: string; nome: string; cnpj_cpf: string | null }[] } | null)?.resultados) ?? []
        setSug(res.map((r) => ({ id: r.cliente_id, nome: r.nome, doc: r.cnpj_cpf })))
      } finally { setBuscando(false) }
    }, 250)
  }
  function escolher(c: { id: string; nome: string }) { onChange(c.id, c.nome); setNomeSel(c.nome); setOpen(false); setSug([]); setQ('') }
  async function criarInline() {
    const nome = (novoNome || q).trim()
    if (!nome) { onToast?.('Digite o nome/empresa do cliente.'); return }
    const { data, error } = await supabase.rpc('fn_cliente_criar_inline', { p_company_id: companyId, p_nome: nome, p_cpf_cnpj: null, p_extra: {} })
    if (error) { onToast?.(`Erro ao criar cliente: ${error.message}`); return }
    const id = data as string | null
    if (id) { onChange(id, nome); setNomeSel(nome) }
    setCriando(false); setNovoNome(''); setOpen(false); setSug([])
    onToast?.('Cliente criado na GE e vinculado.')
  }

  return (
    <div style={{ position: 'relative' }}>
      {value ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ ...inp, flex: 1, display: 'flex', alignItems: 'center' }}>{nomeSel || 'Cliente selecionado'}</div>
          <button type="button" onClick={() => { onChange(''); setNomeSel(''); setQ('') }} style={btnSec}>Trocar</button>
        </div>
      ) : (
        <input style={inp} value={q} onChange={(e) => buscar(e.target.value)}
          onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder ?? 'Buscar cliente da GE…'} />
      )}
      {!value && open && (q.trim().length >= 2 || criando) && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20, background: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, marginTop: 2, boxShadow: '0 6px 20px rgba(0,0,0,.10)', maxHeight: 240, overflowY: 'auto' }}>
          {buscando && <div style={{ padding: '8px 10px', fontSize: 12, color: C.espressoM }}>Buscando…</div>}
          {sug.map((c) => (
            <div key={c.id} onMouseDown={(e) => { e.preventDefault(); escolher(c) }}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, borderBottom: `1px solid ${C.border}` }}>
              {c.nome}{c.doc ? <span style={{ color: C.espressoM, fontSize: 11, marginLeft: 6 }}>· {c.doc}</span> : null}
            </div>
          ))}
          {!criando ? (
            <div onMouseDown={(e) => { e.preventDefault(); setCriando(true); setNovoNome(q) }}
              style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 13, color: C.gold, fontWeight: 700 }}>
              + Cadastrar cliente{q.trim() ? ` "${q.trim()}"` : ''} na GE
            </div>
          ) : (
            <div style={{ padding: 10, display: 'flex', gap: 6 }} onMouseDown={(e) => e.preventDefault()}>
              <input style={{ ...inp, flex: 1 }} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome do cliente" autoFocus />
              <button type="button" onMouseDown={(e) => { e.preventDefault(); void criarInline() }} style={btnPri}>Criar</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
