'use client'

// FEAT-CADASTRO-SERVICOS-v1 · PR-1
// Espelho de ProdutoAutocomplete (PR #268) · server-side · 2 queries paralelas
// (starts-with + contains) · debounce 250ms · min 1 char · limit 50.
// Reuso direto · sem reinventar (RD-35).

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

export interface ServicoSelecionado {
  id: string
  codigo: string | null
  descricao_resumida: string
  codigo_servico_municipio?: string | null
  codigo_lc116?: string | null
  cnae?: string | null
  aliquota_iss?: number | null
  iss_retido?: boolean | null
  valor_unitario?: number | null
}

interface Props {
  companyId: string
  selecionado: ServicoSelecionado | null
  onSelect: (s: ServicoSelecionado) => void
  onClear?: () => void
  placeholder?: string
  autoFocus?: boolean
  detalheSelecionado?: (s: ServicoSelecionado) => React.ReactNode
  testId?: string
}

const BORDER = '#E0D8CC'
const GOLD = '#C8941A'
const GOLD_BG = '#FDF7E8'
const ESPRESSO = '#3D2314'
const ESPRESSO_M = '#6B5D4F'
const RED = '#EF4444'

export default function ServicoAutocomplete({
  companyId,
  selecionado,
  onSelect,
  onClear,
  placeholder = 'Buscar serviço (descrição ou código) · escolha da lista',
  autoFocus = false,
  detalheSelecionado,
  testId = 'servico-autocomplete',
}: Props) {
  const [busca, setBusca] = useState('')
  const [candidatos, setCandidatos] = useState<ServicoSelecionado[]>([])
  const [buscando, setBuscando] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus && !selecionado) ref.current?.focus()
  }, [autoFocus, selecionado])

  useEffect(() => {
    if (selecionado) { setCandidatos([]); return }
    if (busca.trim().length < 1) { setCandidatos([]); setBuscando(false); return }
    setBuscando(true)
    const t = busca.trim().replace(/[%,()]/g, '')
    const handle = window.setTimeout(async () => {
      try {
        const cols = 'id, codigo, descricao_resumida, codigo_servico_municipio, codigo_lc116, cnae, aliquota_iss, iss_retido, valor_unitario'
        const inicia = supabase
          .from('erp_servicos').select(cols)
          .eq('company_id', companyId).eq('ativo', true)
          .or(`descricao_resumida.ilike.${t}%,codigo.ilike.${t}%`)
          .order('descricao_resumida').limit(50)
        const contem = supabase
          .from('erp_servicos').select(cols)
          .eq('company_id', companyId).eq('ativo', true)
          .ilike('descricao_resumida', `%${t}%`)
          .order('descricao_resumida').limit(50)
        const [resIni, resCon] = await Promise.all([inicia, contem])
        const map = new Map<string, ServicoSelecionado>()
        for (const s of (resIni.data ?? []) as ServicoSelecionado[]) map.set(s.id, s)
        for (const s of (resCon.data ?? []) as ServicoSelecionado[]) if (!map.has(s.id)) map.set(s.id, s)
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
          background: GOLD_BG, borderRadius: 8, border: `1px solid ${BORDER}`,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: ESPRESSO }}>{selecionado.descricao_resumida}</div>
          {selecionado.codigo && (
            <div style={{ fontSize: 10, color: ESPRESSO_M, fontFamily: 'monospace' }}>{selecionado.codigo}</div>
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
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: RED, padding: 4 }}
          aria-label="Trocar serviço"
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
          width: '100%', padding: '10px 12px', minHeight: 44,
          border: `1px solid ${BORDER}`, borderRadius: 8,
          fontSize: 13, color: ESPRESSO, outline: 'none',
        }}
      />
      {busca.trim().length >= 1 && (
        <div
          style={{
            marginTop: 6, maxHeight: 220, overflowY: 'auto',
            border: `1px solid ${BORDER}`, borderRadius: 8, background: '#fff',
          }}
        >
          {buscando ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: GOLD }}>Buscando…</div>
          ) : candidatos.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 12, color: ESPRESSO_M, fontStyle: 'italic' }}>
              Nenhum serviço encontrado.
            </div>
          ) : (
            candidatos.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { onSelect(s); setBusca('') }}
                data-testid={`${testId}-opt-${s.id}`}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', border: 'none', background: 'none',
                  borderBottom: `1px solid ${BORDER}55`, cursor: 'pointer', fontSize: 12,
                }}
              >
                <strong style={{ color: ESPRESSO }}>{s.descricao_resumida}</strong>
                {s.codigo && (
                  <span style={{ marginLeft: 8, fontSize: 10, color: ESPRESSO_M, fontFamily: 'monospace' }}>{s.codigo}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
