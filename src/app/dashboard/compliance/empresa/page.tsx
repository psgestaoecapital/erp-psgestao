'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import { UploadDocumentoModal, type UploadContext } from '../_components/UploadDocumentoModal'
import { C, StatusBadge, baixarDocumento } from '../_components/ui'

type TipoEmpresa = {
  id: string
  slug: string
  nome: string
  grupo: string | null
  obrigatorio: boolean
  ordem_exibicao: number
}

type DocEmpresa = {
  id: string
  tipo_documento_id: string
  data_emissao: string | null
  data_validade: string | null
  status_validade: string | null
  dias_para_vencer: number | null
  arquivo_nome_original: string
  ativo: boolean
}

type LinhaMatriz = {
  tipo: TipoEmpresa
  documento: DocEmpresa | null
}

export default function ComplianceEmpresaPage() {
  const { companyIds } = useCompanyIds()
  const companyId = companyIds?.[0] ?? null
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaMatriz[]>([])
  const [uploadCtx, setUploadCtx] = useState<UploadContext | null>(null)

  const carregar = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    setErro(null)
    try {
      const [{ data: tipos, error: e1 }, { data: docs, error: e2 }] = await Promise.all([
        supabase
          .from('compliance_tipos_documento')
          .select('id, slug, nome, grupo, obrigatorio, ordem_exibicao')
          .eq('categoria', 'empresa')
          .eq('ativo', true)
          .order('ordem_exibicao')
          .order('nome'),
        supabase
          .from('compliance_documentos')
          .select('id, tipo_documento_id, data_emissao, data_validade, status_validade, dias_para_vencer, arquivo_nome_original, ativo')
          .eq('company_id', companyId)
          .not('empresa_alvo_id', 'is', null)
          .eq('ativo', true),
      ])
      if (e1) throw new Error(e1.message)
      if (e2) throw new Error(e2.message)
      const docsPorTipo = new Map<string, DocEmpresa>()
      for (const d of (docs as any as DocEmpresa[]) || []) {
        docsPorTipo.set(d.tipo_documento_id, d)
      }
      const out: LinhaMatriz[] = ((tipos as any as TipoEmpresa[]) || []).map((t) => ({
        tipo: t,
        documento: docsPorTipo.get(t.id) ?? null,
      }))
      setLinhas(out)
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { carregar() }, [carregar])

  function statusFinal(l: LinhaMatriz): string {
    if (!l.documento) return 'nao_emitido'
    return l.documento.status_validade || 'valido'
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Documentos da Empresa</h1>
            <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Certidões, alvarás, INSS, FGTS e documentos institucionais.</p>
          </div>
          <Link href="/dashboard/compliance" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>← Voltar</Link>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}

        <section style={{ background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ backgroundColor: C.beigeLt }}>
                  <Th>Documento</Th>
                  <Th>Grupo</Th>
                  <Th>Status</Th>
                  <Th>Validade</Th>
                  <Th>Arquivo</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {loading && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
                {!loading && linhas.length === 0 && (<tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum tipo cadastrado</td></tr>)}
                {linhas.map((l: LinhaMatriz, i: number) => (
                  <tr key={l.tipo.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{l.tipo.nome}</div>
                      {l.tipo.obrigatorio && <div style={{ fontSize: 10, color: C.red, marginTop: 2, fontWeight: 600 }}>OBRIGATÓRIO</div>}
                    </Td>
                    <Td>{l.tipo.grupo || '—'}</Td>
                    <Td><StatusBadge status={statusFinal(l)} /></Td>
                    <Td mono>
                      {l.documento?.data_validade || '—'}
                      {l.documento?.dias_para_vencer != null && statusFinal(l) === 'vencendo' && (
                        <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>em {l.documento.dias_para_vencer}d</div>
                      )}
                    </Td>
                    <Td>{l.documento?.arquivo_nome_original || '—'}</Td>
                    <Td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!l.documento ? (
                          <button
                            onClick={() => {
                              if (!companyId) return
                              setUploadCtx({
                                companyId, tipoDocumentoId: l.tipo.id, tipoNome: l.tipo.nome,
                                empresaAlvoId: companyId, modo: 'upload',
                              })
                            }}
                            style={btnPrim()}
                          >
                            Upload
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => {
                                if (!companyId) return
                                setUploadCtx({
                                  companyId, tipoDocumentoId: l.tipo.id, tipoNome: l.tipo.nome,
                                  empresaAlvoId: companyId, modo: 'substituir',
                                })
                              }}
                              style={btnPrim()}
                            >
                              Substituir
                            </button>
                            <button onClick={() => baixarDocumento(l.documento!.id)} style={btnSec()}>Baixar</button>
                          </>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

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

function btnPrim() { return { padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' } as any }
function btnSec() { return { padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' } as any }
function Th({ children }: { children: any }) { return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>) }
function Td({ children, mono }: { children: any; mono?: boolean }) { return (<td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>{children}</td>) }
