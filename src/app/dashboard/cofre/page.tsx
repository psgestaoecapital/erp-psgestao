'use client'

// Cofre de Credenciais (B.9) · RD-41 Pilar 2
// - Rota SO admin (users.role IN ('adm','acesso_total')). Nao-admin -> tela vazia.
// - Lista via fn_credencial_listar (RPC gate SECURITY DEFINER). Metadados apenas.
// - CRUD via fn_credencial_salvar (upsert) / fn_credencial_inativar.
// - Revelar valor via fn_credencial_revelar (registra revelado_ultima_vez_por/em).
// - Valor NUNCA em GET; so via clique Revelar (log + expiracao 30s no display).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Lock, Eye, EyeOff, Plus, Save, Trash2, ShieldAlert, Copy } from 'lucide-react'

type Escopo = 'global' | 'empresa'
type Credencial = {
  id: string
  provider: string
  chave: string
  escopo: Escopo
  company_id: string | null
  label: string | null
  tem_valor: boolean
  atualizado_em: string | null
  revelado_ultima_vez_por: string | null
  revelado_ultima_vez_em: string | null
}
type Empresa = { id: string; nome: string }

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

const PROVIDERS_SUGERIDOS = [
  'aps','iopoint','focus','brapi','pluggy','anthropic','supabase',
  'banco_sicoob_prod','banco_sicoob_homolog','banco_bradesco_prod',
  'auditor_gold',
]

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR')
}

