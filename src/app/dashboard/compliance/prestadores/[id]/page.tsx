'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { fmtData, fmtDataHora, fmtR } from '@/lib/psgc-tokens'
import { UploadDocumentoModal, type UploadContext } from '../../_components/UploadDocumentoModal'
import { C, StatusBadge, baixarDocumento } from '../../_components/ui'

type Prestador = {
  id: string
  company_id: string
  razao_social: string
  cnpj: string
  nome_fantasia: string | null
  responsavel_nome: string | null
  responsavel_cpf: string | null
  email: string | null
  telefone: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  tipo_contrato: string | null
  data_contrato_inicio: string | null
  data_contrato_fim: string | null
  valor_contrato_mensal: number | null
  servico_descricao: string | null
  empresa_tomadora_id: string | null
  empresa_tomadora_nome: string | null
  obra_nome: string | null
  ativo: boolean
  observacoes: string | null
}

type MatrizLinha = {
  tipo_documento_id: string
  tipo_slug: string
  tipo_nome: string
  tipo_grupo: string | null
  obrigatorio: boolean
  documento_id: string | null
  data_emissao: string | null
  data_validade: string | null
  status_validade: string | null
  status_final: string
  dias_para_vencer: number | null
  dispensa_motivo?: string | null
}

type Documento = {
  id: string
  versao: number
  uploaded_at: string
  arquivo_nome_original: string
  data_emissao: string | null
  data_validade: string | null
  status_validade: string | null
  ativo: boolean
}

type Aba = 'dados' | 'documentos' | 'historico'

