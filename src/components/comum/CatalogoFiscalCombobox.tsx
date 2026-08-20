'use client'

// CatalogoFiscalCombobox — busca pesquisável de código fiscal (NBS / LC116), estilo OMIE.
// Genérico por `tipo`: chama fn_catalogo_fiscal_buscar(tipo, termo) com debounce.
// Grava o `codigo`; a descrição é só pra exibir. Catálogo é global (sem company_id).
//
// "Mostrar lista": abrir o campo já lista o topo do catálogo (termo vazio) pra navegar.
// Linhas `seed=true` são exemplos (não a lista oficial) → mostra um selo discreto.

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type ItemCatalogo = { codigo: string; descricao: string; capitulo: string | null; seed: boolean }
type TipoCatalogo = 'nbs' | 'lc116'

interface Props {
  tipo: TipoCatalogo
  value: string
  onChange: (codigo: string) => void
  disabled?: boolean
  placeholder?: string
}

export default function CatalogoFiscalCombobox({ tipo, value, onChange, disabled, placeholder }: Props) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<ItemCatalogo[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [descricaoSel, setDescricaoSel] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Resolve a descrição do value atual (edição / pós-seleção).
  useEffect(() => {
    if (!value) { setDescricaoSel(''); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase.rpc('fn_catalogo_fiscal_buscar', { p_tipo: tipo, p_termo: value, p_limite: 30 })
      if (!alive) return
      const match = ((data ?? []) as ItemCatalogo[]).find((c) => c.codigo === value)
      setDescricaoSel(match ? match.descricao : '')
    })()
    return () => { alive = false }
  }, [value, tipo])

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!aberto) return
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [aberto])

  // Busca: 0ms na abertura (termo vazio → topo do catálogo), 200ms ao digitar.
  useEffect(() => {
    if (!aberto) return
    const delay = termo.trim() === '' ? 0 : 200
    const t = setTimeout(async () => {
      setBuscando(true)
      setErro(null)
      const { data, error } = await supabase.rpc('fn_catalogo_fiscal_buscar', {
        p_tipo: tipo, p_termo: termo.trim() || null, p_limite: 30,
      })
      setBuscando(false)
      if (error) { setErro(error.message); setResultados([]); return }
      setResultados((data ?? []) as ItemCatalogo[])
    }, delay)
    return () => clearTimeout(t)
  }, [termo, tipo, aberto])

  const selecionar = useCallback((c: ItemCatalogo) => {
    onChange(c.codigo)
    setDescricaoSel(c.descricao)
    setTermo('')
    setAberto(false)
  }, [onChange])

  return (
    <div ref={wrapRef} className="relative">
      <div
        onClick={() => !disabled && setAberto(true)}
        className={`w-full px-3 py-2 text-[13px] border border-[#3D2314]/15 rounded-lg flex items-center justify-between gap-2 min-h-[38px] ${disabled ? 'bg-[#F0ECE3] cursor-not-allowed' : 'bg-white cursor-text'}`}
      >
        <span className={`truncate ${value ? 'text-[#3D2314]' : 'text-[#3D2314]/45'}`}>
          {value ? <><span className="font-mono">{value}</span>{descricaoSel && <span className="text-[#3D2314]/60"> — {descricaoSel}</span>}</> : '— buscar no catálogo —'}
        </span>
        {value && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); setDescricaoSel(''); setTermo('') }}
            className="text-[#3D2314]/45 hover:text-[#3D2314] px-1"
            title="Limpar"
          >×</button>
        )}
      </div>

      {aberto && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-[#3D2314]/15 rounded-lg shadow-xl z-30 max-h-[340px] overflow-y-auto">
          <div className="p-2 border-b border-[#3D2314]/10 bg-[#FAF7F2] sticky top-0">
            <input
              autoFocus
              type="text"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder={placeholder ?? 'digite código ou palavra (ex.: gesso)…'}
              className="w-full px-2.5 py-1.5 text-[12.5px] border border-[#3D2314]/15 rounded focus:outline-none focus:ring-2 focus:ring-[#C8941A]/40"
            />
          </div>

          {buscando && <div className="p-3 text-[11px] text-[#3D2314]/50 text-center">Buscando…</div>}
          {!buscando && erro && <div className="p-3 text-[11px] text-[#B91C1C] text-center">Erro: {erro}</div>}
          {!buscando && !erro && resultados.length === 0 && (
            <div className="p-3 text-[12px] text-[#3D2314]/55 text-center">
              {termo.trim() === '' ? 'Catálogo ainda não carregado.' : `Nada encontrado pra “${termo}”.`}
            </div>
          )}

          {!buscando && !erro && resultados.length > 0 && (
            <ul className="list-none p-0 m-0">
              {resultados.map((c) => (
                <li key={c.codigo}>
                  <button
                    type="button"
                    onClick={() => selecionar(c)}
                    className="w-full text-left px-3 py-2 flex items-start gap-2 text-[12.5px] text-[#3D2314] border-b border-[#3D2314]/8 hover:bg-[#C8941A]/10"
                  >
                    <span className="font-mono text-[11px] font-bold text-[#C8941A] min-w-[92px]">{c.codigo}</span>
                    <span className="flex-1">
                      {c.descricao}
                      {c.seed && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wide text-[#8A5A00] bg-[#C8941A]/10 px-1 py-0.5 rounded">exemplo</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
