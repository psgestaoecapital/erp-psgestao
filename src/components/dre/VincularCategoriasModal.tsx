'use client'

// VincularCategoriasModal · Sub-frente 4.4 Onda 4 (CEO 27/05/2026)
// Multi-select de plano de contas + tipo · chama fn_dre_vincular_categoria_linha
// por categoria selecionada.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  companyId: string
  ldnId: string
  ldnNome: string
}

interface Categoria {
  id: string
  codigo: string
  descricao: string
  tipo: string | null
  nivel: number | null
}

type TipoVinculo = 'receita' | 'despesa' | 'custo' | 'financeiro' | 'investimento'

const TIPOS: Array<{ value: TipoVinculo; label: string }> = [
  { value: 'receita', label: 'Receita' },
  { value: 'despesa', label: 'Despesa' },
  { value: 'custo', label: 'Custo' },
  { value: 'financeiro', label: 'Financeiro' },
  { value: 'investimento', label: 'Investimento' },
]

function indent(nivel: number | null | undefined): number {
  return ((nivel ?? 1) - 1) * 16
}

export default function VincularCategoriasModal({ open, onClose, onSucesso, companyId, ldnId, ldnNome }: Props) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [tipo, setTipo] = useState<TipoVinculo>('receita')
  const [filtro, setFiltro] = useState('')
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !companyId) return
    let ignore = false
    ;(async () => {
      const { data } = await supabase
        .from('erp_plano_contas')
        .select('id, codigo, descricao, tipo, nivel')
        .eq('company_id', companyId)
        .eq('ativo', true)
        .order('codigo')
      if (!ignore) setCategorias((data ?? []) as Categoria[])
    })()
    return () => { ignore = true }
  }, [open, companyId])

  useEffect(() => {
    if (open) { setSelecionadas(new Set()); setFiltro(''); setErro(null) }
  }, [open])

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    let base = categorias
    base = categorias.filter((c) => (c.tipo ?? '').toLowerCase() === tipo)
    if (!q) return base
    return base.filter((c) => `${c.codigo} ${c.descricao}`.toLowerCase().includes(q))
  }, [categorias, tipo, filtro])

  function toggle(id: string) {
    const ns = new Set(selecionadas)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setSelecionadas(ns)
  }

  async function vincular() {
    if (selecionadas.size === 0) { setErro('Selecione ao menos 1 categoria'); return }
    setLoading(true)
    setErro(null)
    const escolhidas = categorias.filter((c) => selecionadas.has(c.id))
    let falhas = 0
    let ultimoErro: string | null = null
    for (const cat of escolhidas) {
      const { error } = await supabase.rpc('fn_dre_vincular_categoria_linha', {
        p_ldn_id: ldnId,
        p_categoria_codigo: cat.codigo,
        p_tipo: tipo,
      })
      if (error) { falhas++; ultimoErro = error.message }
    }
    setLoading(false)
    if (falhas === escolhidas.length) {
      setErro(ultimoErro ?? 'Falha ao vincular categorias')
      return
    }
    if (falhas > 0) {
      setErro(`${falhas} de ${escolhidas.length} falharam. Última mensagem: ${ultimoErro}`)
    }
    onSucesso()
    onClose()
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <h2 style={h2}>Vincular categorias</h2>
        <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4, marginBottom: 14 }}>
          LDN: <strong>{ldnNome}</strong>
        </p>

        <div style={{ marginBottom: 12 }}>
          <div style={fieldLabel}>Tipo do vínculo</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TIPOS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTipo(t.value)}
                style={{
                  background: tipo === t.value ? '#3D2314' : '#FFFFFF',
                  color: tipo === t.value ? '#FAF7F2' : '#3D2314',
                  border: '0.5px solid rgba(61,35,20,0.2)',
                  padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar código ou descrição…"
          style={input}
        />

        <div style={{ border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 6, maxHeight: 280, overflow: 'auto', margin: '10px 0' }}>
          {filtradas.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
              Nenhuma categoria encontrada
            </div>
          ) : (
            filtradas.map((c) => (
              <label
                key={c.id}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', borderBottom: '0.5px solid rgba(61,35,20,0.05)', background: selecionadas.has(c.id) ? 'rgba(200,148,26,0.08)' : 'transparent' }}
              >
                <input
                  type="checkbox"
                  checked={selecionadas.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span style={{ paddingLeft: indent(c.nivel), fontSize: 12, color: '#3D2314' }}>
                  <strong style={{ color: 'rgba(61,35,20,0.7)' }}>{c.codigo}</strong> · {c.descricao}
                  {c.tipo && <span style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginLeft: 6 }}>({c.tipo})</span>}
                </span>
              </label>
            ))
          )}
        </div>

        <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginBottom: 6 }}>
          {selecionadas.size} {selecionadas.size === 1 ? 'categoria selecionada' : 'categorias selecionadas'}
        </div>

        {erro && <div style={erroBox}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={vincular} disabled={loading || selecionadas.size === 0} style={primaryBtn(loading)}>
            {loading ? 'Vinculando…' : `Vincular ${selecionadas.size}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal: React.CSSProperties = { background: '#FFFFFF', borderRadius: 12, padding: 24, maxWidth: 540, width: '100%', maxHeight: '90vh', overflow: 'auto' }
const h2: React.CSSProperties = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }
const input: React.CSSProperties = { width: '100%', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3D2314', fontFamily: 'inherit', boxSizing: 'border-box' }
const erroBox: React.CSSProperties = { background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8 }
const fieldLabel: React.CSSProperties = { fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }
function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}
function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
