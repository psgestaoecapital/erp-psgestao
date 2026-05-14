// src/app/dashboard/compliance/whatsapp-epi/page.tsx
// Bot WhatsApp Assinatura EPI — Onda 1 feature 2/4
// Tela admin: seleciona funcionario + EPIs e gera link wa.me com URL
// /sign/epi/{token} para o funcionario assinar pelo celular.
//
// Backend ja em producao:
// - fn_compliance_epi_gerar_link_whatsapp
// - compliance_epi_assinatura_tokens (tabela com RLS multi-tenant)
//
// Padrao visual copiado de /dashboard/compliance/epi/alertas: Client Component
// + useCompanyIds multi-tenant + paleta Estrela Polar inline. Lei 14.063/2020.

'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = {
  espresso: '#3D2314',
  espressoLt: '#5D4534',
  espressoM: '#6B5D4F',
  espressoL: '#9C8E80',
  offwhite: '#FAF7F2',
  cream: '#F0ECE3',
  gold: '#C8941A',
  borderLt: '#E0D8CC',
  ink: '#1A1A1A',
  muted: 'rgba(61, 35, 20, 0.55)',
  green: '#16A34A',
  greenSoft: '#DCFCE7',
  amber: '#EAB308',
  red: '#DC2626',
  whatsapp: '#25D366',
}

interface Funcionario {
  id: string
  nome_completo: string
  cpf: string | null
  telefone: string | null
  cargo: string | null
}

interface EpiCatalogo {
  id: string
  nome: string
  ca_numero: string | null
  is_global: boolean
}

interface TokenHistorico {
  id: string
  funcionario_id: string
  funcionario_nome?: string
  catalogo_ids: string[]
  status: string
  whatsapp_telefone: string | null
  expires_at: string
  visualizado_em: string | null
  assinado_em: string | null
  created_at: string
}

interface GerarResult {
  token: string
  url_assinatura: string
  whatsapp_link: string
  whatsapp_mensagem: string
  expires_at: string
  funcionario_nome: string
  funcionario_telefone: string | null
  qtd_epis: number
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pendente: { label: 'Pendente', color: C.amber },
  visualizado: { label: 'Visualizado', color: '#3B82F6' },
  assinado: { label: 'Assinado', color: C.green },
  expirado: { label: 'Expirado', color: C.red },
  cancelado: { label: 'Cancelado', color: C.espressoL },
}

const fmtData = (s: string | null | undefined): string => {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return s }
}

const diasAte = (s: string): number => {
  try {
    const diff = new Date(s).getTime() - Date.now()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  } catch { return 0 }
}

