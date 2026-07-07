'use client'

// CategoriaCombobox — busca digitavel + criar categoria inline
// Fase 1 · CEO autorizado 07/07.
//
// Chama fn_plano_contas_buscar(company_id, termo, aplicacao) com debounce.
// Aplicacao='pagar' (forms de despesa) filtra tipo IN (despesa,custo);
// 'receber' filtra tipo=receita. Retorna templates globais + custom da empresa,
// analiticas primeiro. Se termo nao bate nada, oferece "+ Criar categoria [termo]"
// que abre mini-modal pra escolher pai e chama fn_plano_contas_criar_inline.
//
// Pilar 2: RPC roda com company_id do useCompanyIds da empresa selecionada.
// Categoria criada e SEMPRE custom da empresa (nunca polui template global).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Categoria = {
  codigo: string
  descricao: string
  grupo: string
  tipo: string
  nivel: number
  pai_codigo: string | null
  is_totalizador: boolean
  origem: 'empresa' | 'global'
}

type Aplicacao = 'pagar' | 'receber'

interface Props {
  companyId: string
  aplicacao: Aplicacao
  value: string
  onChange: (codigo: string) => void
  disabled?: boolean
  placeholder?: string
}

const C = {
  espresso: '#3D2314',
  espressoM: 'rgba(61,35,20,0.65)',
  espressoL: 'rgba(61,35,20,0.45)',
  border: 'rgba(61,35,20,0.15)',
  cream: '#F0ECE3',
  offWhite: '#FAF7F2',
  gold: '#C8941A',
  goldBg: 'rgba(200,148,26,0.10)',
  greenBg: 'rgba(22,163,74,0.10)',
  green: '#166534',
  red: '#B91C1C',
}

