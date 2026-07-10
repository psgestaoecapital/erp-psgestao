'use client'

// PR 3/3 do reorganiza 3 telas de integracao (diretriz CEO 06/07).
// Conexoes Bancarias = API DIRETA com bancos, por empresa. NAO Pluggy
// (Pluggy fica no Wealth/Open Finance em outra tela).
//
// Backend canonico:
//  - erp_banco_provider_config: 1 linha por (company_id, provider, ambiente)
//    com capabilities (cap_boleto/cap_extrato/cap_pagamento) e cursor de sync.
//  - erp_banco_contas: conta bancaria vinculada a company + config.
//  - erp_credencial (Cofre B.9): armazena as credenciais (client_id/client_secret/
//    cert A1/senha do cert) via fn_credencial_salvar, cifradas no Vault.
//
// Adapters prontos: Sicoob (756), Bradesco (237). Sicredi (748) = proximo.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import {
  ArrowLeft, Plus, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  Banknote, X, Lock,
} from 'lucide-react'

type Ambiente = 'producao' | 'homologacao'
interface ProviderConfig {
  id: string
  company_id: string
  provider: string
  ambiente: Ambiente
  client_id: string | null
  cooperativa: string | null
  conta: string | null
  codigo_beneficiario: string | null
  convenio: string | null
  cap_boleto: boolean | null
  cap_extrato: boolean | null
  cap_pagamento: boolean | null
  ativo: boolean
  ultimo_sync_em: string | null
  ultimo_sync_status: string | null
  banco_conta_id: string | null
}

interface BancoConta {
  id: string
  nome: string
  banco: string | null
}

type CampoConexao = 'client_id' | 'client_secret' | 'cooperativa' | 'conta' | 'codigo_beneficiario' | 'cert_a1' | 'cert_senha' | 'api_key' | 'codigo_acesso' | 'posto'
type BancoDef = {
  codigo: number; sigla: string; nome: string; cor: string; pronto: boolean;
  campos: readonly CampoConexao[];
}
const BANCOS: readonly BancoDef[] = [
  {
    codigo: 756, sigla: 'sicoob', nome: 'Sicoob',
    cor: '#003641', pronto: true,
    campos: ['client_id', 'cooperativa', 'conta', 'codigo_beneficiario', 'cert_a1', 'cert_senha'],
  },
  {
    codigo: 237, sigla: 'bradesco', nome: 'Bradesco',
    cor: '#CC092F', pronto: true,
    campos: ['client_id', 'client_secret', 'cert_a1', 'cert_senha', 'conta'],
  },
  {
    // Sicredi Cobrança v3.9.1: OAuth2 (x-api-key + password=Código de Acesso).
    // NÃO usa client_id/client_secret nem mTLS. username = codBenef+cooperativa (no adapter).
    codigo: 748, sigla: 'sicredi', nome: 'Sicredi',
    cor: '#3F8B29', pronto: true,
    campos: ['api_key', 'codigo_acesso', 'cooperativa', 'codigo_beneficiario', 'posto'],
  },
]

const ESP = '#3D2314'
const BG = '#FAF7F2'
const GOLD = '#C8941A'
const LINE = '#E7DECF'
const ESP60 = 'rgba(61,35,20,0.55)'

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('pt-BR') } catch { return '—' }
}

function providerCanonico(sigla: string, amb: Ambiente): string {
  // Provider no erp_credencial (Cofre B.9): banco_<sigla>_<prod|homolog>
  return `banco_${sigla}_${amb === 'producao' ? 'prod' : 'homolog'}`
}