export default function WhatsAppEpiPage() {
  const { companyIds, sel, selInfo, companies, loading: loadingCompanies } = useCompanyIds()
  const companyIdUnico = useMemo(
    () => (selInfo.tipo === 'empresa' && sel ? sel : companyIds[0] ?? null),
    [selInfo, sel, companyIds],
  )

  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([])
  const [catalogo, setCatalogo] = useState<EpiCatalogo[]>([])
  const [historico, setHistorico] = useState<TokenHistorico[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [funcId, setFuncId] = useState('')
  const [epiIds, setEpiIds] = useState<Record<string, number>>({})
  const [observacao, setObservacao] = useState('')
  const [gerando, setGerando] = useState(false)
  const [resultado, setResultado] = useState<GerarResult | null>(null)
  const [copiado, setCopiado] = useState(false)

  const carregar = useCallback(async () => {
    if (!companyIdUnico) return
    setLoading(true)
    setErro(null)
    try {
      const [funcs, cats, hist] = await Promise.all([
        supabase
          .from('compliance_funcionarios')
          .select('id, nome_completo, cpf, telefone, cargo')
          .eq('company_id', companyIdUnico)
          .eq('ativo', true)
          .order('nome_completo'),
        supabase
          .from('epi_catalogo')
          .select('id, nome, ca_numero, is_global, company_id')
          .or(`company_id.eq.${companyIdUnico},is_global.eq.true`)
          .eq('ativo', true)
          .order('nome'),
        supabase
          .from('compliance_epi_assinatura_tokens')
          .select('id, funcionario_id, catalogo_ids, status, whatsapp_telefone, expires_at, visualizado_em, assinado_em, created_at')
          .eq('company_id', companyIdUnico)
          .order('created_at', { ascending: false })
          .limit(50),
      ])
      if (funcs.error) throw funcs.error
      if (cats.error) throw cats.error
      if (hist.error) throw hist.error
      setFuncionarios((funcs.data ?? []) as Funcionario[])
      setCatalogo((cats.data ?? []) as EpiCatalogo[])
      // enriquecer historico com nome do funcionario
      const funcsMap = new Map((funcs.data ?? []).map((f: any) => [f.id, f.nome_completo]))
      setHistorico(
        ((hist.data ?? []) as TokenHistorico[]).map((h) => ({
          ...h,
          funcionario_nome: funcsMap.get(h.funcionario_id) || '—',
        })),
      )
    } catch (e: any) {
      setErro(e?.message || 'Falha ao carregar dados')
    } finally {
      setLoading(false)
    }
  }, [companyIdUnico])

  useEffect(() => { carregar() }, [carregar])

  const funcSel = funcionarios.find((f) => f.id === funcId)
  const epiCount = Object.keys(epiIds).length
  const podeGerar = !!funcId && epiCount > 0 && !!funcSel?.telefone && !gerando

  function toggleEpi(id: string) {
    setEpiIds((prev) => {
      const next = { ...prev }
      if (id in next) delete next[id]
      else next[id] = 1
      return next
    })
  }
  function setEpiQtd(id: string, qtd: number) {
    setEpiIds((prev) => ({ ...prev, [id]: Math.max(1, qtd) }))
  }

  async function gerarLink() {
    if (!companyIdUnico || !funcId || epiCount === 0) return
    setGerando(true)
    setErro(null)
    setResultado(null)
    setCopiado(false)
    try {
      const ids = Object.keys(epiIds)
      const qtds = ids.map((id) => epiIds[id])
      const { data, error } = await supabase.rpc('fn_compliance_epi_gerar_link_whatsapp', {
        p_company_id: companyIdUnico,
        p_funcionario_id: funcId,
        p_catalogo_ids: ids,
        p_quantidades: qtds,
        p_movimentacao_id: null,
        p_observacao: observacao || null,
      })
      if (error) throw error
      const r = (Array.isArray(data) ? data[0] : data) as GerarResult
      if (!r) throw new Error('RPC nao retornou dados')
      setResultado(r)
      // limpa form, mas mantem ate o user confirmar
      await carregar()
    } catch (e: any) {
      setErro(e?.message || 'Falha ao gerar link')
    } finally {
      setGerando(false)
    }
  }

  async function copiarUrl() {
    if (!resultado?.url_assinatura) return
    try {
      await navigator.clipboard.writeText(resultado.url_assinatura)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2500)
    } catch {
      setErro('Falha ao copiar — navegador bloqueou')
    }
  }

  function novoLink() {
    setResultado(null)
    setFuncId('')
    setEpiIds({})
    setObservacao('')
  }

  if (loadingCompanies) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>Carregando empresas…</div>
  }
  if (!companyIdUnico) {
    return (
      <div style={{ padding: 'clamp(16px, 4vw, 32px)', maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: C.espressoM }}>
          Selecione uma empresa no topo para usar o Bot WhatsApp EPI.
        </p>
      </div>
    )
  }

  const sectionCard: React.CSSProperties = {
    background: '#FFFFFF',
    borderRadius: 12,
    padding: 18,
    boxShadow: '0 1px 3px rgba(61,35,20,0.06)',
    marginBottom: 16,
  }

  return (
    <div style={{ background: C.offwhite, minHeight: '100vh', color: C.ink }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(16px, 4vw, 32px)' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1.5, textTransform: 'uppercase', opacity: 0.5, margin: 0 }}>COMPLIANCE · EPI</p>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 32, fontWeight: 400, margin: '4px 0 6px' }}>Bot WhatsApp EPI</h1>
            <p style={{ margin: 0, fontSize: 13, color: C.muted }}>Assinatura digital com valor jurídico (Lei 14.063/2020)</p>
          </div>
          <Link href="/dashboard/compliance/epi" style={btnSec}>← EPI</Link>
        </header>

        {erro && (
          <div style={{ background: '#FEE2E2', color: '#991B1B', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 13, borderLeft: `4px solid ${C.red}` }}>{erro}</div>
        )}

        {/* Resultado gerado */}
        {resultado && (
          <section
            style={{
              ...sectionCard,
              border: `2px solid ${C.green}`,
              background: C.greenSoft + '60',
              marginBottom: 24,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
              ✓ Link gerado para {resultado.funcionario_nome}
            </div>
            <p style={{ margin: '4px 0 14px', fontSize: 13, color: C.espressoLt }}>
              Telefone <strong>{resultado.funcionario_telefone || '—'}</strong> · {resultado.qtd_epis} EPI(s) · Expira em <strong>{diasAte(resultado.expires_at)}d</strong>
            </p>
            <pre style={{ background: '#FFFFFF', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 12, fontSize: 12, color: C.espresso, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '0 0 14px' }}>
              {resultado.whatsapp_mensagem}
            </pre>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a
                href={resultado.whatsapp_link}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...btnPri, background: C.whatsapp, minHeight: 44 }}
              >
                💬 Abrir WhatsApp
              </a>
              <button onClick={copiarUrl} style={{ ...btnSec, minHeight: 44 }}>
                {copiado ? '✓ Copiado!' : '📋 Copiar URL'}
              </button>
              <button onClick={novoLink} style={{ ...btnSec, minHeight: 44 }}>Novo link</button>
            </div>
          </section>
        )}

        {/* Form Nova Entrega */}
        {!resultado && (
          <section style={sectionCard}>
            <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.espressoL, margin: '0 0 14px' }}>
              Nova entrega
            </h2>
            <label style={labelStyle}>Funcionário</label>
            <select value={funcId} onChange={(e) => setFuncId(e.target.value)} style={inputStyle}>
              <option value="">— selecione —</option>
              {funcionarios.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome_completo}
                  {f.cargo ? ` · ${f.cargo}` : ''}
                  {!f.telefone ? ' (sem WhatsApp)' : ''}
                </option>
              ))}
            </select>
            {funcSel && !funcSel.telefone && (
              <div style={{ background: '#FEF3C7', color: '#92400E', padding: 10, borderRadius: 6, fontSize: 12, marginTop: 8, borderLeft: `3px solid ${C.amber}` }}>
                ⚠ Funcionário sem WhatsApp cadastrado. <Link href="/dashboard/compliance/funcionarios" style={{ color: '#92400E', textDecoration: 'underline' }}>Cadastrar agora →</Link>
              </div>
            )}

            <label style={{ ...labelStyle, marginTop: 16 }}>EPIs a entregar ({epiCount} selecionado{epiCount === 1 ? '' : 's'})</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto', border: `1px solid ${C.borderLt}`, borderRadius: 8, padding: 8 }}>
              {catalogo.length === 0 ? (
                <p style={{ margin: 0, fontSize: 12, color: C.muted, fontStyle: 'italic' }}>Nenhum EPI no catálogo. <Link href="/dashboard/compliance/epi/catalogo">Cadastrar →</Link></p>
              ) : (
                catalogo.map((c) => {
                  const sel = c.id in epiIds
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderRadius: 6, background: sel ? C.cream : 'transparent' }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleEpi(c.id)} style={{ width: 16, height: 16, accentColor: C.gold }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, color: C.espresso, fontWeight: 500 }}>{c.nome}</div>
                        <div style={{ fontSize: 10, color: C.muted }}>{c.ca_numero ? `CA ${c.ca_numero}` : 'sem CA'}{c.is_global ? ' · global' : ''}</div>
                      </div>
                      {sel && (
                        <input
                          type="number"
                          min={1}
                          value={epiIds[c.id]}
                          onChange={(e) => setEpiQtd(c.id, parseInt(e.target.value) || 1)}
                          style={{ width: 64, padding: '4px 6px', borderRadius: 6, border: `1px solid ${C.borderLt}`, fontSize: 12, textAlign: 'center' }}
                        />
                      )}
                    </div>
                  )
                })
              )}
            </div>

            <label style={{ ...labelStyle, marginTop: 16 }}>Observação (opcional)</label>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              placeholder="Ex: troca preventiva semestral"
              style={{ ...inputStyle, resize: 'vertical' }}
            />

            <button onClick={gerarLink} disabled={!podeGerar} style={{ ...btnPri, marginTop: 16, width: '100%', minHeight: 48, opacity: podeGerar ? 1 : 0.5, cursor: podeGerar ? 'pointer' : 'not-allowed' }}>
              {gerando ? '⏳ Gerando…' : '💬 Gerar link WhatsApp'}
            </button>
          </section>
        )}

        {/* Histórico */}
        <section style={sectionCard}>
          <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: C.espressoL, margin: '0 0 14px' }}>
            Histórico de tokens
          </h2>
          {loading ? (
            <p style={{ color: C.muted, fontSize: 13 }}>Carregando…</p>
          ) : historico.length === 0 ? (
            <p style={{ color: C.espressoL, fontSize: 13, fontStyle: 'italic' }}>Nenhum link gerado ainda.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.cream, textAlign: 'left' }}>
                    <th style={th}>Funcionário</th>
                    <th style={th}>EPIs</th>
                    <th style={th}>Status</th>
                    <th style={th}>Criado</th>
                    <th style={th}>Expira</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.map((h) => {
                    const s = STATUS_LABEL[h.status] || { label: h.status, color: C.espressoL }
                    return (
                      <tr key={h.id} style={{ borderTop: `1px solid ${C.borderLt}` }}>
                        <td style={td}>{h.funcionario_nome}</td>
                        <td style={td}>{h.catalogo_ids?.length ?? 0}</td>
                        <td style={td}>
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: s.color + '22', color: s.color, fontWeight: 700, textTransform: 'uppercase' }}>
                            {s.label}
                          </span>
                        </td>
                        <td style={td}>{fmtData(h.created_at)}</td>
                        <td style={td}>{fmtData(h.expires_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 600, color: C.espressoLt, letterSpacing: 0.5, marginBottom: 6, textTransform: 'uppercase' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', background: '#FAF7F2', border: `1px solid ${C.borderLt}`, borderRadius: 8, fontSize: 13, color: C.ink, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }
const th: React.CSSProperties = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.espressoLt, textTransform: 'uppercase', letterSpacing: 0.5 }
const td: React.CSSProperties = { padding: '10px', color: C.espresso }
const btnSec: React.CSSProperties = { padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.borderLt}`, background: '#FFFFFF', color: C.espresso, fontSize: 12, fontWeight: 600, textDecoration: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const btnPri: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: 'none', background: C.gold, color: '#FFFFFF', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }
