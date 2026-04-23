'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { UploadDocumentoModal, type UploadContext } from '../../_components/UploadDocumentoModal'
import { C, StatusBadge, baixarDocumento } from '../../_components/ui'

type Matriz = {
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
  arquivo_url: string | null
}

type Documento = {
  id: string
  tipo_documento_id: string
  data_emissao: string | null
  data_validade: string | null
  status_validade: string | null
  numero_documento: string | null
  emissor: string | null
  arquivo_nome_original: string
  uploaded_at: string
  versao: number
  ativo: boolean
}

type Funcionario = Record<string, any>

export default function FuncionarioDetalhePage() {
  const params = useParams()
  const id = String(params?.id ?? '')
  const [tab, setTab] = useState<'dados' | 'documentos' | 'historico'>('dados')
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [funcionario, setFuncionario] = useState<Funcionario | null>(null)
  const [matriz, setMatriz] = useState<Matriz[]>([])
  const [historico, setHistorico] = useState<Documento[]>([])
  const [uploadCtx, setUploadCtx] = useState<UploadContext | null>(null)

  const carregar = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setErro(null)
    try {
      const res = await authFetch(`/api/compliance/funcionarios/${id}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      setFuncionario(j.funcionario)
      setMatriz(j.matriz || [])
      setHistorico(j.historico || [])
    } catch (e: any) {
      setErro(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { carregar() }, [carregar])

  return (
    <div style={{ backgroundColor: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>Compliance · Funcionário</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 30, fontWeight: 400, margin: '4px 0 4px' }}>
              {funcionario?.nome_completo || (loading ? 'Carregando…' : 'Não encontrado')}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>
              {funcionario?.cargo || '—'} · {funcionario?.setor || '—'} · {funcionario?.empresa_tomadora_nome || 'sem tomadora'}
            </p>
          </div>
          <Link href="/dashboard/compliance/funcionarios" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            ← Voltar
          </Link>
        </header>

        {erro && (<div style={{ backgroundColor: C.redBg, color: C.red, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>{erro}</div>)}

        {/* Abas */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.borderLt}` }}>
          {([
            { k: 'dados', label: 'Dados' },
            { k: 'documentos', label: `Documentos (${matriz.length})` },
            { k: 'historico', label: `Histórico (${historico.length})` },
          ] as const).map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              style={{
                padding: '10px 16px',
                border: 'none',
                borderBottom: tab === t.k ? `2px solid ${C.espresso}` : '2px solid transparent',
                background: 'transparent',
                color: tab === t.k ? C.espresso : C.muted,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dados' && funcionario && (
          <AbaDados funcionario={funcionario} onSaved={carregar} />
        )}
        {tab === 'documentos' && (
          <AbaDocumentos
            loading={loading}
            matriz={matriz}
            onUpload={(m, modo) => {
              if (!funcionario) return
              setUploadCtx({
                companyId: funcionario.company_id,
                tipoDocumentoId: m.tipo_documento_id,
                tipoNome: m.tipo_nome,
                funcionarioId: funcionario.id,
                modo,
              })
            }}
            onBaixar={(docId) => baixarDocumento(docId)}
          />
        )}
        {tab === 'historico' && (
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
    </div>
  )
}

function AbaDados({ funcionario, onSaved }: { funcionario: Funcionario; onSaved: () => void }) {
  const [form, setForm] = useState<Funcionario>(funcionario)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => { setForm(funcionario) }, [funcionario])
  function set(k: string, v: any) { setForm((f: Funcionario) => ({ ...f, [k]: v })) }

  async function salvar() {
    setSalvando(true)
    setMsg(null)
    try {
      const payload = { ...form }
      delete payload.id
      delete payload.company_id
      delete payload.created_at
      delete payload.updated_at
      const res = await authFetch(`/api/compliance/funcionarios/${funcionario.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'falha')
      setMsg('Salvo com sucesso')
      onSaved()
    } catch (e: any) {
      setMsg(`Erro: ${e.message}`)
    } finally {
      setSalvando(false)
      setTimeout(() => setMsg(null), 4000)
    }
  }

  return (
    <section style={{ background: 'white', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(61, 35, 20, 0.06)' }}>
      {msg && (<div style={{ backgroundColor: C.beigeLt, color: C.espresso, padding: '8px 12px', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>{msg}</div>)}
      <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: '0 0 12px' }}>Pessoais</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <F label="Nome completo *" v={form.nome_completo || ''} onChange={(v) => set('nome_completo', v)} />
        <F label="CPF" v={form.cpf || ''} onChange={(v) => set('cpf', v)} />
        <F label="RG" v={form.rg || ''} onChange={(v) => set('rg', v)} />
        <F label="Data nascimento" v={form.data_nascimento || ''} onChange={(v) => set('data_nascimento', v)} type="date" />
        <F label="Email" v={form.email || ''} onChange={(v) => set('email', v)} />
        <F label="Telefone" v={form.telefone || ''} onChange={(v) => set('telefone', v)} />
      </div>

      <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: '20px 0 12px' }}>Endereço</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <F label="CEP" v={form.cep || ''} onChange={(v) => set('cep', v)} />
        <F label="Logradouro" v={form.logradouro || ''} onChange={(v) => set('logradouro', v)} />
        <F label="Número" v={form.numero || ''} onChange={(v) => set('numero', v)} />
        <F label="Complemento" v={form.complemento || ''} onChange={(v) => set('complemento', v)} />
        <F label="Bairro" v={form.bairro || ''} onChange={(v) => set('bairro', v)} />
        <F label="Cidade" v={form.cidade || ''} onChange={(v) => set('cidade', v)} />
        <F label="UF" v={form.uf || ''} onChange={(v) => set('uf', v)} />
      </div>

      <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: '20px 0 12px' }}>Contrato</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <F label="Matrícula" v={form.matricula || ''} onChange={(v) => set('matricula', v)} />
        <F label="Cargo" v={form.cargo || ''} onChange={(v) => set('cargo', v)} />
        <F label="Setor" v={form.setor || ''} onChange={(v) => set('setor', v)} />
        <F label="Função" v={form.funcao || ''} onChange={(v) => set('funcao', v)} />
        <F label="Data admissão" v={form.data_admissao || ''} onChange={(v) => set('data_admissao', v)} type="date" />
        <F label="Data demissão" v={form.data_demissao || ''} onChange={(v) => set('data_demissao', v)} type="date" />
        <F label="Tipo contrato" v={form.tipo_contrato || ''} onChange={(v) => set('tipo_contrato', v)} />
        <F label="Salário base (R$)" v={form.salario_base ?? ''} onChange={(v) => set('salario_base', v === '' ? null : Number(v))} type="number" />
      </div>

      <h3 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 500, margin: '20px 0 12px' }}>Alocação</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <F label="Empresa tomadora" v={form.empresa_tomadora_nome || ''} onChange={(v) => set('empresa_tomadora_nome', v)} />
        <F label="Obra" v={form.obra_nome || ''} onChange={(v) => set('obra_nome', v)} />
      </div>

      <div style={{ marginTop: 12 }}>
        <F label="Observações" v={form.observacoes || ''} onChange={(v) => set('observacoes', v)} textarea />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <button
          onClick={salvar}
          disabled={salvando}
          style={{ padding: '10px 18px', borderRadius: 8, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 13, fontWeight: 600, cursor: salvando ? 'not-allowed' : 'pointer', opacity: salvando ? 0.6 : 1 }}
        >
          {salvando ? 'Salvando…' : 'Salvar alterações'}
        </button>
      </div>
    </section>
  )
}

function AbaDocumentos({
  loading, matriz, onUpload, onBaixar,
}: {
  loading: boolean
  matriz: Matriz[]
  onUpload: (m: Matriz, modo: 'upload' | 'substituir') => void
  onBaixar: (documentoId: string) => void
}) {
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
            {loading && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Carregando…</td></tr>)}
            {!loading && matriz.length === 0 && (<tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: C.muted }}>Nenhum tipo de documento configurado</td></tr>)}
            {matriz.map((m, i) => {
              const temDoc = !!m.documento_id
              return (
                <tr key={m.tipo_documento_id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}` }}>
                  <Td>
                    <div style={{ fontWeight: 600 }}>{m.tipo_nome}</div>
                    {m.obrigatorio && <div style={{ fontSize: 10, color: C.red, marginTop: 2, fontWeight: 600 }}>OBRIGATÓRIO</div>}
                  </Td>
                  <Td>{m.tipo_grupo || '—'}</Td>
                  <Td><StatusBadge status={m.status_final} /></Td>
                  <Td mono>
                    {m.data_validade || '—'}
                    {m.dias_para_vencer != null && m.status_final === 'vencendo' && (
                      <div style={{ fontSize: 11, color: C.amber, marginTop: 2 }}>em {m.dias_para_vencer}d</div>
                    )}
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!temDoc ? (
                        <button onClick={() => onUpload(m, 'upload')} style={btnPrim()}>Upload</button>
                      ) : (
                        <>
                          <button onClick={() => onUpload(m, 'substituir')} style={btnPrim()}>Substituir</button>
                          <button onClick={() => onBaixar(m.documento_id!)} style={btnSec()}>Baixar</button>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
              <Th>Status</Th>
              <Th>Ativo</Th>
              <Th>Ações</Th>
            </tr>
          </thead>
          <tbody>
            {historico.map((d, i) => (
              <tr key={d.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.borderLt}`, opacity: d.ativo ? 1 : 0.55 }}>
                <Td mono>{new Date(d.uploaded_at).toLocaleString('pt-BR')}</Td>
                <Td mono>v{d.versao}</Td>
                <Td>{d.arquivo_nome_original}</Td>
                <Td mono>{d.data_emissao || '—'}</Td>
                <Td mono>{d.data_validade || '—'}</Td>
                <Td><StatusBadge status={d.status_validade} /></Td>
                <Td>{d.ativo ? 'Sim' : 'Substituído'}</Td>
                <Td><button onClick={() => onBaixar(d.id)} style={btnSec()}>Baixar</button></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function F({ label, v, onChange, type, textarea }: { label: string; v: any; onChange: (v: any) => void; type?: string; textarea?: boolean }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</label>
      {textarea ? (
        <textarea value={v} onChange={(e: any) => onChange(e.target.value)} style={{ ...inputStyle(), minHeight: 70 }} />
      ) : (
        <input type={type || 'text'} value={v ?? ''} onChange={(e: any) => onChange(e.target.value)} style={inputStyle()} />
      )}
    </div>
  )
}

function inputStyle() {
  return { width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.borderLt}`, fontSize: 14, background: C.offwhite, color: C.ink, boxSizing: 'border-box', fontFamily: 'inherit' } as any
}
function btnPrim() { return { padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: C.espresso, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' } as any }
function btnSec() { return { padding: '6px 12px', borderRadius: 6, border: `1px solid ${C.borderLt}`, backgroundColor: 'white', color: C.espresso, fontSize: 12, fontWeight: 600, cursor: 'pointer' } as any }
function Th({ children }: { children: any }) { return (<th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(61, 35, 20, 0.65)' }}>{children}</th>) }
function Td({ children, mono }: { children: any; mono?: boolean }) { return (<td style={{ padding: '10px 16px', verticalAlign: 'top', fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : undefined }}>{children}</td>) }