export default function ConexoesBancariasPage() {
  const { companyIds } = useCompanyIds()
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null

  const [configs, setConfigs] = useState<ProviderConfig[]>([])
  const [contas, setContas] = useState<BancoConta[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [testando, setTestando] = useState<string | null>(null)
  const [testeResultado, setTesteResultado] = useState<Record<string, { ok: boolean; texto: string }>>({})
  const [conectandoBanco, setConectandoBanco] = useState<typeof BANCOS[number] | null>(null)

  const carregar = useCallback(async () => {
    if (!empresaUnica) return
    setLoading(true); setErro(null)
    const [cfgRes, contasRes] = await Promise.all([
      supabase.from('erp_banco_provider_config')
        .select('id, company_id, provider, ambiente, client_id, cooperativa, conta, codigo_beneficiario, convenio, cap_boleto, cap_extrato, cap_pagamento, ativo, ultimo_sync_em, ultimo_sync_status, banco_conta_id')
        .eq('company_id', empresaUnica)
        .order('provider'),
      supabase.from('erp_banco_contas')
        .select('id, nome, banco')
        .eq('company_id', empresaUnica),
    ])
    if (cfgRes.error) setErro(cfgRes.error.message)
    else setConfigs((cfgRes.data ?? []) as ProviderConfig[])
    if (!contasRes.error) setContas((contasRes.data ?? []) as BancoConta[])
    setLoading(false)
  }, [empresaUnica])

  useEffect(() => { carregar() }, [carregar])

  const sincronizarExtrato = async (cfg: ProviderConfig) => {
    setSyncing(cfg.id); setErro(null); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch('/api/banco/extrato/sync', {
        method: 'POST', credentials: 'include',
        headers: {
          'content-type': 'application/json',
          authorization: session ? `Bearer ${session.access_token}` : '',
        },
        body: JSON.stringify({ company_id: cfg.company_id, provider_config_id: cfg.id }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro || j.detalhe || 'falha ao sincronizar')
      setMsg(`SINCRONIZOU ${j.inseridos ?? 0} novos movimentos (${j.ignorados ?? 0} duplicados).`)
      await carregar()
    } catch (e) { setErro((e as Error).message) }
    finally { setSyncing(null) }
  }

  // Bancos com rota de "Testar conexão" (ping por sessão). Cresce conforme os adapters.
  const PING_PROVIDERS = new Set(['sicredi'])

  const testarConexao = async (cfg: ProviderConfig, sigla: string) => {
    setTestando(cfg.id); setErro(null); setMsg(null)
    setTesteResultado((m) => { const n = { ...m }; delete n[cfg.id]; return n })
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`/api/banco/${sigla}/ping`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', authorization: session ? `Bearer ${session.access_token}` : '' },
        body: JSON.stringify({ company_id: cfg.company_id, ambiente: cfg.ambiente }),
      })
      const j = await r.json()
      if (j.ok && j.autenticou) {
        setTesteResultado((m) => ({ ...m, [cfg.id]: { ok: true, texto: `Conectou — autenticou em ${cfg.ambiente}` } }))
      } else {
        setTesteResultado((m) => ({ ...m, [cfg.id]: { ok: false, texto: j.erro || `Falhou (HTTP ${r.status})` } }))
      }
    } catch (e) {
      setTesteResultado((m) => ({ ...m, [cfg.id]: { ok: false, texto: (e as Error).message } }))
    } finally { setTestando(null) }
  }

  if (!empresaUnica) {
    return (
      <div style={{ minHeight: '100vh', background: BG, padding: 24, color: ESP60, fontSize: 13 }}>
        Selecione uma empresa específica no topo do menu para gerenciar as conexões bancárias.
      </div>
    )
  }

  const bancosNaoConectados = BANCOS.filter((b) =>
    !configs.some((c) => c.provider === b.sigla || c.provider.startsWith(`banco_${b.sigla}_`)),
  )

  return (
    <div style={{ minHeight: '100vh', background: BG, padding: '24px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: GOLD }}>
              Financeiro · Integração bancária
            </div>
            <h1 style={{ fontSize: 24, color: ESP, margin: '4px 0 0', fontFamily: 'ui-serif,Georgia,serif' }}>
              <Banknote size={22} style={{ verticalAlign: '-3px', marginRight: 8 }} />
              Conexões Bancárias
            </h1>
            <p style={{ fontSize: 12, color: ESP60, marginTop: 4 }}>
              API <b>direta</b> com bancos por empresa: boleto, extrato, pagamento.
            </p>
          </div>
          <Link href="/dashboard/financeiro" style={{
            background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`,
            padding: '8px 14px', borderRadius: 6, fontSize: 12, textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <ArrowLeft size={14} /> Financeiro
          </Link>
        </header>

        <div style={{ background: '#FEF3C7', color: '#7A5A0F', padding: '10px 12px', borderRadius: 8, fontSize: 11, marginBottom: 12, border: `0.5px solid rgba(200,148,26,0.35)` }}>
          🏦 <b>Conexões Bancárias</b> = API oficial do banco (Sicoob, Bradesco, Sicredi) por empresa.
          Credenciais salvas no <b>Vault</b> (cifradas). Open Finance via Pluggy fica em{' '}
          <Link href="/dashboard/wealth" style={{ color: GOLD, fontWeight: 600 }}>Wealth</Link>.
          Ferramentas PS globais em <Link href="/dashboard/cofre" style={{ color: GOLD, fontWeight: 600 }}>Cofre</Link>;
          ERPs externos em <Link href="/dashboard/conectores" style={{ color: GOLD, fontWeight: 600 }}>Conectores</Link>.
        </div>

        {msg && <div style={{ background: '#DCFCE7', color: '#166534', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{msg}</div>}
        {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12, marginBottom: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
          <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} /> {erro}
        </div>}

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: ESP60, fontSize: 13, background: '#fff', border: `0.5px solid ${LINE}`, borderRadius: 12 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Carregando...
          </div>
        ) : (
          <>
            <div style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{ padding: '10px 14px', borderBottom: `0.5px solid ${LINE}`, background: BG, fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>
                Bancos conectados ({configs.length})
              </div>
              {configs.length === 0 ? (
                <div style={{ padding: 24, textAlign: 'center', color: ESP60, fontSize: 12 }}>
                  Nenhum banco conectado ainda. Clique em <b>Conectar novo banco</b> abaixo.
                </div>
              ) : configs.map((cfg) => {
                const bancoInfo = BANCOS.find((b) => cfg.provider.includes(b.sigla))
                const contaVinculada = contas.find((c) => c.id === cfg.banco_conta_id)
                return (
                  <div key={cfg.id} style={{ padding: 14, borderBottom: `0.5px solid ${LINE}`, display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 8,
                      background: (bancoInfo?.cor ?? ESP) + '15',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: bancoInfo?.cor ?? ESP, fontSize: 14, fontWeight: 700, flexShrink: 0,
                    }}>
                      {bancoInfo?.sigla.slice(0, 2).toUpperCase() ?? '??'}
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ color: ESP, fontSize: 14 }}>
                          {bancoInfo?.nome ?? cfg.provider}
                        </strong>
                        <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: BG, color: ESP60, textTransform: 'uppercase' }}>
                          {cfg.ambiente}
                        </span>
                        {!cfg.ativo && (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#FEE2E2', color: '#B91C1C' }}>
                            inativo
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: ESP60, marginTop: 4 }}>
                        {contaVinculada && <><b>{contaVinculada.nome}</b> · </>}
                        {cfg.cooperativa && `coop ${cfg.cooperativa} · `}
                        {cfg.conta && `conta ${cfg.conta}`}
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                        {cfg.cap_boleto && <Badge cor="#16A34A">Boleto</Badge>}
                        {cfg.cap_extrato && <Badge cor="#3B82F6">Extrato</Badge>}
                        {cfg.cap_pagamento && <Badge cor="#7C3AED">Pagamento</Badge>}
                      </div>
                      <div style={{ fontSize: 10, color: ESP60, marginTop: 6 }}>
                        Último sync: <b>{fmtData(cfg.ultimo_sync_em)}</b>
                        {cfg.ultimo_sync_status && <> · {cfg.ultimo_sync_status.startsWith('erro') ? (
                          <span style={{ color: '#B91C1C' }}>{cfg.ultimo_sync_status.slice(0, 60)}</span>
                        ) : (
                          <span style={{ color: '#16A34A' }}><CheckCircle2 size={10} style={{ verticalAlign: '-1px' }} /> ok</span>
                        )}</>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {bancoInfo && PING_PROVIDERS.has(bancoInfo.sigla) && cfg.ativo && (
                          <button
                            type="button"
                            onClick={() => testarConexao(cfg, bancoInfo.sigla)}
                            disabled={testando === cfg.id}
                            style={{
                              background: 'transparent', color: ESP, border: `1px solid ${LINE}`,
                              padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                              cursor: testando === cfg.id ? 'wait' : 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                            🔌 {testando === cfg.id ? 'Testando…' : 'Testar conexão'}
                          </button>
                        )}
                        {cfg.cap_extrato && cfg.ativo && (
                          <button
                            type="button"
                            onClick={() => sincronizarExtrato(cfg)}
                            disabled={syncing === cfg.id}
                            style={{
                              background: syncing === cfg.id ? 'rgba(200,148,26,0.4)' : GOLD,
                              color: '#3D2314', border: 'none', padding: '6px 12px',
                              borderRadius: 6, fontSize: 11, fontWeight: 600,
                              cursor: syncing === cfg.id ? 'wait' : 'pointer',
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                            }}>
                            <RefreshCw size={12} style={{ animation: syncing === cfg.id ? 'spin 1s linear infinite' : 'none' }} />
                            {syncing === cfg.id ? 'Sincronizando…' : 'Sincronizar extrato'}
                          </button>
                        )}
                      </div>
                      {testeResultado[cfg.id] && (
                        <div style={{
                          fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, maxWidth: 280, textAlign: 'right',
                          background: testeResultado[cfg.id].ok ? '#DCFCE7' : '#FEE2E2',
                          color: testeResultado[cfg.id].ok ? '#166534' : '#B91C1C',
                        }}>
                          {testeResultado[cfg.id].ok ? '✅ ' : '❌ '}{testeResultado[cfg.id].texto}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ background: '#FFFFFF', border: `0.5px solid ${LINE}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                Conectar novo banco
              </div>
              {bancosNaoConectados.length === 0 ? (
                <div style={{ fontSize: 12, color: ESP60 }}>
                  Todos os bancos disponíveis já estão conectados nesta empresa.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {bancosNaoConectados.map((b) => (
                    <button
                      key={b.sigla}
                      type="button"
                      onClick={() => b.pronto ? setConectandoBanco(b) : setMsg(`${b.nome} — adapter em desenvolvimento (próximo).`)}
                      style={{
                        background: '#FFFFFF', color: ESP,
                        border: `0.5px solid ${LINE}`, borderRadius: 8,
                        padding: '12px 14px', cursor: 'pointer',
                        display: 'flex', gap: 10, alignItems: 'center',
                        opacity: b.pronto ? 1 : 0.6,
                      }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: 6,
                        background: b.cor + '15', color: b.cor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                      }}>
                        {b.sigla.slice(0, 2).toUpperCase()}
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{b.nome}</div>
                        <div style={{ fontSize: 10, color: ESP60 }}>
                          {b.codigo}{b.pronto ? '' : ' · em breve'}
                        </div>
                      </div>
                      {b.pronto && <Plus size={14} style={{ marginLeft: 'auto', color: GOLD }} />}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10, color: ESP60, marginTop: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
                <Lock size={10} /> Credenciais são cifradas no Vault (cofre canônico). Nada em texto puro.
              </div>
            </div>
          </>
        )}
      </div>

      {conectandoBanco && empresaUnica && (
        <ConectarBancoModal
          banco={conectandoBanco}
          companyId={empresaUnica}
          onClose={() => setConectandoBanco(null)}
          onSucesso={() => { setConectandoBanco(null); setMsg('Banco conectado.'); void carregar() }}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

function Badge({ children, cor }: { children: React.ReactNode; cor: string }) {
  return (
    <span style={{
      fontSize: 9, padding: '2px 6px', borderRadius: 3,
      background: cor + '15', color: cor,
      fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
    }}>
      {children}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────
// Modal Conectar banco
// Salva credenciais no Vault via fn_credencial_salvar + cria erp_banco_provider_config
interface ConectarProps {
  banco: BancoDef
  companyId: string
  onClose: () => void
  onSucesso: () => void
}
function ConectarBancoModal({ banco, companyId, onClose, onSucesso }: ConectarProps) {
  // Sicredi está em fase de teste → default Homologação (state controlado persiste a escolha).
  const [ambiente, setAmbiente] = useState<Ambiente>(banco.sigla === 'sicredi' ? 'homologacao' : 'producao')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [cooperativa, setCooperativa] = useState('')
  const [conta, setConta] = useState('')
  const [codBenef, setCodBenef] = useState('')
  const [certA1Base64, setCertA1Base64] = useState('')
  const [certA1Nome, setCertA1Nome] = useState('')
  const [certSenha, setCertSenha] = useState('')
  // Sicredi Cobrança (auth OAuth2 real)
  const [apiKey, setApiKey] = useState('')
  const [codigoAcesso, setCodigoAcesso] = useState('')
  const [posto, setPosto] = useState('')
  const [capBoleto, setCapBoleto] = useState(true)
  const [capExtrato, setCapExtrato] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function onCertFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setCertA1Nome(f.name)
    const buf = new Uint8Array(await f.arrayBuffer())
    let bin = ''
    const CHUNK = 0x8000
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode(...buf.subarray(i, Math.min(i + CHUNK, buf.length)))
    }
    setCertA1Base64(btoa(bin))
  }

  async function salvar() {
    setSalvando(true); setErro(null)
    try {
      // Bancos cujo adapter lê via fn_banco_obter_credencial (Vault *_vault_id):
      // Sicredi e Sicoob. Salvar via fn_banco_salvar_credencial — que grava os
      // segredos no Vault E seta banco_codigo + *_vault_id que o adapter lê. O fluxo
      // genérico (fn_credencial_salvar) NÃO alimenta o adapter → daria "cert/segredo faltando".
      if (banco.sigla === 'sicredi' || banco.sigla === 'sicoob') {
        const params: Record<string, unknown> = {
          p_company_id: companyId, p_banco_codigo: String(banco.codigo), p_provider: banco.sigla, p_ambiente: ambiente,
          p_cooperativa: cooperativa || null, p_codigo_beneficiario: codBenef || null,
          p_cap_boleto: capBoleto, p_cap_extrato: capExtrato, p_cap_pagamento: false, p_ativo: true,
        }
        if (banco.sigla === 'sicredi') {
          // OAuth Cobrança: x-api-key + Código de Acesso (slot client_secret). Sem client_id/cert.
          Object.assign(params, { p_api_key: apiKey || null, p_client_secret: codigoAcesso || null, p_client_id: null, p_posto: posto || null })
        } else {
          // Sicoob: client_id + certificado A1 (mTLS) no Vault + conta. Sem api_key.
          Object.assign(params, { p_client_id: clientId || null, p_cert_base64: certA1Base64 || null, p_cert_senha: certSenha || null, p_conta: conta || null })
        }
        const { data, error } = await supabase.rpc('fn_banco_salvar_credencial', params)
        if (error) throw error
        const j = data as { ok?: boolean; erro?: string } | null
        if (!j?.ok) throw new Error(j?.erro ?? `falha ao salvar credencial ${banco.nome}`)
        onSucesso(); return
      }
      const provider = providerCanonico(banco.sigla, ambiente)
      // Salvar credenciais no Vault (fn_credencial_salvar — Cofre B.9).
      const salvar1 = async (chave: string, valor: string, label: string) => {
        if (!valor) return
        const { data, error } = await supabase.rpc('fn_credencial_salvar', {
          p_provider: provider, p_chave: chave, p_valor: valor,
          p_escopo: 'empresa', p_company_id: companyId,
          p_label: label, p_nome_vault_override: null,
        })
        if (error) throw error
        const j = data as { sucesso?: boolean; erro?: string } | null
        if (!j?.sucesso) throw new Error(j?.erro ?? `falha ao salvar ${chave}`)
      }
      if (clientSecret) await salvar1('client_secret', clientSecret, `${banco.nome} · client secret`)
      if (certA1Base64) await salvar1('cert', certA1Base64, `${banco.nome} · cert A1 (base64)`)
      if (certSenha) await salvar1('certpw', certSenha, `${banco.nome} · senha do cert A1`)

      // Cria/atualiza a linha em erp_banco_provider_config.
      const { error: upErr } = await supabase.from('erp_banco_provider_config').upsert({
        company_id: companyId,
        provider: banco.sigla,
        ambiente,
        client_id: clientId || null,
        cooperativa: banco.campos.includes('cooperativa') ? (cooperativa || null) : null,
        conta: banco.campos.includes('conta') ? (conta || null) : null,
        codigo_beneficiario: banco.campos.includes('codigo_beneficiario') ? (codBenef || null) : null,
        cap_boleto: capBoleto,
        cap_extrato: capExtrato,
        ativo: true,
      }, { onConflict: 'company_id,provider,ambiente' })
      if (upErr) throw upErr
      onSucesso()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, zIndex: 1000,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: BG, borderRadius: 12, maxWidth: 560, width: '100%', maxHeight: '92vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `0.5px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: ESP60, textTransform: 'uppercase', letterSpacing: 1 }}>
              Conectar banco
            </div>
            <div style={{ fontSize: 16, color: ESP, fontWeight: 600 }}>
              {banco.nome} <span style={{ color: ESP60, fontWeight: 400 }}>({banco.codigo})</span>
            </div>
          </div>
          <button onClick={onClose} type="button" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: ESP60 }}>
            <X size={18} />
          </button>
        </div>

        <div onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }} style={{ padding: 20, overflowY: 'auto', display: 'grid', gap: 10 }}>
          {/* Iscas invisíveis: o Chrome injeta e-mail/senha salvos AQUI, não nos campos reais. */}
          <input type="text" name="ps_decoy_user" autoComplete="username" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} />
          <input type="password" name="ps_decoy_pass" autoComplete="new-password" tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }} />
          <Field label="Ambiente">
            <select value={ambiente} onChange={(e) => setAmbiente(e.target.value as Ambiente)} style={inp}>
              <option value="producao">Produção</option>
              <option value="homologacao">Homologação</option>
            </select>
          </Field>
          {banco.campos.includes('client_id') && (
            <Field label="Client ID">
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={inp} />
            </Field>
          )}
          {banco.campos.includes('client_secret') && (
            <Field label="Client Secret">
              <input type="password" autoComplete="off" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} style={inp} />
            </Field>
          )}
          {banco.campos.includes('cooperativa') && (
            <Field label="Cooperativa">
              <input name="ps_coop_nofill" autoComplete="off" inputMode="numeric" pattern="[0-9]*" value={cooperativa} onChange={(e) => setCooperativa(e.target.value)} style={inp} placeholder="ex.: 4133" />
            </Field>
          )}
          {banco.campos.includes('conta') && (
            <Field label="Conta corrente">
              <input value={conta} onChange={(e) => setConta(e.target.value)} style={inp} placeholder="ex.: 12345-6" />
            </Field>
          )}
          {banco.campos.includes('codigo_beneficiario') && (
            <Field label="Código do beneficiário">
              <input name="ps_benef_nofill" autoComplete="off" inputMode="numeric" pattern="[0-9]*" value={codBenef} onChange={(e) => setCodBenef(e.target.value)} style={inp} placeholder="5 dígitos" />
            </Field>
          )}
          {banco.campos.includes('api_key') && (
            <Field label="x-api-key (Portal do Desenvolvedor)">
              <input type="password" name="ps_apikey_nofill" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={inp} placeholder="UUID da app" />
            </Field>
          )}
          {banco.campos.includes('codigo_acesso') && (
            <Field label="Código de Acesso (Internet Banking)">
              <input type="password" name="ps_codacesso_nofill" autoComplete="new-password" value={codigoAcesso} onChange={(e) => setCodigoAcesso(e.target.value)} style={inp} />
            </Field>
          )}
          {banco.campos.includes('posto') && (
            <Field label="Posto (código da agência)">
              <input name="ps_posto_nofill" autoComplete="off" inputMode="numeric" pattern="[0-9]*" value={posto} onChange={(e) => setPosto(e.target.value)} style={inp} placeholder="2 dígitos · ex.: 03" />
            </Field>
          )}
          {banco.campos.includes('cert_a1') && (
            <>
              <Field label="Certificado A1 (.pfx)">
                <input type="file" accept=".pfx,.p12" onChange={onCertFile} style={{ ...inp, padding: 5 }} />
                {certA1Nome && <small style={{ fontSize: 10, color: ESP60 }}>Arquivo: {certA1Nome}</small>}
              </Field>
              <Field label="Senha do certificado">
                <input type="password" autoComplete="off" value={certSenha} onChange={(e) => setCertSenha(e.target.value)} style={inp} />
              </Field>
            </>
          )}
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: ESP60, marginBottom: 4 }}>Recursos habilitados</div>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: ESP, marginBottom: 4 }}>
              <input type="checkbox" checked={capBoleto} onChange={(e) => setCapBoleto(e.target.checked)} />
              Emitir boletos
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: ESP }}>
              <input type="checkbox" checked={capExtrato} onChange={(e) => setCapExtrato(e.target.checked)} />
              Sincronizar extrato
            </label>
          </div>
          {erro && <div style={{ background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
        </div>

        <div style={{ padding: '12px 20px', borderTop: `0.5px solid ${LINE}`, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={salvando} style={{
            background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`,
            padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: salvando ? 'not-allowed' : 'pointer',
          }}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={salvando} style={{
            background: salvando ? 'rgba(200,148,26,0.4)' : GOLD,
            color: '#3D2314', border: 'none', padding: '8px 18px',
            borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer',
          }}>{salvando ? 'Conectando…' : 'CONECTAR (cifrar no Vault)'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  )
}

const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`,
  borderRadius: 6, fontSize: 13, background: '#fff', color: ESP,
  fontFamily: 'inherit', boxSizing: 'border-box',
}