export default function CofrePage() {
  const [permitido, setPermitido] = useState<boolean | null>(null)
  const [creds, setCreds] = useState<Credencial[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editando, setEditando] = useState<Partial<Credencial> & { valor?: string } | null>(null)
  const [reveladoValor, setReveladoValor] = useState<{ id: string; valor: string; expira: number } | null>(null)

  // 1) Gate client-side: valida se usuario e admin. Se nao, mostra tela vazia.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setPermitido(false); return }
      const { data: u } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
      const role = (u as { role?: string } | null)?.role
      setPermitido(role === 'adm' || role === 'acesso_total')
    })()
  }, [])

  // 2) Empresas para picker de escopo=empresa
  useEffect(() => {
    if (!permitido) return
    supabase
      .from('companies').select('id, nome_fantasia, razao_social').order('nome_fantasia')
      .then(({ data }) => {
        const list = ((data as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> ) ?? [])
          .map((c) => ({ id: c.id, nome: c.nome_fantasia ?? c.razao_social ?? c.id.slice(0, 8) }))
        setEmpresas(list)
      })
  }, [permitido])

  const recarregar = useCallback(async () => {
    if (!permitido) return
    setBusy(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_listar')
      if (error) throw error
      setCreds((data as Credencial[]) ?? [])
    } catch (e) { setErro((e as Error).message) }
    finally { setBusy(false) }
  }, [permitido])

  useEffect(() => { recarregar() }, [recarregar])

  // Expira valor revelado apos 30s.
  useEffect(() => {
    if (!reveladoValor) return
    const t = setInterval(() => {
      if (Date.now() > reveladoValor.expira) setReveladoValor(null)
    }, 1000)
    return () => clearInterval(t)
  }, [reveladoValor])

  const revelar = async (c: Credencial) => {
    if (!confirm(`Revelar valor de ${c.provider}/${c.chave}?\nEsta acao FICA REGISTRADA (voce como quem revelou).`)) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_revelar', { p_id: c.id })
      if (error) throw error
      setReveladoValor({ id: c.id, valor: String(data ?? ''), expira: Date.now() + 30_000 })
      setMsg('Valor revelado — expira em 30s. Acesso registrado.')
      await recarregar()
    } catch (e) { setErro((e as Error).message) }
    finally { setBusy(false) }
  }

  const salvar = async () => {
    if (!editando) return
    const { provider, chave, escopo = 'global', company_id, valor, label } = editando
    if (!provider || !chave || !valor) { setErro('provider, chave e valor sao obrigatorios'); return }
    if (escopo === 'empresa' && !company_id) { setErro('escopo=empresa exige selecionar uma empresa'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_salvar', {
        p_provider: provider, p_chave: chave, p_valor: valor,
        p_escopo: escopo, p_company_id: company_id ?? null,
        p_label: label ?? null, p_nome_vault_override: null,
      })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; nome_vault?: string } | null
      if (!j?.sucesso) throw new Error(j?.erro ?? 'falha ao salvar')
      setMsg(`ALTEROU ${provider}/${chave} (${j.nome_vault})`)
      setEditando(null)
      await recarregar()
    } catch (e) { setErro((e as Error).message) }
    finally { setBusy(false) }
  }

  const inativar = async (c: Credencial) => {
    if (!confirm(`Inativar ${c.provider}/${c.chave}?\nO secret no Vault NAO e apagado (mantido para auditoria).`)) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { error } = await supabase.rpc('fn_credencial_inativar', { p_id: c.id })
      if (error) throw error
      setMsg(`INATIVOU ${c.provider}/${c.chave}`)
      await recarregar()
    } catch (e) { setErro((e as Error).message) }
    finally { setBusy(false) }
  }

  const nomeEmpresa = useMemo(() => {
    const m = new Map<string, string>()
    empresas.forEach((e) => m.set(e.id, e.nome))
    return (id: string | null) => (id ? m.get(id) ?? id.slice(0, 8) : '—')
  }, [empresas])

  if (permitido === null) {
    return <div style={{ minHeight: '100vh', background: BG, padding: 32, color: ESP60 }}>Verificando permissão...</div>
  }
  if (permitido === false) {
    return (
      <div style={{ minHeight: '100vh', background: BG, padding: 32 }}>
        <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', color: ESP }}>
          <ShieldAlert size={40} style={{ margin: '0 auto', color: '#DC2626' }} />
          <h1 style={{ fontSize: 20, marginTop: 12, fontFamily: 'ui-serif,Georgia,serif' }}>Acesso restrito</h1>
          <p style={{ fontSize: 13, color: ESP60, marginTop: 6 }}>
            O Cofre de Credenciais é acessível apenas para administradores.
          </p>
        </div>
      </div>
    )
  }

  const btn: React.CSSProperties = {
    background: GOLD, color: '#fff', border: 'none', padding: '8px 14px',
    borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  }
  const btnGhost: React.CSSProperties = {
    background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`,
    padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  }
  const inp: React.CSSProperties = {
    width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`,
    borderRadius: 6, fontSize: 13, background: '#fff', color: ESP,
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 20px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: GOLD }}>
              Cofre · RD-41 Pilar 2
            </div>
            <h1 style={{ fontSize: 24, color: ESP, margin: '4px 0 0', fontFamily: 'ui-serif,Georgia,serif' }}>
              <Lock size={20} style={{ display: 'inline', marginRight: 8, verticalAlign: '-3px' }} />
              Cofre de Credenciais
            </h1>
            <div style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>
              Cadastre segredos de API dos providers. Valor é cifrado no Vault; aqui só metadados.
            </div>
          </div>
          <button type="button" onClick={() => setEditando({ escopo: 'global' })} style={btn}>
            <Plus size={14} style={{ verticalAlign: '-2px' }} /> Nova credencial
          </button>
        </header>

        {msg && <div style={{ background: '#DCFCE7', color: '#166534', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{msg}</div>}
        {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{erro}</div>}

        <div style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: BG, borderBottom: `0.5px solid ${LINE}` }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Provider</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Chave</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Escopo</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Rótulo</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Status</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Atualizado</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {busy && creds.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: ESP60 }}>Carregando...</td></tr>
              )}
              {!busy && creds.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: ESP60 }}>Nenhuma credencial cadastrada.</td></tr>
              )}
              {creds.map((c) => (
                <tr key={c.id} style={{ borderTop: `0.5px solid ${LINE}` }}>
                  <td style={{ padding: '10px 12px' }}><b style={{ color: ESP }}>{c.provider}</b></td>
                  <td style={{ padding: '10px 12px', color: ESP }}>{c.chave}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: BG, color: ESP60 }}>
                      {c.escopo}{c.escopo === 'empresa' && c.company_id ? ` · ${nomeEmpresa(c.company_id)}` : ''}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: ESP60, fontSize: 11 }}>{c.label ?? '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {c.tem_valor ? (
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontWeight: 700 }}>
                        VAULT OK
                      </span>
                    ) : (
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#FEF3C7', color: '#7A5A0F', fontWeight: 700 }}>
                        PENDENTE
                      </span>
                    )}
                    {c.revelado_ultima_vez_em && (
                      <div style={{ fontSize: 9, color: ESP60, marginTop: 3 }}>
                        última revelação: {fmtDate(c.revelado_ultima_vez_em)}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 12px', color: ESP60, fontSize: 11 }}>{fmtDate(c.atualizado_em)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      {reveladoValor?.id === c.id ? (
                        <button
                          type="button"
                          onClick={() => { navigator.clipboard.writeText(reveladoValor.valor); setMsg('Valor copiado para o clipboard.') }}
                          style={{ ...btnGhost, background: '#FEF3C7', borderColor: GOLD, fontFamily: 'monospace', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title="Clique para copiar. Some em 30s."
                        >
                          <Copy size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                          {reveladoValor.valor.length > 32 ? `${reveladoValor.valor.slice(0, 12)}...${reveladoValor.valor.slice(-8)}` : reveladoValor.valor}
                        </button>
                      ) : (
                        <button type="button" onClick={() => revelar(c)} disabled={busy || !c.tem_valor} style={btnGhost}>
                          <Eye size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                          Revelar
                        </button>
                      )}
                      <button type="button" onClick={() => setEditando({ ...c, valor: '' })} disabled={busy} style={btnGhost}>
                        Editar
                      </button>
                      <button type="button" onClick={() => inativar(c)} disabled={busy} style={{ ...btnGhost, color: '#DC2626', borderColor: '#FCA5A5' }}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editando && (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setEditando(null)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 16, zIndex: 1000,
            }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{
              background: BG, borderRadius: 12, maxWidth: 520, width: '100%',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}>
              <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}` }}>
                <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>
                  {editando.id ? 'Editar' : 'Nova'} credencial
                </div>
                <div style={{ fontSize: 16, color: ESP, fontWeight: 600, marginTop: 4 }}>
                  {editando.provider ? `${editando.provider}/${editando.chave ?? ''}` : 'Nova credencial'}
                </div>
              </div>
              <div style={{ padding: 20, display: 'grid', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Provider</label>
                  <input
                    list="providers-sugeridos"
                    value={editando.provider ?? ''}
                    disabled={!!editando.id}
                    onChange={(e) => setEditando({ ...editando, provider: e.target.value.toLowerCase() })}
                    placeholder="ex.: aps"
                    style={inp}
                  />
                  <datalist id="providers-sugeridos">
                    {PROVIDERS_SUGERIDOS.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Chave</label>
                  <input
                    value={editando.chave ?? ''}
                    disabled={!!editando.id}
                    onChange={(e) => setEditando({ ...editando, chave: e.target.value.toLowerCase() })}
                    placeholder="ex.: client_id"
                    style={inp}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Escopo</label>
                    <select
                      value={editando.escopo ?? 'global'}
                      disabled={!!editando.id}
                      onChange={(e) => setEditando({ ...editando, escopo: e.target.value as Escopo })}
                      style={inp}
                    >
                      <option value="global">global</option>
                      <option value="empresa">empresa</option>
                    </select>
                  </div>
                  {editando.escopo === 'empresa' && (
                    <div>
                      <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Empresa</label>
                      <select
                        value={editando.company_id ?? ''}
                        disabled={!!editando.id}
                        onChange={(e) => setEditando({ ...editando, company_id: e.target.value || null })}
                        style={inp}
                      >
                        <option value="">— selecione —</option>
                        {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Rótulo (opcional)</label>
                  <input
                    value={editando.label ?? ''}
                    onChange={(e) => setEditando({ ...editando, label: e.target.value })}
                    placeholder="ex.: Autodesk APS produção"
                    style={inp}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>
                    Valor (secret) · <EyeOff size={10} style={{ verticalAlign: '-1px' }} /> mascarado ao digitar
                  </label>
                  <input
                    type="password"
                    autoComplete="off"
                    value={editando.valor ?? ''}
                    onChange={(e) => setEditando({ ...editando, valor: e.target.value })}
                    placeholder={editando.id ? 'novo valor (deixa vazio p/ manter atual)' : ''}
                    style={inp}
                  />
                  {editando.id && !editando.valor && (
                    <div style={{ fontSize: 10, color: ESP60, marginTop: 4 }}>
                      Sem valor novo — cancele ou informe para reescrever.
                    </div>
                  )}
                </div>
              </div>
              <div style={{ padding: '12px 20px', borderTop: `0.5px solid ${LINE}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setEditando(null)} style={btnGhost} disabled={busy}>Cancelar</button>
                <button type="button" onClick={salvar} disabled={busy} style={btn}>
                  <Save size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  {editando.id ? 'Atualizar' : 'Cadastrar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