export default function CategoriaCombobox({
  companyId,
  aplicacao,
  value,
  onChange,
  disabled,
  placeholder = 'digite pra buscar (ex: aluguel, 2.04)…',
}: Props) {
  const [termo, setTermo] = useState('')
  const [resultados, setResultados] = useState<Categoria[]>([])
  const [buscando, setBuscando] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [valorDescricao, setValorDescricao] = useState<string>('')
  const [criarAberto, setCriarAberto] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Ao setar value externamente (form editar / pos-criar), busca descricao pra display
  useEffect(() => {
    if (!value) { setValorDescricao(''); return }
    let alive = true
    ;(async () => {
      // busca especifica pelo codigo exato
      const { data } = await supabase.rpc('fn_plano_contas_buscar', {
        p_company_id: companyId,
        p_termo: value,
        p_aplicacao: aplicacao,
      })
      if (!alive) return
      const match = ((data ?? []) as Categoria[]).find((c) => c.codigo === value)
      setValorDescricao(match ? `${match.codigo} · ${match.descricao}` : value)
    })()
    return () => { alive = false }
  }, [value, companyId, aplicacao])

  // Fecha ao clicar fora
  useEffect(() => {
    if (!aberto) return
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [aberto])

  // Debounce 250ms
  useEffect(() => {
    if (!aberto) return
    if (!companyId) return
    const t = setTimeout(async () => {
      setBuscando(true)
      const { data, error } = await supabase.rpc('fn_plano_contas_buscar', {
        p_company_id: companyId,
        p_termo: termo || null,
        p_aplicacao: aplicacao,
      })
      setBuscando(false)
      if (error) { setResultados([]); return }
      setResultados((data ?? []) as Categoria[])
    }, 250)
    return () => clearTimeout(t)
  }, [termo, companyId, aplicacao, aberto])

  const selecionar = useCallback((c: Categoria) => {
    onChange(c.codigo)
    setValorDescricao(`${c.codigo} · ${c.descricao}`)
    setTermo('')
    setAberto(false)
  }, [onChange])

  const podeCriar = termo.trim().length >= 2 && !buscando &&
    !resultados.some((c) => c.descricao.toLowerCase() === termo.trim().toLowerCase())

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        onClick={() => !disabled && setAberto(true)}
        style={{
          padding: '7px 10px',
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          fontSize: 12,
          color: value ? C.espresso : C.espressoL,
          background: disabled ? C.cream : '#FFFFFF',
          cursor: disabled ? 'not-allowed' : 'text',
          minHeight: 32,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? valorDescricao : '— escolher —'}
        </span>
        {value && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); setValorDescricao(''); setTermo('') }}
            title="Limpar"
            style={{ background: 'transparent', border: 'none', color: C.espressoL, cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
          >×</button>
        )}
      </div>

      {aberto && !disabled && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
            background: '#FFFFFF', border: `1px solid ${C.border}`, borderRadius: 6,
            boxShadow: '0 8px 24px rgba(61,35,20,0.15)',
            zIndex: 30,
            maxHeight: 360, overflowY: 'auto',
          }}
        >
          <div style={{ padding: 8, borderBottom: `1px solid ${C.border}`, background: C.offWhite }}>
            <input
              autoFocus
              type="text"
              value={termo}
              onChange={(e) => setTermo(e.target.value)}
              placeholder={placeholder}
              style={{
                width: '100%', padding: '6px 8px',
                border: `1px solid ${C.border}`, borderRadius: 4,
                fontSize: 12, color: C.espresso, background: '#FFFFFF', outline: 'none',
              }}
            />
          </div>

          {buscando && (
            <div style={{ padding: 12, fontSize: 11, color: C.espressoL, textAlign: 'center' }}>
              Buscando…
            </div>
          )}

          {!buscando && resultados.length === 0 && termo.trim().length >= 2 && (
            <div style={{ padding: 12, fontSize: 12, color: C.espressoM, textAlign: 'center' }}>
              Nenhuma categoria encontrada pra “{termo}”.
            </div>
          )}

          {!buscando && resultados.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {resultados.map((c) => (
                <li key={c.codigo}>
                  <button
                    type="button"
                    onClick={() => selecionar(c)}
                    style={{
                      width: '100%', textAlign: 'left',
                      padding: '8px 12px', border: 'none', background: 'transparent',
                      cursor: 'pointer', fontSize: 12, color: C.espresso,
                      display: 'flex', alignItems: 'center', gap: 8,
                      borderBottom: `0.5px solid ${C.border}`,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = C.goldBg)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{
                      fontFamily: 'monospace', fontSize: 11, fontWeight: 700,
                      color: c.is_totalizador ? C.espressoL : C.gold,
                      minWidth: 60,
                    }}>{c.codigo}</span>
                    <span style={{ flex: 1 }}>
                      {c.descricao}
                      {c.is_totalizador && (
                        <span style={{ marginLeft: 6, fontSize: 9, color: C.espressoL, fontStyle: 'italic' }}>
                          (grupo)
                        </span>
                      )}
                    </span>
                    {c.origem === 'empresa' && (
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        background: C.greenBg, color: C.green, fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: 0.3,
                      }}>custom</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {podeCriar && (
            <button
              type="button"
              onClick={() => setCriarAberto(true)}
              style={{
                width: '100%', textAlign: 'left',
                padding: '10px 12px', border: 'none',
                background: C.goldBg, cursor: 'pointer',
                fontSize: 12, color: C.gold, fontWeight: 600,
                borderTop: `1px solid ${C.border}`,
              }}
            >
              ➕ Criar categoria “{termo}”
            </button>
          )}
        </div>
      )}

      {criarAberto && (
        <CriarInlineModal
          companyId={companyId}
          aplicacao={aplicacao}
          descricaoInicial={termo}
          onFechar={() => setCriarAberto(false)}
          onCriada={(c) => {
            setCriarAberto(false)
            selecionar(c)
          }}
        />
      )}
    </div>
  )
}

// ============================================================
// Mini-modal: criar categoria inline
// ============================================================

