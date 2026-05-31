'use client'

// VincularLinhasDREModal · Bloco 6.3b · GE rodar-como-ContaAzul
// Espelho do VincularCategoriasModal: parte da categoria do plano de contas
// e seleciona N linhas DRE (linhas_negocio) para vincular.
// Chama fn_dre_vincular_categoria_linha(ldn_id, categoria_codigo, tipo) por linha.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ContaPlano } from './PlanoContasForm'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  companyId: string
  categoria: ContaPlano | null
}

interface LinhaNegocio {
  id: string
  nome: string
  ativo: boolean
}

interface VinculoExistente {
  divisao: string
  tipo: string
}

export default function VincularLinhasDREModal({ open, onClose, onSucesso, companyId, categoria }: Props) {
  const [linhas, setLinhas] = useState<LinhaNegocio[]>([])
  const [vinculos, setVinculos] = useState<VinculoExistente[]>([])
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [filtro, setFiltro] = useState('')
  const [loading, setLoading] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !companyId || !categoria) return
    let ignore = false
    setLoading(true)
    setErro(null)
    ;(async () => {
      const [{ data: lns }, { data: vncs }] = await Promise.all([
        supabase
          .from('linhas_negocio')
          .select('id, nome, ativo')
          .eq('empresa_id', companyId)
          .eq('ativo', true)
          .order('ordem', { ascending: true })
          .order('nome', { ascending: true }),
        supabase
          .from('erp_dre_divisoes')
          .select('divisao, tipo')
          .eq('company_id', companyId)
          .eq('categoria_codigo', categoria.codigo),
      ])
      if (ignore) return
      setLinhas((lns ?? []) as LinhaNegocio[])
      setVinculos((vncs ?? []) as VinculoExistente[])
      setSelecionadas(new Set())
      setLoading(false)
    })()
    return () => { ignore = true }
  }, [open, companyId, categoria])

  useEffect(() => {
    if (!open) { setFiltro(''); setErro(null) }
  }, [open])

  const jaVinculadas = useMemo(() => new Set(vinculos.map((v) => v.divisao)), [vinculos])

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter((l) => l.nome.toLowerCase().includes(q))
  }, [linhas, filtro])

  function toggle(id: string) {
    const ns = new Set(selecionadas)
    if (ns.has(id)) ns.delete(id); else ns.add(id)
    setSelecionadas(ns)
  }

  async function vincular() {
    if (!categoria) return
    if (selecionadas.size === 0) { setErro('Selecione ao menos 1 linha DRE'); return }
    setSalvando(true)
    setErro(null)
    let falhas = 0
    let ultimoErro: string | null = null
    for (const ldnId of selecionadas) {
      const { error } = await supabase.rpc('fn_dre_vincular_categoria_linha', {
        p_ldn_id: ldnId,
        p_categoria_codigo: categoria.codigo,
        p_tipo: categoria.tipo,
      })
      if (error) { falhas++; ultimoErro = error.message }
    }
    setSalvando(false)
    if (falhas === selecionadas.size) {
      setErro(ultimoErro ?? 'Falha ao vincular linhas DRE')
      return
    }
    onSucesso()
    onClose()
  }

  if (!open || !categoria) return null

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <h2 style={h2}>Vincular ao DRE</h2>
        <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4, marginBottom: 14 }}>
          Categoria: <strong>{categoria.codigo} · {categoria.descricao}</strong>
        </p>

        {vinculos.length > 0 && (
          <div style={{ background: 'rgba(200,148,26,0.08)', border: '0.5px solid rgba(200,148,26,0.3)', borderRadius: 6, padding: '10px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#854F0B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
              Vínculos atuais ({vinculos.length})
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {vinculos.map((v) => {
                const ln = linhas.find((l) => l.id === v.divisao)
                return (
                  <span key={`${v.divisao}-${v.tipo}`} style={{ fontSize: 11, background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.15)', borderRadius: 4, padding: '3px 8px', color: '#3D2314' }}>
                    {ln?.nome ?? v.divisao} <span style={{ color: 'rgba(61,35,20,0.5)' }}>({v.tipo})</span>
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar linha DRE…"
          style={input}
        />

        <div style={{ border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 6, maxHeight: 280, overflow: 'auto', margin: '10px 0' }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>Carregando…</div>
          ) : filtradas.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
              Nenhuma linha DRE encontrada. Cadastre divisões / LDNs primeiro.
            </div>
          ) : (
            filtradas.map((l) => {
              const ja = jaVinculadas.has(l.id)
              return (
                <label
                  key={l.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: ja ? 'default' : 'pointer', borderBottom: '0.5px solid rgba(61,35,20,0.05)', background: selecionadas.has(l.id) ? 'rgba(200,148,26,0.08)' : ja ? 'rgba(61,35,20,0.04)' : 'transparent', opacity: ja ? 0.6 : 1 }}
                >
                  <input
                    type="checkbox"
                    checked={selecionadas.has(l.id)}
                    onChange={() => toggle(l.id)}
                    disabled={ja}
                  />
                  <span style={{ fontSize: 12, color: '#3D2314' }}>
                    {l.nome}
                    {ja && <span style={{ fontSize: 10, color: '#854F0B', marginLeft: 6 }}>(já vinculada)</span>}
                  </span>
                </label>
              )
            })
          )}
        </div>

        {erro && (
          <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{erro}</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={salvando} style={btnSec}>Cancelar</button>
          <button type="button" onClick={vincular} disabled={salvando || loading || selecionadas.size === 0} style={btnPri(salvando || selecionadas.size === 0)}>
            {salvando ? 'Vinculando…' : `Vincular ${selecionadas.size > 0 ? selecionadas.size : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }
const modal: React.CSSProperties = { background: '#FAF7F2', borderRadius: 12, maxWidth: 520, width: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 20 }
const h2: React.CSSProperties = { margin: 0, fontSize: 16, fontWeight: 600, color: '#3D2314' }
const input: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 13, color: '#3D2314', background: '#FFFFFF', boxSizing: 'border-box' }
const btnSec: React.CSSProperties = { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '8px 18px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }
function btnPri(disabled: boolean): React.CSSProperties {
  return { background: disabled ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '8px 18px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