export default function PrestadorDetalhePage() {
  const params = useParams()
  const id = params.id as string

  const [prestador, setPrestador] = useState<Prestador | null>(null)
  const [matriz, setMatriz] = useState<MatrizLinha[]>([])
  const [historico, setHistorico] = useState<Documento[]>([])
  const [aba, setAba] = useState<Aba>('dados')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [uploadCtx, setUploadCtx] = useState<UploadContext | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const carregar = useCallback(async () => {
    setLoading(true)
    setErro(null)
    try {
      const res = await authFetch(`/api/compliance/prestadores/${id}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      setPrestador(j.prestador)
      setMatriz(j.matriz || [])
      setHistorico(j.historico || [])
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { carregar() }, [carregar])

  async function dispensar(linha: MatrizLinha, motivo: string) {
    if (!prestador) return
    try {
      const res = await authFetch('/api/compliance/dispensas', {
        method: 'POST',
        body: JSON.stringify({
          company_id: prestador.company_id,
          tipo_documento_id: linha.tipo_documento_id,
          prestador_id: prestador.id,
          motivo: motivo.trim() || null,
        }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      showToast('✓ Documento dispensado')
      await carregar()
    } catch (e: any) {
      showToast(e.message || 'Falha ao dispensar', false)
    }
  }

  async function reativar(linha: MatrizLinha) {
    if (!prestador) return
    try {
      const res = await authFetch('/api/compliance/dispensas', {
        method: 'DELETE',
        body: JSON.stringify({
          company_id: prestador.company_id,
          tipo_documento_id: linha.tipo_documento_id,
          prestador_id: prestador.id,
        }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      showToast('✓ Cobrança reativada')
      await carregar()
    } catch (e: any) {
      showToast(e.message || 'Falha ao reativar', false)
    }
  }

  if (loading && !prestador) {
    return (
      <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', padding: 32, color: C.muted }}>
        Carregando…
      </div>
    )
  }
  if (!prestador) {
    return (
      <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', padding: 32 }}>
        <div style={{ background: C.redBg, color: C.red, padding: 16, borderRadius: 8 }}>{erro || 'Prestador não encontrado'}</div>
        <Link href="/dashboard/compliance/prestadores" style={{ color: C.espresso, fontSize: 13, fontWeight: 600 }}>← Voltar</Link>
      </div>
    )
  }

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>
            <Link href="/dashboard/compliance/prestadores" style={{ color: 'inherit', textDecoration: 'none' }}>Compliance &gt; Prestadores</Link>
          </p>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 4px' }}>
            {prestador.razao_social}
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
            {prestador.cnpj} · {prestador.tipo_contrato?.toUpperCase().replace('_', ' ') || '—'}
            {prestador.empresa_tomadora_nome && ` · tomadora: ${prestador.empresa_tomadora_nome}`}
          </p>
        </header>

        <nav style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${C.borderLt}`, marginBottom: 20 }}>
          {(['dados', 'documentos', 'historico'] as Aba[]).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              style={{
                padding: '10px 16px',
                background: 'none',
                border: 'none',
                borderBottom: aba === a ? `2px solid ${C.espresso}` : '2px solid transparent',
                color: aba === a ? C.espresso : C.muted,
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {a === 'dados' ? 'Dados' : a === 'documentos' ? 'Documentos' : 'Histórico'}
            </button>
          ))}
        </nav>

        {aba === 'dados' && (
          <AbaDados prestador={prestador} onSave={carregar} onErro={(m) => showToast(m, false)} onSucesso={(m) => showToast(m)} />
        )}
        {aba === 'documentos' && (
          <AbaDocumentos
            matriz={matriz}
            onUpload={(linha) => setUploadCtx({
              companyId: prestador.company_id,
              tipoDocumentoId: linha.tipo_documento_id,
              tipoNome: linha.tipo_nome,
              prestadorId: prestador.id,
              modo: linha.documento_id ? 'substituir' : 'upload',
            })}
            onBaixar={(docId) => baixarDocumento(docId)}
            onDispensar={dispensar}
            onReativar={reativar}
          />
        )}
        {aba === 'historico' && (
          <AbaHistorico historico={historico} onBaixar={(docId) => baixarDocumento(docId)} />
        )}
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

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 200, padding: '12px 18px', borderRadius: 8, background: toast.ok ? C.espresso : C.red, color: 'white', fontSize: 13, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function AbaDados({
  prestador, onSave, onErro, onSucesso,
}: {
  prestador: Prestador
  onSave: () => void
  onErro: (m: string) => void
  onSucesso: (m: string) => void
}) {
  const [form, setForm] = useState<Prestador>(prestador)
  const [salvando, setSalvando] = useState(false)
  function set<K extends keyof Prestador>(k: K, v: any) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function salvar() {
    setSalvando(true)
    try {
      const res = await authFetch(`/api/compliance/prestadores/${prestador.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.mensagem_humana || j.error || 'falha')
      onSucesso('✓ Dados salvos')
      onSave()
    } catch (e: any) {
      onErro(e.message || 'Falha ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <section style={{ background: 'white', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <F label="Razão Social" v={form.razao_social} onChange={(v) => set('razao_social', v)} />
        <F label="CNPJ" v={form.cnpj} onChange={(v) => set('cnpj', v)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <F label="Nome fantasia" v={form.nome_fantasia || ''} onChange={(v) => set('nome_fantasia', v)} />
        <Field label="Tipo de contrato">
          <select value={form.tipo_contrato || ''} onChange={(e: any) => set('tipo_contrato', e.target.value || null)} style={inp()}>
            <option value="">— selecione —</option>
            <option value="mei">MEI</option>
            <option value="pj_simples">PJ Simples</option>
            <option value="pj_lucro_real">PJ Lucro Real</option>
          </select>
        </Field>
      </div>
      <F label="Responsável (nome)" v={form.responsavel_nome || ''} onChange={(v) => set('responsavel_nome', v)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <F label="E-mail" v={form.email || ''} onChange={(v) => set('email', v)} />
        <F label="Telefone" v={form.telefone || ''} onChange={(v) => set('telefone', v)} />
      </div>
      <Field label="Valor contrato mensal (R$)">
        <input
          type="number"
          step="0.01"
          value={form.valor_contrato_mensal ?? ''}
          onChange={(e: any) => set('valor_contrato_mensal', e.target.value ? Number(e.target.value) : null)}
          style={inp()}
        />
      </Field>
      <Field label="Descrição do serviço">
        <textarea
          value={form.servico_descricao || ''}
          onChange={(e: any) => set('servico_descricao', e.target.value)}
          style={{ ...inp(), minHeight: 60 }}
        />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Data início contrato">
          <input type="date" value={form.data_contrato_inicio || ''} onChange={(e: any) => set('data_contrato_inicio', e.target.value || null)} style={inp()} />
        </Field>
        <Field label="Data fim contrato">
          <input type="date" value={form.data_contrato_fim || ''} onChange={(e: any) => set('data_contrato_fim', e.target.value || null)} style={inp()} />
        </Field>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={salvar} disabled={salvando} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: salvando ? 'not-allowed' : 'pointer', opacity: salvando ? 0.6 : 1 }}>
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>
    </section>
  )
}

function AbaDocumentos({
  matriz, onUpload, onBaixar, onDispensar, onReativar,
}: {
  matriz: MatrizLinha[]
  onUpload: (linha: MatrizLinha) => void
  onBaixar: (docId: string) => void
  onDispensar: (linha: MatrizLinha, motivo: string) => void
  onReativar: (linha: MatrizLinha) => void
}) {
  const [linhaMotivo, setLinhaMotivo] = useState<MatrizLinha | null>(null)
  const [motivo, setMotivo] = useState('')

  const ordenadas = useMemo(() =>
    [...matriz].sort((a, b) => {
      if (a.obrigatorio !== b.obrigatorio) return a.obrigatorio ? -1 : 1
      return a.tipo_nome.localeCompare(b.tipo_nome)
    }),
    [matriz]
  )

  return (
    <section style={{ background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: C.beigeLt }}>
              <Th>Documento</Th>
              <Th>Grupo</Th>
              <Th>Status</Th>
              <Th>Validade</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {ordenadas.length === 0 && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum tipo cadastrado</td></tr>)}
            {ordenadas.map((m, i) => (
              <tr key={m.tipo_documento_id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}`, opacity: m.obrigatorio ? 1 : 0.85 }}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{m.tipo_nome}</div>
                  {m.obrigatorio ? (
                    <div style={{ fontSize: 10, color: C.amber, marginTop: 2, fontWeight: 600 }}>OBRIGATÓRIO</div>
                  ) : (
                    <div style={{ fontSize: 10, color: C.gray, marginTop: 2, fontWeight: 600 }}>OPCIONAL</div>
                  )}
                </Td>
                <Td>{m.tipo_grupo || '—'}</Td>
                <Td><StatusBadge status={m.status_final} /></Td>
                <Td mono>
                  {m.status_final === 'nao_se_aplica' ? (
                    <span style={{ fontSize: 11, color: C.muted }}>{m.dispensa_motivo || 'dispensado'}</span>
                  ) : (
                    <>
                      {fmtData(m.data_validade)}
                      {m.dias_para_vencer != null && m.status_final === 'vencendo' && (
                        <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>em {m.dias_para_vencer}d</div>
                      )}
                    </>
                  )}
                </Td>
                <Td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.status_final === 'nao_se_aplica' ? (
                      <>
                        <button onClick={() => onReativar(m)} style={btnSecSm()}>🔄 Reativar</button>
                        <button onClick={() => onUpload(m)} style={btnPrimSm()}>📤 Upload</button>
                      </>
                    ) : m.documento_id ? (
                      <>
                        <button onClick={() => onUpload(m)} style={btnPrimSm()}>Substituir</button>
                        <button onClick={() => onBaixar(m.documento_id!)} style={btnSecSm()}>Baixar</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => onUpload(m)} style={btnPrimSm()}>📤 Upload</button>
                        <button
                          onClick={() => { setLinhaMotivo(m); setMotivo('') }}
                          style={{ ...btnSecSm(), borderColor: C.neutral, color: C.neutral }}
                        >
                          🚫 Não se aplica
                        </button>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linhaMotivo && (
        <div onClick={() => setLinhaMotivo(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={(e: any) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, padding: 24, width: 'min(440px, 92vw)' }}>
            <h3 style={{ margin: '0 0 4px', fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 400 }}>Marcar como "não se aplica"</h3>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: C.muted }}>{linhaMotivo.tipo_nome}</p>
            <textarea
              value={motivo}
              onChange={(e: any) => setMotivo(e.target.value)}
              placeholder="Motivo (opcional): ex: prestador isento por contrato"
              rows={3}
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.borderLt}`, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button onClick={() => setLinhaMotivo(null)} style={btnSecSm()}>Cancelar</button>
              <button onClick={() => { onDispensar(linhaMotivo!, motivo); setLinhaMotivo(null) }} style={btnPrimSm()}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function AbaHistorico({ historico, onBaixar }: { historico: Documento[]; onBaixar: (id: string) => void }) {
  if (historico.length === 0) {
    return (
      <section style={{ background: 'white', borderRadius: 12, padding: 32, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)', textAlign: 'center', color: C.muted }}>
        Nenhum documento foi enviado ainda.
      </section>
    )
  }
  return (
    <section style={{ background: 'white', borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ backgroundColor: C.beigeLt }}>
              <Th>Enviado em</Th>
              <Th>Versão</Th>
              <Th>Arquivo</Th>
              <Th>Emissão</Th>
              <Th>Validade</Th>
              <Th>Ativo</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {historico.map((d, i) => (
              <tr key={d.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}`, opacity: d.ativo ? 1 : 0.55 }}>
                <Td mono>{fmtDataHora(d.uploaded_at)}</Td>
                <Td mono>v{d.versao}</Td>
                <Td>{d.arquivo_nome_original}</Td>
                <Td mono>{fmtData(d.data_emissao)}</Td>
                <Td mono>{fmtData(d.data_validade)}</Td>
                <Td>{d.ativo ? 'Sim' : 'Substituído'}</Td>
                <Td><button onClick={() => onBaixar(d.id)} style={btnSecSm()}>Baixar</button></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function F({ label, v, onChange }: { label: string; v: string; onChange: (v: string) => void }) {
  return <Field label={label}><input value={v} onChange={(e: any) => onChange(e.target.value)} style={inp()} /></Field>
}
function Field({ label, children }: { label: string; children: any }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}
function inp() { return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box', fontFamily: 'inherit' } as any }
function btnPrimSm() { return { padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' } as any }
function btnSecSm() { return { padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' } as any }
function Th({ children }: { children: any }) { return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>) }
function Td({ children, mono }: { children: any; mono?: boolean }) { return (<td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>{children}</td>) }