function CriarInlineModal({
  companyId, aplicacao, descricaoInicial, onFechar, onCriada,
}: {
  companyId: string
  aplicacao: Aplicacao
  descricaoInicial: string
  onFechar: () => void
  onCriada: (c: Categoria) => void
}) {
  const [descricao, setDescricao] = useState(descricaoInicial)
  const [pais, setPais] = useState<Categoria[]>([])
  const [paiCodigo, setPaiCodigo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.rpc('fn_plano_contas_arvore', {
        p_company_id: companyId,
        p_aplicacao: aplicacao,
      })
      if (!alive) return
      // Somente niveis 1 e 2 podem ser pai (nivel 3 e' folha, nao permite filhos)
      const paisAceitos = ((data ?? []) as Categoria[])
        .filter((c) => c.nivel < 3)
        .sort((a, b) => a.codigo.localeCompare(b.codigo))
      setPais(paisAceitos)
    })()
    return () => { alive = false }
  }, [companyId, aplicacao])

  async function criar() {
    if (!descricao.trim() || !paiCodigo) return
    setSalvando(true)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_plano_contas_criar_inline', {
      p_company_id: companyId,
      p_descricao: descricao.trim(),
      p_pai_codigo: paiCodigo,
    })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    const criada = ((data ?? []) as Categoria[])[0]
    if (criada) onCriada(criada)
  }

  return (
    <div
      onClick={onFechar}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.offWhite, borderRadius: 10, width: '100%', maxWidth: 480,
          padding: 20, border: `1px solid ${C.border}`,
          boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
        }}
      >
        <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: C.espresso }}>
          Criar categoria
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 11, color: C.espressoM }}>
          Nova categoria custom da empresa. Não afeta outras empresas.
        </p>

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.espressoM, marginBottom: 4 }}>
          Nome da categoria *
        </label>
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          autoFocus
          maxLength={100}
          placeholder='ex: "Assinatura ChatGPT"'
          style={{
            width: '100%', padding: '7px 10px',
            border: `1px solid ${C.border}`, borderRadius: 4,
            fontSize: 12, color: C.espresso, background: '#FFFFFF', outline: 'none',
            marginBottom: 12,
          }}
        />

        <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.espressoM, marginBottom: 4 }}>
          Categoria pai (grupo/subgrupo) *
        </label>
        <select
          value={paiCodigo}
          onChange={(e) => setPaiCodigo(e.target.value)}
          style={{
            width: '100%', padding: '7px 10px',
            border: `1px solid ${C.border}`, borderRadius: 4,
            fontSize: 12, color: C.espresso, background: '#FFFFFF', outline: 'none',
          }}
        >
          <option value="">— escolher pai —</option>
          {pais.map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {'  '.repeat(Math.max(0, p.nivel - 1))}{p.codigo} · {p.descricao}
            </option>
          ))}
        </select>
        <p style={{ margin: '4px 0 0', fontSize: 10, color: C.espressoL }}>
          A nova categoria fica dentro deste grupo/subgrupo.
        </p>

        {erro && (
          <div style={{ marginTop: 12, padding: '8px 10px', background: 'rgba(185,28,28,0.10)', color: C.red, borderRadius: 4, fontSize: 11 }}>
            {erro}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            onClick={onFechar}
            disabled={salvando}
            style={{
              padding: '7px 14px', border: `1px solid ${C.border}`,
              borderRadius: 6, background: 'transparent',
              color: C.espresso, fontSize: 12, fontWeight: 500,
              cursor: salvando ? 'not-allowed' : 'pointer',
            }}
          >Cancelar</button>
          <button
            type="button"
            onClick={criar}
            disabled={salvando || !descricao.trim() || !paiCodigo}
            style={{
              padding: '7px 14px', border: 'none',
              borderRadius: 6, background: C.gold,
              color: '#FFFFFF', fontSize: 12, fontWeight: 700,
              cursor: (salvando || !descricao.trim() || !paiCodigo) ? 'not-allowed' : 'pointer',
              opacity: (salvando || !descricao.trim() || !paiCodigo) ? 0.6 : 1,
            }}
          >{salvando ? 'CRIANDO…' : 'CRIOU categoria'}</button>
        </div>
      </div>
    </div>
  )
}
