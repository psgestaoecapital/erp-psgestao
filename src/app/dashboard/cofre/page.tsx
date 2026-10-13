'use client'

// Cofre de Credenciais V2 · RD-41 Pilar 2 (Segurança + LGPD) · Saneamento F3
// - Acesso: fn_cofre_pode_acessar() (RPC = FONTE ÚNICA de verdade com o backend).
//   PS_ADMIN/PS_ADMIN_CVM, NÃO robô, ATIVO. Robô (Playwright/Gold) NUNCA entra.
// - Duas abas: Sistemas (login/senha de sistemas contratados) e Técnicas (tokens/certs).
// - Sistemas via fn_credencial_salvar_sistema. Técnicas via fn_credencial_salvar (como antes).
// - Revelar via fn_credencial_revelar (registra na trilha erp_credencial_revelacao).
// - Trilha completa via fn_credencial_revelacoes. Valor NUNCA em GET; só no clique Revelar.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Lock, Eye, Plus, Save, Trash2, ShieldAlert, Copy, ExternalLink, History, X } from 'lucide-react'

type Escopo = 'global' | 'empresa'
type Tipo = 'sistema' | 'tecnica'
type Credencial = {
  id: string
  provider: string
  chave: string
  escopo: Escopo
  company_id: string | null
  label: string | null
  tipo: Tipo
  url_login: string | null
  observacao: string | null
  tem_valor: boolean
  revelacoes_total: number
  atualizado_em: string | null
  revelado_ultima_vez_por: string | null
  revelado_ultima_vez_em: string | null
}
type Empresa = { id: string; nome: string }
type Sistema = {
  chaveGrupo: string
  provider: string
  escopo: Escopo
  company_id: string | null
  url_login: string | null
  observacao: string | null
  usuario: Credencial | null
  senha: Credencial | null
}
type RevelacaoLinha = { revelado_em: string; revelador_email: string | null }

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

