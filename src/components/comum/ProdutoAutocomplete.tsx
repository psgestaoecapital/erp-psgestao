'use client'

// FIX-PRODUTO-AUTOCOMPLETE-REUSE-262-v1
// Componente unico de autocomplete de produto · extrai pattern do PR #262.
// Server-side 100% · 2 queries paralelas (starts-with + contains) · debounce
// 250ms · min 1 char · limit 50. Anti-reinvencao.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface ProdutoSelecionado {
  id: string
  codigo: string | null
  nome: string
  unidade: string | null
  preco_custo?: number | null
  preco_custo_medio?: number | null
  estoque_atual?: number | null
}

interface Props {
  companyId: string
  /** Produto ja selecionado (mostra chip · botao limpar) */
  selecionado: ProdutoSelecionado | null
  onSelect: (p: ProdutoSelecionado) => void
  onClear?: () => void
  placeholder?: string
  autoFocus?: boolean
  /** Renderiza linha extra quando o produto e selecionado · ex: "Saldo X · Custo Y" */
  detalheSelecionado?: (p: ProdutoSelecionado) => React.ReactNode
  /** data-testid prefix · cada candidato vira <id>-opt-<produto_id> */
  testId?: string
  /** Estilos opcionais pra encaixar no contexto */
  inputStyle?: React.CSSProperties
  chipStyle?: React.CSSProperties
  dropdownStyle?: React.CSSProperties
  colorAccent?: string
  colorDanger?: string
  colorMuted?: string
  colorBorder?: string
}

const BORDER = '#E0D8CC'
const GOLD = '#C8941A'
const GOLD_BG = '#FDF7E8'
const ESPRESSO = '#3D2314'
const ESPRESSO_M = '#6B5D4F'
const RED = '#EF4444'

export default function ProdutoAutocomplete({
  companyId,
  selecionado,
  onSelect,
  onClear,
  placeholder = 'Buscar produto (nome ou código) · escolha da lista',
  autoFocus = false,
  detalheSelecionado,
  testId = 'produto-autocomplete',
  inputStyle,
  chipStyle,
  dropdownStyle,
  colorAccent = GOLD,
  colorDanger = RED,
  colorMuted = ESPRESSO_M,
  colorBorder = BORDER,
}: Props) {
  const [busca, setBusca] = useState('')
  const [candidatos, setCandidatos] = useState<ProdutoSelecionado[]>([])
  const [buscando, setBuscando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && !selecionado) ref.current?.focus()
  }, [autoFocus, selecionado])

  // Debounce 250ms · server-side · 2 queries paralelas (starts-with + contains) + dedup
  useEffect(() => {
    if (selecionado) { setCandidatos([]); return }
    if (busca.trim().length < 1) { setCandidatos([]); setBuscando(false); return }
    setBuscando(true)
    const t = busca.trim().replace(/[%,()]/g, '')
    const handle = window.setTimeout(async () => {
      try {
        const cols = 'id, codigo, nome, unidade, preco_custo, preco_custo_medio, estoque_atual'
        const inicia = supabase
          .from('erp_produtos').select(cols)
          .eq('company_id', companyId).eq('ativo', true)
          .or(`nome.ilike.${t}%,codigo.ilike.${t}%`)
          .order('nome').limit(50)
        const contem = supabase
          .from('erp_produtos').select(cols)
          .eq('company_id', companyId).eq('ativo', true)
          .ilike('nome', `%${t}%`)
          .order('nome').limit(50)
        const [resIni, resCon] = await Promise.all([inicia, contem])
        const map = new Map<string, ProdutoSelecionado>()
        for (const p of (resIni.data ?? []) as ProdutoSelecionado[]) map.set(p.id, p)
        for (const p of (resCon.data ?? []) as ProdutoSelecionado[]) if (!map.has(p.id)) map.set(p.id, p)
        setCandidatos(Array.from(map.values()).slice(0, 50))
      } finally {
        setBuscando(false)
      }
    }, 250)
    return () => window.clearTimeout(handle)
  }, [busca, selecionado, companyId])

  if (selecionado) {
    return (
      <div
        data-testid={`${testId}-chip`}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: 10,
          background: GOLD_BG, borderRadius: 8, border: `1px solid ${colorBorder}`,
          ...chipStyle,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: ESPRESSO }}>{selecionado.nome}</div>
          {selecionado.codigo && (
            <div style={{ fontSize: 10, color: colorMuted, fontFamily: 'monospace' }}>{selecionado.codigo}</div>
          )}
          {detalheSelecionado && (
            <div style={{ fontSize: 11, color: ESPRESSO, marginTop: 2 }}>
              {detalheSelecionado(selecionado)}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => { onClear?.(); setBusca('') }}
          data-testid={`${testId}-clear`}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: colorDanger, padding: 4 }}
          aria-label="Trocar produto"
        >
          ✕
        </button>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={ref}
        type="text"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder={placeholder}
        data-testid={`${testId}-input`}
        style={{
          width: '100%',
          padding: '10px 12px',
          minHeight: 44,
          border: `1px solid ${colorBorder}`,
          borderRadius: 8,
          fontSize: 13,
          color: ESPRESSO,
          outline: 'none',
          ...inputStyle,
        }}
      />
      {busca.trim().length >= 1 && (
        <div
          style={{
            marginTop: 6,
            maxHeight: 220,
            overflowY: 'auto',
            border: `1px solid ${colorBorder}`,
            borderRadius: 8,
            background: '#fff',
            ...dropdownStyle,
          }}
        >
          {buscando ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: colorAccent }}>Buscando…</div>
          ) : candidatos.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: colorMuted, fontStyle: 'italic' }}>
              Nenhum produto encontrado.
            </div>
          ) : (
            candidatos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onSelect(p); setBusca('') }}
                data-testid={`${testId}-opt-${p.id}`}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none', background: 'none',
                  borderBottom: `1px solid ${colorBorder}55`, cursor: 'pointer', fontSize: 12,
                }}
              >
                <strong style={{ color: ESPRESSO }}>{p.nome}</strong>
                {p.codigo && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: colorMuted, fontFamily: 'monospace' }}>{p.codigo}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
