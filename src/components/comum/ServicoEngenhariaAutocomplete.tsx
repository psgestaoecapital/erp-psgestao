'use client'
// Busca no CATÁLOGO DE ENGENHARIA (projetos_servicos = Composição de Preço Unitário + BOM).
// Diferente do ServicoAutocomplete (erp_servicos = serviço FISCAL LC116/ISS). NÃO são a mesma coisa.
// Devolve o CUSTO (custo_unitario_total); o preço de venda (custo × (1+BDI)) é aplicado por quem chama.
import { useEffect, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'

export type ServicoEngSelecionado = {
  id: string; codigo: string | null; nome: string; unidade: string | null; custo_unitario_total: number
}

export default function ServicoEngenhariaAutocomplete({ companyId, selecionado, onSelect, onClear, testId }: {
  companyId: string
  selecionado: ServicoEngSelecionado | null
  onSelect: (s: ServicoEngSelecionado) => void
  onClear: () => void
  testId?: string
}) {
  const [termo, setTermo] = useState('')
  const [opts, setOpts] = useState<ServicoEngSelecionado[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open || termo.trim().length < 1 || !companyId) { setOpts([]); return }
    const t = setTimeout(async () => {
      const { data } = await supabase.from('projetos_servicos')
        .select('id,codigo,nome,unidade,custo_unitario_total')
        .eq('company_id', companyId).eq('ativo', true)
        .or(`nome.ilike.%${termo}%,codigo.ilike.%${termo}%`)
        .order('codigo').limit(10)
      setOpts(((data ?? []) as Array<{ id: string; codigo: string | null; nome: string; unidade: string | null; custo_unitario_total: number | null }>)
        .map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, unidade: r.unidade, custo_unitario_total: Number(r.custo_unitario_total) || 0 })))
    }, 250)
    return () => clearTimeout(t)
  }, [termo, open, companyId])

  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  if (selecionado) {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 11, color: '#3D2314' }}>
          {selecionado.codigo && <b style={{ fontFamily: 'monospace', color: '#7C3AED' }}>{selecionado.codigo} </b>}{selecionado.nome}
        </span>
        <button onClick={onClear} style={xBtn} title="Trocar serviço">✕</button>
      </div>
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <input data-testid={testId} value={termo} onChange={(e) => { setTermo(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        placeholder="Buscar serviço de engenharia (CPU)…" style={inp} />
      {open && opts.length > 0 && (
        <div style={dd}>
          {opts.map((o) => (
            <div key={o.id} onClick={() => { onSelect(o); setOpen(false); setTermo('') }} style={ddItem}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#F0ECE3')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
              <div style={{ color: '#3D2314' }}><span style={{ color: '#7C3AED', fontFamily: 'monospace', fontSize: 10 }}>{o.codigo}</span> {o.nome}</div>
              <div style={{ fontSize: 9, color: '#6B5D4F' }}>custo {brl(o.custo_unitario_total)}/{o.unidade || 'UN'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const inp: CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #E0D8CC', background: '#fff', color: '#3D2314', boxSizing: 'border-box' }
const wrap: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '4px 6px', border: '1px solid #E0D8CC', borderRadius: 6, background: '#fff' }
const xBtn: CSSProperties = { border: 'none', background: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12 }
const dd: CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #E0D8CC', borderRadius: 6, marginTop: 2, zIndex: 20, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }
const ddItem: CSSProperties = { padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #E0D8CC', fontSize: 11 }
