'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { UploadDocumentoModal, type UploadContext } from '../_components/UploadDocumentoModal'
import { C, baixarDocumento } from '../_components/ui'

type Tipo = { id: string; slug: string; nome: string; grupo: string | null; obrigatorio: boolean }
type Celula = {
  tipo_documento_id: string
  tipo_slug: string
  tipo_nome: string
  documento_id: string | null
  data_emissao: string | null
  data_validade: string | null
  status_validade: string | null
  status_final: string
  dias_para_vencer: number | null
  obrigatorio: boolean
}
type Linha = {
  funcionario_id: string
  nome_completo: string
  cpf: string | null
  cargo: string | null
  setor: string | null
  empresa_tomadora_nome: string | null
  obra_nome: string | null
  funcionario_ativo: boolean
  documentos: Record<string, Celula>
}

function corDotStatus(status: string | null | undefined): { bg: string; fg: string; emoji: string; label: string } {
  switch (status) {
    case 'valido': return { bg: C.greenBg, fg: C.green, emoji: '🟢', label: 'Válido' }
    case 'vencendo': return { bg: C.amberBg, fg: C.amber, emoji: '🟡', label: 'Vencendo' }
    case 'vencido': return { bg: C.redBg, fg: C.red, emoji: '🔴', label: 'Vencido' }
    case 'nao_emitido': return { bg: C.grayBg, fg: C.gray, emoji: '⚫', label: 'Não emitido' }
    default: return { bg: C.grayBg, fg: C.gray, emoji: '⚫', label: status || 'Não emitido' }
  }
}