// Técnicas contratadas pela PS que aparecem no Cofre (diretriz CEO 05/07 v2).
// Bancos e IO Point NÃO entram (vão em Conexões Bancárias / Conectores). A whitelist
// vale SÓ para a aba Técnicas — a aba Sistemas mostra TODOS os sistemas cadastrados.
const PROVIDERS_COFRE = ['anthropic', 'aps', 'auditor_gold', 'brapi', 'pluggy', 'supabase', 'focus']
const PROVIDERS_TECNICA_SUGERIDOS = [
  'aps', 'iopoint', 'focus', 'brapi', 'pluggy', 'anthropic', 'supabase', 'auditor_gold',
]
const SISTEMAS_SUGERIDOS = [
  'resend', 'registro.br', 'vercel', 'focus', 'omie', 'supabase', 'cloudflare', 'google_workspace',
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
  const [aba, setAba] = useState<Tipo>('sistema')
  // edição de credencial técnica (fluxo antigo)
  const [editando, setEditando] = useState<(Partial<Credencial> & { valor?: string }) | null>(null)
  // cadastro de sistema (fluxo novo)
  const [novoSistema, setNovoSistema] = useState<{
    sistema: string; url_login: string; usuario: string; senha: string; observacao: string
  } | null>(null)
  const [reveladoValor, setReveladoValor] = useState<{ id: string; valor: string; expira: number } | null>(null)
  const [historico, setHistorico] = useState<{ cred: Credencial; linhas: RevelacaoLinha[] } | null>(null)

  // 1) Gate: fonte única = fn_cofre_pode_acessar() (mesma regra do backend). Sem duplicar lógica.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('fn_cofre_pode_acessar')
      if (error) { setPermitido(false); return }
      setPermitido(!!data)
    })()
  }, [])

  // 2) Empresas para o picker de escopo=empresa
  useEffect(() => {
    if (!permitido) return
    supabase
      .from('companies').select('id, nome_fantasia, razao_social').order('nome_fantasia')
      .then(({ data }) => {
        const list = ((data as Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }>) ?? [])
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
    } catch (e) {
      const m = (e as Error).message
      setErro(m === 'sem_acesso_ao_cofre' ? 'Você não tem acesso ao Cofre de Credenciais.' : m)
    } finally { setBusy(false) }
  }, [permitido])

  useEffect(() => { recarregar() }, [recarregar])

  // valor revelado expira em 30s
  useEffect(() => {
    if (!reveladoValor) return
    const t = setInterval(() => { if (Date.now() > reveladoValor.expira) setReveladoValor(null) }, 1000)
    return () => clearInterval(t)
  }, [reveladoValor])

  const nomeEmpresa = useMemo(() => {
    const m = new Map<string, string>()
    empresas.forEach((e) => m.set(e.id, e.nome))
    return (id: string | null) => (id ? m.get(id) ?? id.slice(0, 8) : '—')
  }, [empresas])

  // Sistemas = tipo='sistema', agrupados por provider+escopo+empresa (usuario + senha viram 1 card).
  const sistemas: Sistema[] = useMemo(() => {
    const grupos = new Map<string, Sistema>()
    for (const c of creds.filter((x) => x.tipo === 'sistema')) {
      const k = `${c.provider}|${c.escopo}|${c.company_id ?? ''}`
      const g = grupos.get(k) ?? {
        chaveGrupo: k, provider: c.provider, escopo: c.escopo, company_id: c.company_id,
        url_login: c.url_login, observacao: c.observacao, usuario: null, senha: null,
      }
      if (c.chave === 'usuario') g.usuario = c
      else if (c.chave === 'senha') g.senha = c
      g.url_login = g.url_login ?? c.url_login
      g.observacao = g.observacao ?? c.observacao
      grupos.set(k, g)
    }
    return Array.from(grupos.values()).sort((a, b) => a.provider.localeCompare(b.provider))
  }, [creds])

  // Técnicas = tipo='tecnica' filtradas pela whitelist do Cofre (05/07).
  const tecnicas = useMemo(
    () => creds.filter((c) => c.tipo === 'tecnica' && PROVIDERS_COFRE.includes(c.provider)),
    [creds],
  )

  const revelar = async (c: Credencial, rotulo: string) => {
    if (!confirm(`Revelar ${rotulo} de ${c.provider}?\nEsta ação FICA REGISTRADA na trilha (você como quem revelou).`)) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_revelar', { p_id: c.id })
      if (error) throw error
      setReveladoValor({ id: c.id, valor: String(data ?? ''), expira: Date.now() + 30_000 })
      setMsg('REVELOU — o valor some em 30s. Acesso registrado na trilha.')
      await recarregar()
    } catch (e) {
      const m = (e as Error).message
      setErro(m === 'sem_acesso_ao_cofre' ? 'Você não tem acesso ao Cofre de Credenciais.' : m)
    } finally { setBusy(false) }
  }

  const abrirHistorico = async (c: Credencial) => {
    setBusy(true); setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_revelacoes', { p_id: c.id })
      if (error) throw error
      setHistorico({ cred: c, linhas: (data as RevelacaoLinha[]) ?? [] })
    } catch (e) { setErro((e as Error).message) }
    finally { setBusy(false) }
  }

  const salvarSistema = async () => {
    if (!novoSistema) return
    const { sistema, url_login, usuario, senha, observacao } = novoSistema
    if (!sistema.trim() || !usuario.trim() || !senha.trim()) {
      setErro('Sistema, usuário e senha são obrigatórios.'); return
    }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_salvar_sistema', {
        p_sistema: sistema.trim(), p_usuario: usuario.trim(), p_senha: senha,
        p_url_login: url_login.trim() || null, p_observacao: observacao.trim() || null,
      })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; sistema?: string } | null
      if (!j?.sucesso) throw new Error(j?.erro ?? 'falha ao salvar')
      setMsg(`CRIOU o sistema ${j.sistema}.`)
      setNovoSistema(null)
      await recarregar()
    } catch (e) {
      const m = (e as Error).message
      setErro(m === 'sem_acesso_ao_cofre' ? 'Você não tem acesso ao Cofre de Credenciais.' : m)
    } finally { setBusy(false) }
  }

  const salvarTecnica = async () => {
    if (!editando) return
    const { provider, chave, valor, label, escopo = 'global', company_id } = editando
    if (!provider || !chave || !valor) { setErro('provider, chave e valor são obrigatórios'); return }
    const escopoFinal: Escopo = provider === 'focus' ? 'empresa' : (escopo as Escopo)
    if (escopoFinal === 'empresa' && !company_id) { setErro('Selecione a empresa (Focus é por empresa).'); return }
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('fn_credencial_salvar', {
        p_provider: provider, p_chave: chave, p_valor: valor,
        p_escopo: escopoFinal, p_company_id: escopoFinal === 'empresa' ? company_id : null,
        p_label: label ?? null, p_nome_vault_override: null,
      })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string; nome_vault?: string } | null
      if (!j?.sucesso) throw new Error(j?.erro ?? 'falha ao salvar')
      setMsg(`${editando.id ? 'ALTEROU' : 'CRIOU'} ${provider}/${chave}.`)
      setEditando(null)
      await recarregar()
    } catch (e) {
      const m = (e as Error).message
      setErro(m === 'sem_acesso_ao_cofre' ? 'Você não tem acesso ao Cofre de Credenciais.' : m)
    } finally { setBusy(false) }
  }

  const inativar = async (c: Credencial, rotulo: string) => {
    if (!confirm(`Excluir ${rotulo} de ${c.provider}?\nO secret no Vault NÃO é apagado (mantido para auditoria).`)) return
    setBusy(true); setErro(null); setMsg(null)
    try {
      const { error } = await supabase.rpc('fn_credencial_inativar', { p_id: c.id })
      if (error) throw error
      setMsg(`EXCLUIU ${c.provider}/${c.chave}.`)
      await recarregar()
    } catch (e) {
      const m = (e as Error).message
      setErro(m === 'sem_acesso_ao_cofre' ? 'Você não tem acesso ao Cofre de Credenciais.' : m)
    } finally { setBusy(false) }
  }

  if (permitido === null) {
    return <div style={{ minHeight: '100vh', background: BG, padding: 32, color: ESP60 }}>Verificando permissão...</div>
  }
  if (permitido === false) {
    return (
      <div style={{ minHeight: '100vh', background: BG, padding: 32 }}>
        <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', color: ESP }}>
          <ShieldAlert size={40} style={{ margin: '0 auto', color: '#B45309' }} />
          <h1 style={{ fontSize: 20, marginTop: 12, fontFamily: 'ui-serif,Georgia,serif' }}>Acesso restrito</h1>
          <p style={{ fontSize: 13, color: ESP60, marginTop: 6 }}>
            Você não tem acesso ao Cofre de Credenciais.
          </p>
        </div>
      </div>
    )
  }

  const btn: React.CSSProperties = { background: GOLD, color: '#fff', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }
  const btnGhost: React.CSSProperties = { background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '6px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }
  const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`, borderRadius: 6, fontSize: 13, background: '#fff', color: ESP }
  const tab = (ativa: boolean): React.CSSProperties => ({
    padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `0.5px solid ${ativa ? GOLD : LINE}`, background: ativa ? GOLD : 'transparent', color: ativa ? '#fff' : ESP60,
  })

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 20px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: GOLD }}>Cofre · RD-41 Pilar 2</div>
            <h1 style={{ fontSize: 24, color: ESP, margin: '4px 0 0', fontFamily: 'ui-serif,Georgia,serif' }}>
              <Lock size={20} style={{ display: 'inline', marginRight: 8, verticalAlign: '-3px' }} />
              Cofre de Credenciais
            </h1>
            <div style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>
              Sistemas que a <b>PS contratou</b> pra operar o ERP. Valor cifrado no Vault; aqui só metadados.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {aba === 'sistema' ? (
              <button type="button" onClick={() => setNovoSistema({ sistema: '', url_login: '', usuario: '', senha: '', observacao: '' })} style={btn}>
                <Plus size={14} style={{ verticalAlign: '-2px' }} /> Novo sistema
              </button>
            ) : (
              <button type="button" onClick={() => setEditando({ escopo: 'global' })} style={btn}>
                <Plus size={14} style={{ verticalAlign: '-2px' }} /> Nova credencial
              </button>
            )}
          </div>
        </header>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button type="button" style={tab(aba === 'sistema')} onClick={() => setAba('sistema')}>Sistemas</button>
          <button type="button" style={tab(aba === 'tecnica')} onClick={() => setAba('tecnica')}>Técnicas</button>
        </div>

        {msg && <div style={{ background: '#DCFCE7', color: '#166534', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{msg}</div>}
        {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{erro}</div>}

        {/* ===================== ABA SISTEMAS ===================== */}
        {aba === 'sistema' && (
          <div style={{ display: 'grid', gap: 12 }}>
            {busy && sistemas.length === 0 && <div style={{ color: ESP60, fontSize: 13, padding: 16 }}>Carregando...</div>}
            {!busy && sistemas.length === 0 && (
              <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 24, textAlign: 'center', color: ESP60, fontSize: 13 }}>
                Nenhum sistema cadastrado. Use <b>+ Novo sistema</b> para guardar login e senha de um serviço contratado.
              </div>
            )}
            {sistemas.map((s) => {
              const revUser = reveladoValor?.id === s.usuario?.id ? reveladoValor : null
              const revSenha = reveladoValor?.id === s.senha?.id ? reveladoValor : null
              return (
                <div key={s.chaveGrupo} style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: ESP }}>{s.provider}</div>
                      {s.url_login && (
                        <a href={s.url_login} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: GOLD, display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <ExternalLink size={11} /> {s.url_login}
                        </a>
                      )}
                      <div style={{ fontSize: 10, color: ESP60, marginTop: 4 }}>
                        {s.escopo}{s.escopo === 'empresa' && s.company_id ? ` · ${nomeEmpresa(s.company_id)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => (s.senha ? inativar(s.senha, 'a senha') : undefined)}
                      disabled={busy || !s.senha}
                      style={{ ...btnGhost, color: '#B45309', borderColor: '#E7C9A0' }}
                      title="Inativa a credencial (o Vault é preservado)"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
                    {/* Usuário */}
                    <div>
                      <div style={{ fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Usuário</div>
                      {revUser ? (
                        <button type="button" onClick={() => { navigator.clipboard.writeText(revUser.valor); setMsg('Usuário copiado.') }} style={{ ...btnGhost, fontFamily: 'monospace', background: '#FEF3C7', borderColor: GOLD }}>
                          <Copy size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />{revUser.valor}
                        </button>
                      ) : (
                        <button type="button" onClick={() => s.usuario && revelar(s.usuario, 'o usuário')} disabled={busy || !s.usuario?.tem_valor} style={btnGhost}>
                          <Eye size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />Revelar usuário
                        </button>
                      )}
                    </div>
                    {/* Senha */}
                    <div>
                      <div style={{ fontSize: 10, color: ESP60, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Senha</div>
                      {revSenha ? (
                        <button type="button" onClick={() => { navigator.clipboard.writeText(revSenha.valor); setMsg('Senha copiada — some em 30s.') }} style={{ ...btnGhost, fontFamily: 'monospace', background: '#FEF3C7', borderColor: GOLD, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Copy size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                          {revSenha.valor.length > 28 ? `${revSenha.valor.slice(0, 10)}…${revSenha.valor.slice(-6)}` : revSenha.valor}
                        </button>
                      ) : (
                        <button type="button" onClick={() => s.senha && revelar(s.senha, 'a senha')} disabled={busy || !s.senha?.tem_valor} style={btnGhost}>
                          <Eye size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />Revelar senha
                        </button>
                      )}
                    </div>
                  </div>

                  {s.observacao && (
                    <div style={{ marginTop: 10, fontSize: 12, color: ESP60, background: BG, borderRadius: 6, padding: '8px 10px' }}>{s.observacao}</div>
                  )}

                  {s.senha && (
                    <button
                      type="button"
                      onClick={() => s.senha && abrirHistorico(s.senha)}
                      style={{ ...btnGhost, marginTop: 10, fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                    >
                      <History size={11} />
                      revelada {s.senha.revelacoes_total ?? 0}{(s.senha.revelacoes_total ?? 0) === 1 ? ' vez' : ' vezes'}
                      {s.senha.revelado_ultima_vez_em ? ` · última em ${fmtDate(s.senha.revelado_ultima_vez_em)}` : ''}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ===================== ABA TÉCNICAS (whitelist 05/07) ===================== */}
        {aba === 'tecnica' && (
          <>
            <div style={{ background: '#FEF3C7', color: '#7A5A0F', padding: '10px 12px', borderRadius: 8, fontSize: 11, marginBottom: 12, border: `0.5px solid rgba(200,148,26,0.35)` }}>
              🔑 Técnicas do Cofre = <b>Anthropic, APS, Auditor Gold, Brapi, Pluggy, Supabase, Focus</b>.
              Sicoob/Bradesco vão em <b>Conexões Bancárias</b>; IO Point/ERPs vão em <b>Conectores</b>.
            </div>
            <div style={{ background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: BG, borderBottom: `0.5px solid ${LINE}` }}>
                    {['Provider', 'Chave', 'Escopo', 'Rótulo', 'Status', 'Atualizado'].map((h) => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'left', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{h}</th>
                    ))}
                    <th style={{ padding: '10px 12px', textAlign: 'right', color: ESP60, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {busy && tecnicas.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: ESP60 }}>Carregando...</td></tr>}
                  {!busy && tecnicas.length === 0 && <tr><td colSpan={7} style={{ padding: 20, textAlign: 'center', color: ESP60 }}>Nenhuma credencial técnica.</td></tr>}
                  {tecnicas.map((c) => (
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
                        {c.tem_valor
                          ? <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#DCFCE7', color: '#166534', fontWeight: 700 }}>VAULT OK</span>
                          : <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: '#FEF3C7', color: '#7A5A0F', fontWeight: 700 }}>PENDENTE</span>}
                      </td>
                      <td style={{ padding: '10px 12px', color: ESP60, fontSize: 11 }}>{fmtDate(c.atualizado_em)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          {reveladoValor?.id === c.id ? (
                            <button type="button" onClick={() => { navigator.clipboard.writeText(reveladoValor.valor); setMsg('Valor copiado.') }} style={{ ...btnGhost, background: '#FEF3C7', borderColor: GOLD, fontFamily: 'monospace', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <Copy size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                              {reveladoValor.valor.length > 30 ? `${reveladoValor.valor.slice(0, 12)}…${reveladoValor.valor.slice(-8)}` : reveladoValor.valor}
                            </button>
                          ) : (
                            <button type="button" onClick={() => revelar(c, 'o valor')} disabled={busy || !c.tem_valor} style={btnGhost}>
                              <Eye size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} />Revelar
                            </button>
                          )}
                          <button type="button" onClick={() => setEditando({ ...c, valor: '' })} disabled={busy} style={btnGhost}>Editar</button>
                          <button type="button" onClick={() => inativar(c, 'o valor')} disabled={busy} style={{ ...btnGhost, color: '#B45309', borderColor: '#E7C9A0' }}><Trash2 size={11} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ===================== MODAL: NOVO SISTEMA ===================== */}
      {novoSistema && (
        <div role="dialog" aria-modal="true" onClick={() => setNovoSistema(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, maxWidth: 520, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}` }}>
              <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Novo sistema</div>
              <div style={{ fontSize: 16, color: ESP, fontWeight: 600, marginTop: 4 }}>Login e senha de um serviço contratado</div>
            </div>
            <div style={{ padding: 20, display: 'grid', gap: 12 }}>
              {/* decoy p/ absorver autofill do Chrome */}
              <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} readOnly />
              <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} readOnly />
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Sistema</label>
                <input list="sistemas-sugeridos" name="cofre-sistema" autoComplete="off" autoFocus
                  value={novoSistema.sistema} onChange={(e) => setNovoSistema({ ...novoSistema, sistema: e.target.value.toLowerCase() })}
                  placeholder="ex.: resend, registro.br, vercel" style={inp} />
                <datalist id="sistemas-sugeridos">{SISTEMAS_SUGERIDOS.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>URL de login</label>
                <input name="cofre-url" autoComplete="off" value={novoSistema.url_login}
                  onChange={(e) => setNovoSistema({ ...novoSistema, url_login: e.target.value })}
                  placeholder="https://..." style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Usuário</label>
                <input name="cofre-user" autoComplete="off" value={novoSistema.usuario}
                  onChange={(e) => setNovoSistema({ ...novoSistema, usuario: e.target.value })}
                  placeholder="login / e-mail da conta" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Senha (mascarada ao digitar)</label>
                <input type="password" name="cofre-secret" autoComplete="new-password" value={novoSistema.senha}
                  onChange={(e) => setNovoSistema({ ...novoSistema, senha: e.target.value })} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Observação (2FA, quem contratou, vencimento)</label>
                <textarea name="cofre-obs" value={novoSistema.observacao}
                  onChange={(e) => setNovoSistema({ ...novoSistema, observacao: e.target.value })}
                  rows={2} style={{ ...inp, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: `0.5px solid ${LINE}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setNovoSistema(null)} style={btnGhost} disabled={busy}>Cancelar</button>
              <button type="button" onClick={salvarSistema} disabled={busy} style={btn}>
                <Save size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} /> Cadastrar sistema
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: TÉCNICA (fluxo antigo) ===================== */}
      {editando && (
        <div role="dialog" aria-modal="true" onClick={() => setEditando(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, maxWidth: 520, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}` }}>
              <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>{editando.id ? 'Editar' : 'Nova'} credencial técnica</div>
              <div style={{ fontSize: 16, color: ESP, fontWeight: 600, marginTop: 4 }}>{editando.provider ? `${editando.provider}/${editando.chave ?? ''}` : 'Nova credencial'}</div>
            </div>
            <div style={{ padding: 20, display: 'grid', gap: 12 }}>
              <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} readOnly />
              <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} readOnly />
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Provider</label>
                <input list="providers-tecnica" name="cofre-provider" autoComplete="off" autoFocus={!editando.id}
                  value={editando.provider ?? ''} disabled={!!editando.id}
                  onChange={(e) => setEditando({ ...editando, provider: e.target.value.toLowerCase() })} placeholder="ex.: aps" style={inp} />
                <datalist id="providers-tecnica">{PROVIDERS_TECNICA_SUGERIDOS.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Chave</label>
                <input name="cofre-chave" autoComplete="off" value={editando.chave ?? ''} disabled={!!editando.id}
                  onChange={(e) => setEditando({ ...editando, chave: e.target.value.toLowerCase() })} placeholder="ex.: client_id" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: editando.provider === 'focus' ? '1fr 1fr' : '1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Escopo</label>
                  <input value={editando.provider === 'focus' ? 'empresa (Focus é por empresa)' : 'global (ferramenta contratada pela PS)'} disabled style={{ ...inp, background: BG, color: ESP60 }} />
                </div>
                {editando.provider === 'focus' && (
                  <div>
                    <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Empresa</label>
                    <select value={editando.company_id ?? ''} disabled={!!editando.id}
                      onChange={(e) => setEditando({ ...editando, company_id: e.target.value || null, escopo: 'empresa' })} style={inp}>
                      <option value="">— selecione —</option>
                      {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Rótulo (opcional)</label>
                <input name="cofre-rotulo" autoComplete="off" value={editando.label ?? ''}
                  onChange={(e) => setEditando({ ...editando, label: e.target.value })} placeholder="ex.: Autodesk APS produção" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>Valor (secret) · mascarado ao digitar</label>
                <input type="password" name="cofre-secret" autoComplete="new-password" autoFocus={!!editando.id}
                  value={editando.valor ?? ''} onChange={(e) => setEditando({ ...editando, valor: e.target.value })}
                  placeholder={editando.id ? 'novo valor (deixa vazio p/ manter atual)' : ''} style={inp} />
              </div>
            </div>
            <div style={{ padding: '12px 20px', borderTop: `0.5px solid ${LINE}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setEditando(null)} style={btnGhost} disabled={busy}>Cancelar</button>
              <button type="button" onClick={salvarTecnica} disabled={busy} style={btn}>
                <Save size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />{editando.id ? 'Atualizar' : 'Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== MODAL: HISTÓRICO DA TRILHA ===================== */}
      {historico && (
        <div role="dialog" aria-modal="true" onClick={() => setHistorico(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1001 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: BG, borderRadius: 12, maxWidth: 460, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>Trilha de revelação</div>
                <div style={{ fontSize: 15, color: ESP, fontWeight: 600, marginTop: 4 }}>{historico.cred.provider} / {historico.cred.chave}</div>
              </div>
              <button type="button" onClick={() => setHistorico(null)} style={{ ...btnGhost, padding: 6 }}><X size={14} /></button>
            </div>
            <div style={{ padding: 12, maxHeight: '60vh', overflowY: 'auto' }}>
              {historico.linhas.length === 0 ? (
                <div style={{ padding: 16, textAlign: 'center', color: ESP60, fontSize: 13 }}>Ainda não revelada.</div>
              ) : historico.linhas.map((l, i) => (
                <div key={i} style={{ padding: '8px 10px', borderBottom: `0.5px solid ${LINE}`, fontSize: 12, color: ESP }}>
                  <b>{l.revelador_email ?? '—'}</b>
                  <span style={{ color: ESP60 }}> · {fmtDate(l.revelado_em)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