export default function MatrizPage() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds?.[0] ?? null
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [tipos, setTipos] = useState<Tipo[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [fTomadora, setFTomadora] = useState('')
  const [fObra, setFObra] = useState('')
  const [fSetor, setFSetor] = useState('')
  const [fCargo, setFCargo] = useState('')
  const [celulaSelecionada, setCelulaSelecionada] = useState<{ linha: Linha; celula: Celula } | null>(null)
  const [uploadCtx, setUploadCtx] = useState<UploadContext | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setErro(null)
    try {
      const params = new URLSearchParams({ company_id: companyId })
      if (fTomadora) params.set('empresa_tomadora', fTomadora)
      if (fObra) params.set('obra', fObra)
      if (fSetor) params.set('setor', fSetor)
      if (fCargo) params.set('cargo', fCargo)
      const res = await authFetch(`/api/compliance/matriz?${params.toString()}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      setTipos(j.tipos || [])
      setLinhas(j.funcionarios || [])
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [companyId, fTomadora, fObra, fSetor, fCargo])

  useEffect(() => { carregar() }, [carregar])

  const opcoesTomadora = useMemo(() => Array.from(new Set(linhas.map((l: Linha) => l.empresa_tomadora_nome).filter(Boolean) as string[])).sort(), [linhas])
  const opcoesObra = useMemo(() => Array.from(new Set(linhas.map((l: Linha) => l.obra_nome).filter(Boolean) as string[])).sort(), [linhas])
  const opcoesSetor = useMemo(() => Array.from(new Set(linhas.map((l: Linha) => l.setor).filter(Boolean) as string[])).sort(), [linhas])
  const opcoesCargo = useMemo(() => Array.from(new Set(linhas.map((l: Linha) => l.cargo).filter(Boolean) as string[])).sort(), [linhas])

  function exportarCsv() {
    const header = ['Funcionário', 'CPF', 'Cargo', 'Setor', 'Tomadora', 'Obra', ...tipos.map((t: Tipo) => t.nome)]
    const rows = linhas.map((l: Linha) => {
      const cols: string[] = [l.nome_completo, l.cpf || '', l.cargo || '', l.setor || '', l.empresa_tomadora_nome || '', l.obra_nome || '']
      for (const t of tipos) {
        const c = l.documentos[t.slug]
        if (!c || c.status_final === 'nao_emitido') cols.push('Não emitido')
        else cols.push(`${corDotStatus(c.status_final).label}${c.data_validade ? ' (até ' + c.data_validade + ')' : ''}`)
      }
      return cols
    })
    const csv = [header, ...rows].map((r: string[]) => r.map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `matriz-compliance-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: '100%', margin: '0 auto', padding: '24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Matriz de Conformidade</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>{linhas.length} funcionários × {tipos.length} documentos. Clique numa célula para ver/editar.</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/dashboard/compliance" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
            <button onClick={exportarCsv} disabled={loading || linhas.length === 0} style={{ padding: '10px 14px', borderRadius: 8, border: 'none', backgroundColor: C.gold, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              Exportar Excel (CSV)
            </button>
          </div>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}

        <section style={{ backgroundColor: 'white', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <select value={fTomadora} onChange={(e: any) => setFTomadora(e.target.value)} style={selectStyle()}>
            <option value="">Todas as tomadoras</option>
            {opcoesTomadora.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={fObra} onChange={(e: any) => setFObra(e.target.value)} style={selectStyle()}>
            <option value="">Todas as obras</option>
            {opcoesObra.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={fSetor} onChange={(e: any) => setFSetor(e.target.value)} style={selectStyle()}>
            <option value="">Todos os setores</option>
            {opcoesSetor.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
          <select value={fCargo} onChange={(e: any) => setFCargo(e.target.value)} style={selectStyle()}>
            <option value="">Todos os cargos</option>
            {opcoesCargo.map((s: string) => (<option key={s} value={s}>{s}</option>))}
          </select>
        </section>

        <section style={{ backgroundColor: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto', maxHeight: '70vh', overflowY: 'auto' }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ ...headerStyle(), left: 0, position: 'sticky', zIndex: 3, background: C.beigeLt, minWidth: 240 }}>Funcionário</th>
                  {tipos.map((t: Tipo) => (
                    <th key={t.id} style={{ ...headerStyle(), minWidth: 80 }} title={t.nome}>
                      <div style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', padding: '12px 4px', whiteSpace: 'nowrap' }}>
                        {t.nome}{t.obrigatorio ? ' *' : ''}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={tipos.length + 1} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && linhas.length === 0 && (<tr><td colSpan={tipos.length + 1} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Sem funcionários</td></tr>)}
                {linhas.map((l: Linha, i: number) => (
                  <tr key={l.funcionario_id} style={{ background: i % 2 === 0 ? 'white' : C.offwhite }}>
                    <td style={{ padding: '8px 12px', borderBottom: `1px solid ${C.borderLt}`, left: 0, position: 'sticky', zIndex: 2, background: i % 2 === 0 ? 'white' : C.offwhite, minWidth: 240 }}>
                      <Link href={`/dashboard/compliance/funcionarios/${l.funcionario_id}`} style={{ color: C.espresso, textDecoration: 'none', fontWeight: 600 }}>{l.nome_completo}</Link>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{l.cargo || '—'} · {l.empresa_tomadora_nome || 'sem tomadora'}</div>
                    </td>
                    {tipos.map((t: Tipo) => {
                      const c = l.documentos[t.slug]
                      const d = corDotStatus(c?.status_final)
                      return (
                        <td key={t.id} style={{ padding: 4, borderBottom: `1px solid ${C.borderLt}`, textAlign: 'center' }}>
                          <button
                            onClick={() => {
                              if (!c) return
                              setCelulaSelecionada({ linha: l, celula: c })
                            }}
                            title={`${t.nome}: ${d.label}${c?.data_validade ? ' até ' + c.data_validade : ''}`}
                            style={{
                              width: 32, height: 32, borderRadius: '50%',
                              border: 'none', background: d.bg, color: d.fg,
                              fontSize: 14, cursor: c ? 'pointer' : 'default',
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            }}
                          >
                            {d.emoji}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {celulaSelecionada && companyId && (
        <CelulaModal
          linha={celulaSelecionada.linha}
          celula={celulaSelecionada.celula}
          onClose={() => setCelulaSelecionada(null)}
          onBaixar={() => celulaSelecionada.celula.documento_id && baixarDocumento(celulaSelecionada.celula.documento_id)}
          onSubstituir={() => {
            setUploadCtx({
              companyId,
              tipoDocumentoId: celulaSelecionada.celula.tipo_documento_id,
              tipoNome: celulaSelecionada.celula.tipo_nome,
              funcionarioId: celulaSelecionada.linha.funcionario_id,
              modo: celulaSelecionada.celula.documento_id ? 'substituir' : 'upload',
            })
            setCelulaSelecionada(null)
          }}
        />
      )}

      {uploadCtx && (
        <UploadDocumentoModal
          ctx={uploadCtx}
          onClose={() => setUploadCtx(null)}
          onUploaded={() => {
            setUploadCtx(null)
            carregar()
          }}
        />
      )}
    </div>
  )
}

function CelulaModal({
  linha, celula, onClose, onBaixar, onSubstituir,
}: {
  linha: Linha; celula: Celula
  onClose: () => void
  onBaixar: () => void
  onSubstituir: () => void
}) {
  const d = corDotStatus(celula.status_final)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(460px, 92vw)' }}>
        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
          {linha.nome_completo}
        </p>
        <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 400, margin: '4px 0 12px' }}>{celula.tipo_nome}</h2>
        <div style={{ padding: '8px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, backgroundColor: d.bg, color: d.fg, display: 'inline-block', marginBottom: 12 }}>
          {d.emoji} {d.label}
        </div>
        <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.6 }}>
          <div><strong>Emissão:</strong> {celula.data_emissao || '—'}</div>
          <div><strong>Validade:</strong> {celula.data_validade || '—'}</div>
          {celula.dias_para_vencer != null && (<div><strong>Dias para vencer:</strong> {celula.dias_para_vencer}</div>)}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
          <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Fechar</button>
          {celula.documento_id && (
            <button onClick={onBaixar} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Baixar</button>
          )}
          <button onClick={onSubstituir} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            {celula.documento_id ? 'Substituir' : 'Fazer upload'}
          </button>
          <Link href={`/dashboard/compliance/funcionarios/${linha.funcionario_id}`} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            Ver funcionário
          </Link>
        </div>
      </div>
    </div>
  )
}

function headerStyle() {
  return {
    padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700,
    letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)',
    background: C.beigeLt, borderBottom: `1px solid ${C.borderLt}`, top: 0, position: 'sticky', zIndex: 1,
  } as any
}
function selectStyle() { return { padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 13, backgroundColor: 'white', minWidth: 140 } as any }
