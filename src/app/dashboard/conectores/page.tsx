'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const C = { bg: '#0C0C0A', card: '#1A1410', card2: '#201C16', bd: '#2A2822', go: '#C8941A', gol: '#E8C872', tx: '#FAF7F2', txm: '#B0AB9F', txd: '#706C64', g: '#22C55E', r: '#EF4444', y: '#FBBF24', b: '#60A5FA', tl: '#2DD4BF', p: '#A855F7' }

const CATS = [
  { id: 'erp_financeiro', nome: 'ERPs Financeiros', icon: '💰' },
  { id: 'erp_enterprise', nome: 'ERPs Enterprise', icon: '🏢' },
  { id: 'erp_industrial', nome: 'ERPs Industriais', icon: '🏭' },
  { id: 'erp_agro', nome: 'ERPs Agro', icon: '🌾' },
  { id: 'rh_ponto', nome: 'RH / Ponto', icon: '👥' },
  { id: 'manutencao', nome: 'Manutencao', icon: '🔧' },
  { id: 'logistica', nome: 'Logistica', icon: '🚛' },
  { id: 'banco', nome: 'Open Finance', icon: '🏦' },
  { id: 'fiscal', nome: 'Fiscal', icon: '📄' },
  { id: 'pagamento', nome: 'Pagamentos', icon: '💳' },
]

const CONNECTORS = [
  { id: 'omie', nome: 'Omie', cat: 'erp_financeiro', status: 'ativo', cor: '#22C55E', campos: [{ k: 'omie_app_key', l: 'App Key', p: 'Chave do aplicativo Omie' }, { k: 'omie_app_secret', l: 'App Secret', p: 'Secret do aplicativo Omie', secret: true }], syncApi: '/api/omie/sync' },
  { id: 'contaazul', nome: 'ContaAzul', cat: 'erp_financeiro', status: 'ativo', cor: '#0EA5E9', campos: [{ k: 'contaazul_client_id', l: 'Client ID', p: 'Client ID do ContaAzul' }, { k: 'contaazul_client_secret', l: 'Client Secret', p: 'Client Secret do ContaAzul', secret: true }], syncApi: '/api/contaazul/sync', oauth: true },
  { id: 'bling', nome: 'Bling', cat: 'erp_financeiro', status: 'em_breve', cor: '#8B5CF6', campos: [{ k: 'bling_api_key', l: 'API Key', p: 'Chave API v3' }] },
  { id: 'nibo', nome: 'Nibo', cat: 'erp_financeiro', status: 'ativo', cor: '#3B82F6', campos: [{ k: 'nibo_api_key', l: 'API Key', p: 'API Key do Nibo' }, { k: 'nibo_api_secret', l: 'API Secret', p: 'API Secret do Nibo', secret: true }, { k: 'nibo_org_id', l: 'ID da Empresa', p: 'UUID da empresa no Nibo' }], syncApi: '/api/nibo/sync' },
  { id: 'granatum', nome: 'Granatum', cat: 'erp_financeiro', status: 'planejado', cor: '#EAB308', campos: [] },
  { id: 'controlle', nome: 'Controlle', cat: 'erp_financeiro', status: 'planejado', cor: '#A16207', campos: [] },
  { id: 'tiny', nome: 'Tiny ERP', cat: 'erp_financeiro', status: 'planejado', cor: '#F97316', campos: [] },
  { id: 'vhsys', nome: 'vhsys', cat: 'erp_financeiro', status: 'planejado', cor: '#06B6D4', campos: [] },
  { id: 'webmais', nome: 'WebMais', cat: 'erp_financeiro', status: 'planejado', cor: '#10B981', campos: [] },
  { id: 'nomus', nome: 'Nomus', cat: 'erp_financeiro', status: 'planejado', cor: '#6366F1', campos: [] },
  { id: 'totvs', nome: 'TOTVS Protheus', cat: 'erp_enterprise', status: 'planejado', cor: '#DC2626', campos: [] },
  { id: 'sap', nome: 'SAP Business One', cat: 'erp_enterprise', status: 'planejado', cor: '#0070F2', campos: [] },
  { id: 'senior', nome: 'Senior Sistemas', cat: 'erp_enterprise', status: 'planejado', cor: '#7C3AED', campos: [] },
  { id: 'sankhya', nome: 'Sankhya', cat: 'erp_enterprise', status: 'planejado', cor: '#059669', campos: [] },
  { id: 'atak', nome: 'Atak / Frigosoft', cat: 'erp_industrial', status: 'em_breve', cor: '#B91C1C', campos: [{ k: 'atak_api_url', l: 'URL Servidor', p: 'https://servidor-atak' }] },
  { id: 'arpa', nome: 'Arpa Control', cat: 'erp_industrial', status: 'em_breve', cor: '#92400E', campos: [{ k: 'arpa_pg_host', l: 'Host PostgreSQL', p: '192.168.x.x' }] },
  { id: 'paripassu', nome: 'PariPassu', cat: 'erp_industrial', status: 'planejado', cor: '#15803D', campos: [] },
  { id: 'bomcontrole', nome: 'Bom Controle', cat: 'erp_industrial', status: 'planejado', cor: '#F97316', campos: [] },
  { id: 'scada', nome: 'SCADA / OPC-UA', cat: 'erp_industrial', status: 'planejado', cor: '#64748B', campos: [] },
  { id: 'lims', nome: 'LIMS', cat: 'erp_industrial', status: 'planejado', cor: '#0F766E', campos: [] },
  { id: 'siagri', nome: 'Siagri / Aliare', cat: 'erp_agro', status: 'planejado', cor: '#16A34A', campos: [] },
  { id: 'iopoint', nome: 'IO Point', cat: 'rh_ponto', status: 'em_breve', cor: '#2563EB', campos: [{ k: 'iopoint_api_key', l: 'API Key', p: 'Token IO Point' }] },
  { id: 'pontotel', nome: 'Pontotel', cat: 'rh_ponto', status: 'planejado', cor: '#7C3AED', campos: [] },
  { id: 'dominio', nome: 'Dominio Sistemas', cat: 'rh_ponto', status: 'planejado', cor: '#0369A1', campos: [] },
  { id: 'produttivo', nome: 'Produttivo', cat: 'manutencao', status: 'em_breve', cor: '#2DD4BF', campos: [{ k: 'produttivo_api_key', l: 'API Key', p: 'Token Produttivo' }] },
  { id: 'engeman', nome: 'Engeman', cat: 'manutencao', status: 'planejado', cor: '#0891B2', campos: [] },
  { id: 'manusis', nome: 'Manusis', cat: 'manutencao', status: 'planejado', cor: '#4338CA', campos: [] },
  { id: 'checklistfacil', nome: 'Checklist Facil', cat: 'manutencao', status: 'planejado', cor: '#059669', campos: [] },
  { id: 'brasilsat', nome: 'Brasil Sat', cat: 'logistica', status: 'em_breve', cor: '#CA8A04', campos: [{ k: 'brasilsat_api_key', l: 'API Key', p: 'Token Brasil Sat' }] },
  { id: 'sascar', nome: 'Sascar / Michelin', cat: 'logistica', status: 'planejado', cor: '#1D4ED8', campos: [] },
  { id: 'worldsat', nome: 'World Sat', cat: 'logistica', status: 'planejado', cor: '#0E7490', campos: [] },
  { id: 'pluggy', nome: 'Pluggy', cat: 'banco', status: 'em_breve', cor: '#06B6D4', campos: [{ k: 'pluggy_client_id', l: 'Client ID', p: 'Pluggy Client ID' }] },
  { id: 'belvo', nome: 'Belvo', cat: 'banco', status: 'em_breve', cor: '#14B8A6', campos: [{ k: 'belvo_secret_id', l: 'Secret ID', p: 'Belvo Secret ID' }] },
  { id: 'asaas', nome: 'Asaas', cat: 'pagamento', status: 'em_breve', cor: '#10B981', campos: [{ k: 'asaas_api_key', l: 'API Key', p: 'Chave API Asaas' }] },
  { id: 'cora', nome: 'Cora', cat: 'pagamento', status: 'planejado', cor: '#EC4899', campos: [] },
  { id: 'iugu', nome: 'Iugu', cat: 'pagamento', status: 'planejado', cor: '#A855F7', campos: [] },
  { id: 'enotas', nome: 'eNotas', cat: 'fiscal', status: 'em_breve', cor: '#6366F1', campos: [{ k: 'enotas_api_key', l: 'API Key', p: 'Chave eNotas' }] },
  { id: 'focusnfe', nome: 'Focus NFe', cat: 'fiscal', status: 'planejado', cor: '#8B5CF6', campos: [] },
]

const statusLabel = (s: string) => s === 'ativo' ? 'Ativo' : s === 'em_breve' ? 'Em breve' : 'Planejado'
const statusCor = (s: string) => s === 'ativo' ? C.g : s === 'em_breve' ? C.b : C.txd

// Mapa conector.id -> provider em erp_credencial (Cofre B.9).
// Reorganizacao 3 telas (diretriz CEO 06/07): Conectores mostra credencial
// no Vault por (company_id, provider) — a fonte canonica sao os secrets em
// erp_credencial escopo='empresa'. Legado em companies.<field> ainda existe
// pra retro-compat; badge Vault indica migracao pro Cofre canonico.
const CONECTOR_PROVIDER: Record<string, string> = {
  iopoint: 'iopoint',
  atak: 'atak',
  focusnfe: 'focus',
  pluggy: 'pluggy',
  omie: 'omie',
  contaazul: 'contaazul',
  nibo: 'nibo',
}

// Credencial cadastrada no Vault (Cofre B.9) por provider.
// Mantida indexada por provider pra habilitar editar/excluir sem re-fetch.
type VaultCred = { id: string; nome_secret_vault: string; label: string | null; chave: string }

export default function ConectoresPage() {
  // FIX-FONTE-UNICA-EMPRESA (07/07 · CEO):
  // Antes: tela tinha seletor proprio de empresa (companies + grupos + select
  // local). CEO salvou IO Point na Breier (seletor local) achando ser Frioeste
  // (seletor da sidebar) — bug de dupla fonte. Agora fonte unica: useCompanyIds
  // (ps_empresa_sel canonico da sidebar). Se consolidado/grupo -> empty state.
  const { companyIds, selInfo, loading: companiesLoading, sel } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && sel && companyIds.length === 1 ? sel : null

  const [empresa, setEmpresa] = useState<any>(null)
  const [filtro, setFiltro] = useState('todos')
  const [open, setOpen] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [lastSync, setLastSync] = useState('')
  const [syncCount, setSyncCount] = useState(0)
  // Credenciais Vault por provider (id + nome_secret_vault) — necessario pra editar/excluir.
  const [vaultCreds, setVaultCreds] = useState<Record<string, VaultCred>>({})

  // Recarrega empresa (dados brutos + credenciais Vault) sempre que empresaUnica muda
  useEffect(() => {
    if (companiesLoading) return
    if (!empresaUnica) { setEmpresa(null); setVaultCreds({}); return }
    let alive = true
    ;(async () => {
      const { data: emp } = await supabase.from('companies').select('*').eq('id', empresaUnica).maybeSingle()
      if (!alive) return
      setEmpresa(emp)

      // Configs iniciais dos campos legacy (Omie/Nibo/ContaAzul ainda leem de companies.<field>)
      const cfg: Record<string, string> = {}
      for (const con of CONNECTORS) {
        for (const campo of (con.campos || [])) {
          cfg[campo.k] = (emp as Record<string, unknown> | null)?.[campo.k] as string || ''
        }
      }
      setConfigs(cfg)

      // Last sync info
      const { data: imports } = await supabase.from('omie_imports').select('imported_at').eq('company_id', empresaUnica).order('imported_at', { ascending: false }).limit(1)
      if (!alive) return
      if (imports && imports.length > 0) {
        setLastSync(new Date(imports[0].imported_at).toLocaleString('pt-BR'))
        const { data: all } = await supabase.from('omie_imports').select('id').eq('company_id', empresaUnica)
        if (alive) setSyncCount(all?.length || 0)
      } else { setLastSync('Nunca'); setSyncCount(0) }

      // Cofre canonico: quais providers tem credencial pra essa empresa (id + nome vault)
      const { data: creds } = await supabase.from('erp_credencial')
        .select('id, provider, chave, nome_secret_vault, label')
        .eq('escopo', 'empresa')
        .eq('company_id', empresaUnica)
        .eq('ativo', true)
      if (!alive) return
      const map: Record<string, VaultCred> = {}
      for (const row of ((creds ?? []) as { id: string; provider: string; chave: string; nome_secret_vault: string; label: string | null }[])) {
        // Se ha varias chaves por provider (ex: Omie tem app_key + app_secret),
        // fica a mais recente — botao Excluir vai remover apenas essa.
        // Suficiente pra o CEO desconectar um conector inteiro clicando 1 vez.
        map[row.provider] = { id: row.id, nome_secret_vault: row.nome_secret_vault, label: row.label, chave: row.chave }
      }
      setVaultCreds(map)
    })()
    return () => { alive = false }
  }, [empresaUnica, companiesLoading])

  const recarregarVault = async () => {
    if (!empresaUnica) return
    const { data: creds } = await supabase.from('erp_credencial')
      .select('id, provider, chave, nome_secret_vault, label')
      .eq('escopo', 'empresa')
      .eq('company_id', empresaUnica)
      .eq('ativo', true)
    const map: Record<string, VaultCred> = {}
    for (const row of ((creds ?? []) as { id: string; provider: string; chave: string; nome_secret_vault: string; label: string | null }[])) {
      map[row.provider] = { id: row.id, nome_secret_vault: row.nome_secret_vault, label: row.label, chave: row.chave }
    }
    setVaultCreds(map)
  }

  // Recarrega last sync + count apos disparar sincronizar em Omie/Nibo/ContaAzul.
  const recarregarSyncInfo = async () => {
    if (!empresaUnica) return
    const { data: imports } = await supabase.from('omie_imports').select('imported_at').eq('company_id', empresaUnica).order('imported_at', { ascending: false }).limit(1)
    if (imports && imports.length > 0) {
      setLastSync(new Date(imports[0].imported_at).toLocaleString('pt-BR'))
      const { data: all } = await supabase.from('omie_imports').select('id').eq('company_id', empresaUnica)
      setSyncCount(all?.length || 0)
    }
  }

  const excluirCredencial = async (conId: string) => {
    if (!empresa) return
    const provider = CONECTOR_PROVIDER[conId] ?? conId
    const cred = vaultCreds[provider]
    if (!cred) { setMsg('Sem credencial pra excluir.'); return }
    const nomeEmpresa = empresa.nome_fantasia || empresa.razao_social || 'esta empresa'
    if (!window.confirm(`EXCLUIR credencial "${cred.label || provider}" de ${nomeEmpresa}?\n\nO conector fica desconectado até um novo Salvar. Ação irreversível.`)) return
    setDeleting(conId); setMsg('')
    const { error } = await supabase.rpc('fn_credencial_inativar', { p_id: cred.id })
    setDeleting(null)
    if (error) { setMsg('Erro ao excluir: ' + error.message); return }
    setMsg(`EXCLUIU credencial de ${nomeEmpresa}`)
    await recarregarVault()
    setTimeout(() => setMsg(''), 4000)
  }

  // FIX-CONECTORES-VAULT (07/07 · CEO):
  // Antes: salvar() gravava em `companies.<field>` (colunas legadas) — nunca ia
  // pro Vault, badge "VAULT OK" nunca aparecia, sync IO Point ficava sem token.
  // Agora: chama fn_credencial_salvar (RPC Cofre B.9) por campo -> escreve no
  // Vault via SECURITY DEFINER + upsert em erp_credencial escopo=empresa +
  // company_id. Pilar 2 respeitado: token nunca trafega em GET, so via revelar.
  const salvar = async (conId: string) => {
    if (!empresa) return
    setSaving(true); setMsg('')
    const con = CONNECTORS.find(c => c.id === conId)
    if (!con) { setSaving(false); return }
    const provider = CONECTOR_PROVIDER[con.id] ?? con.id

    let salvos = 0
    for (const campo of con.campos) {
      const valor = (configs[campo.k] ?? '').trim()
      if (!valor) continue // pula campo vazio — permite salvar parcial

      // Chave curta padronizada: 'iopoint_api_key' -> 'api_key'
      const chave = campo.k.startsWith(conId + '_')
        ? campo.k.slice(conId.length + 1)
        : campo.k

      const { data, error } = await supabase.rpc('fn_credencial_salvar', {
        p_provider: provider,
        p_chave: chave,
        p_valor: valor,
        p_escopo: 'empresa',
        p_company_id: empresa.id,
        p_label: `${con.nome} · ${campo.l}`,
      })
      if (error) {
        setMsg(`Erro ao salvar ${campo.l}: ${error.message}`)
        setSaving(false)
        return
      }
      const j = data as { sucesso?: boolean; erro?: string; nome_vault?: string } | null
      if (!j?.sucesso) {
        setMsg(`Erro ao salvar ${campo.l}: ${j?.erro ?? 'falha desconhecida'}`)
        setSaving(false)
        return
      }
      salvos++
    }

    if (salvos === 0) {
      setMsg('Preencha ao menos um campo pra salvar.')
    } else {
      const jaTinha = vaultCreds[provider]
      setMsg(`${jaTinha ? 'ALTEROU' : 'SALVOU'} ${salvos} credencial(is) no Vault para ${empresa.nome_fantasia || empresa.razao_social}`)
      // Recarrega badges + ids das credenciais (Vault OK + botao Excluir)
      await recarregarVault()
      // Limpa inputs de credencial pra nao ficar valor em memoria depois de gravado
      const limpo = { ...configs }
      for (const campo of con.campos) delete limpo[campo.k]
      setConfigs(limpo)
      // Fecha o card apos salvar (sinal visual de que gravou)
      setOpen(null)
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 4000)
  }

  const testar = async (conId: string) => {
    if (!empresa) return
    setMsg('Testando conexao...')
    if (conId === 'omie') {
      const appKey = configs['omie_app_key']; const appSecret = configs['omie_app_secret']
      if (!appKey || !appSecret) { setMsg('Preencha App Key e App Secret'); return }
      try {
        const res = await fetch('/api/omie', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_key: appKey, app_secret: appSecret, endpoint: 'geral/empresas/', method: 'ListarEmpresas', params: { pagina: 1, registros_por_pagina: 1 } }) })
        const data = await res.json()
        setMsg(data.error ? 'Erro Omie: ' + data.error : 'Conexao Omie OK!')
      } catch (e: any) { setMsg('Erro: ' + e.message) }
    } else if (conId === 'nibo') {
      const apiKey = configs['nibo_api_key']; const orgId = configs['nibo_org_id']; const apiSecret = configs['nibo_api_secret']
      if (!apiKey || !orgId) { setMsg('Preencha API Key, API Secret e ID da Empresa'); return }
      try {
        const res = await fetch('/api/nibo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: empresa.id, nibo_api_key: apiKey, nibo_api_secret: apiSecret, nibo_org_id: orgId, sync_types: ['categorias'] }) })
        const data = await res.json()
        setMsg(data.error ? 'Erro Nibo: ' + data.error : 'Conexao Nibo OK! ' + (data.results?.categorias?.total || 0) + ' categorias encontradas.')
      } catch (e: any) { setMsg('Erro: ' + e.message) }
    } else if (conId === 'contaazul') {
      const token = empresa.contaazul_token
      if (!token) { setMsg('Conecte o ContaAzul primeiro (botao Conectar)'); return }
      try {
        const res = await fetch('/api/contaazul/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: empresa.id, token, sync_types: ['categorias'] }) })
        const data = await res.json()
        setMsg(data.error ? 'Erro ContaAzul: ' + data.error : 'Conexao ContaAzul OK! ' + (data.results?.categorias?.total || 0) + ' categorias.')
      } catch (e: any) { setMsg('Erro: ' + e.message) }
    } else { setMsg('Teste disponivel para Omie, Nibo e ContaAzul') }
    setTimeout(() => setMsg(''), 5000)
  }

  const conectarOAuth = (conId: string) => {
    if (!empresa) return
    if (conId === 'contaazul') {
      const clientId = configs['contaazul_client_id']
      const clientSecret = configs['contaazul_client_secret']
      if (!clientId || !clientSecret) { setMsg('Salve Client ID e Client Secret primeiro'); return }
      const state = btoa(JSON.stringify({ ci: clientId, cs: clientSecret, cid: empresa.id }))
      const redirectUri = encodeURIComponent(window.location.origin + '/api/contaazul/callback')
      const url = `https://api.contaazul.com/auth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&state=${encodeURIComponent(state)}&scope=accounting`
      window.location.href = url
    }
  }

  const sincronizar = async (conId: string) => {
    if (!empresa) return
    setSyncing(true); setMsg('Sincronizando dados... (pode levar 1-2 min)')
    try {
      if (conId === 'omie') {
        const appKey = configs['omie_app_key']; const appSecret = configs['omie_app_secret']
        if (!appKey || !appSecret) { setMsg('Salve as credenciais primeiro'); setSyncing(false); return }
        const res = await fetch('/api/omie/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_key: appKey, app_secret: appSecret, sync_type: 'full', company_id: empresa.id }) })
        const data = await res.json()
        if (data.error) setMsg('Erro: ' + data.error)
        else { const total = Object.values(data.counts || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0); setMsg('Omie: ' + total + ' registros importados!'); recarregarSyncInfo() }
      } else if (conId === 'nibo') {
        const apiKey = configs['nibo_api_key']; const orgId = configs['nibo_org_id']; const apiSecret = configs['nibo_api_secret']
        if (!apiKey || !orgId) { setMsg('Salve as credenciais primeiro'); setSyncing(false); return }
        const res = await fetch('/api/nibo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: empresa.id, nibo_api_key: apiKey, nibo_api_secret: apiSecret, nibo_org_id: orgId }) })
        const data = await res.json()
        if (data.error) setMsg('Erro: ' + data.error)
        else { setMsg(data.message || 'Nibo sync OK!'); recarregarSyncInfo() }
      } else if (conId === 'contaazul') {
        const token = empresa.contaazul_token
        if (!token) { setMsg('Conecte o ContaAzul primeiro'); setSyncing(false); return }
        const res = await fetch('/api/contaazul/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: empresa.id, token }) })
        const data = await res.json()
        if (data.error) setMsg('Erro: ' + data.error)
        else { setMsg(data.message || 'ContaAzul sync OK!'); recarregarSyncInfo() }
      } else { setMsg('Sync disponivel para Omie, Nibo e ContaAzul') }
    } catch (e: any) { setMsg('Erro: ' + e.message) }
    setSyncing(false); setTimeout(() => setMsg(''), 8000)
  }

  const filtered = filtro === 'todos' ? CONNECTORS : CONNECTORS.filter(c => c.cat === filtro)
  const stats = { total: CONNECTORS.length, ativo: CONNECTORS.filter(c => c.status === 'ativo').length, breve: CONNECTORS.filter(c => c.status === 'em_breve').length, plan: CONNECTORS.filter(c => c.status === 'planejado').length }

  return (
    <div style={{ padding: '16px 16px 40px', minHeight: '100vh', background: C.bg, color: C.tx }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, color: C.go, letterSpacing: 2, textTransform: 'uppercase' }}>Hub Universal</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.tx, margin: '2px 0 0' }}>Central de Conectores</h1>
          <div style={{ fontSize: 11, color: C.txd }}>{stats.total} conectores | {stats.ativo} ativo | {stats.breve} em breve | 10 categorias</div>
        </div>
        <a href="/dashboard" style={{ color: C.go, fontSize: 11, textDecoration: 'none', padding: '5px 10px', border: '1px solid ' + C.bd, borderRadius: 6 }}>Dashboard</a>
      </div>

      {/* FIX-FONTE-UNICA-EMPRESA (07/07 · CEO): seletor duplo REMOVIDO.
          Empresa vem do seletor principal PS na sidebar (ps_empresa_sel).
          Se nao ha empresa unica selecionada, cai em empty state abaixo. */}
      {empresa && (
        <div style={{ background: C.card, borderRadius: 10, padding: 12, marginBottom: 14, borderLeft: '3px solid ' + C.tl, border: '1px solid ' + C.bd }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 9, color: C.txd, textTransform: 'uppercase', letterSpacing: 1 }}>Empresa ativa</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.tx }}>{empresa.nome_fantasia || empresa.razao_social}</div>
            <div style={{ fontSize: 10, color: C.txm, marginLeft: 'auto' }}>
              <span style={{ color: C.go, fontWeight: 600 }}>{empresa.cnpj || 'Sem CNPJ'}</span>
              {' · Última sync: '}<span style={{ color: lastSync === 'Nunca' ? C.r : C.g }}>{lastSync}</span>
              {syncCount > 0 && <span> · {syncCount} imports</span>}
            </div>
          </div>
          <div style={{ fontSize: 9, color: C.txd, marginTop: 4 }}>
            💡 Trocar empresa? Use o seletor no menu superior da PS. Aqui não há seletor próprio (fonte única).
          </div>
        </div>
      )}

      <div style={{ background: C.card2, borderLeft: '3px solid ' + C.go, borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: 11, color: C.txm }}>
        🔌 <b>Conectores</b> = sistemas externos do cliente (ERPs, ponto, manutenção, logística).
        Credencial por empresa vai pro Cofre canônico (<code style={{ color: C.gol }}>erp_credencial · escopo=empresa</code>).
        Badge <b style={{ color: C.g }}>Vault OK</b> = provider já cadastrado no Vault pra empresa selecionada.
        <br />
        Ferramentas da PS (Anthropic, APS, Brapi, Pluggy…) → <a href="/dashboard/cofre" style={{ color: C.gol }}>Cofre</a> ·
        Bancos (Sicoob, Bradesco) → <a href="/dashboard/financeiro/conexoes-bancarias" style={{ color: C.gol }}>Conexões Bancárias</a>.
      </div>

      {msg && <div style={{ background: msg.includes('Erro') || msg.includes('Preencha') ? C.r + '15' : C.g + '15', border: '1px solid ' + (msg.includes('Erro') || msg.includes('Preencha') ? C.r : C.g) + '30', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: msg.includes('Erro') || msg.includes('Preencha') ? C.r : C.g }}>{msg}</div>}

      {/* FIX-FONTE-UNICA-EMPRESA (07/07): empty state quando consolidado/grupo/sem empresa */}
      {!companiesLoading && !empresaUnica && (
        <div style={{ padding: 40, textAlign: 'center', background: C.card, border: '1px solid ' + C.bd, borderRadius: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.tx, marginBottom: 8 }}>Selecione uma empresa</div>
          <div style={{ fontSize: 12, color: C.txm, maxWidth: 460, margin: '0 auto', lineHeight: 1.5 }}>
            A Central de Conectores grava credencial por empresa (Vault + Cofre B.9).
            Escolha uma empresa específica no seletor da sidebar principal — modo consolidado ou grupo não é aceito aqui pra evitar gravar no lugar errado.
          </div>
        </div>
      )}

      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setFiltro('todos')} style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: 600, border: filtro === 'todos' ? '1px solid ' + C.go : '1px solid ' + C.bd, background: filtro === 'todos' ? C.go + '10' : 'transparent', color: filtro === 'todos' ? C.gol : C.txm }}>Todos ({stats.total})</button>
        {CATS.map(cat => {
          const count = CONNECTORS.filter(c => c.cat === cat.id).length
          return <button key={cat.id} onClick={() => setFiltro(cat.id)} style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: 600, border: filtro === cat.id ? '1px solid ' + C.go : '1px solid ' + C.bd, background: filtro === cat.id ? C.go + '10' : 'transparent', color: filtro === cat.id ? C.gol : C.txm }}>{cat.icon} {cat.nome} ({count})</button>
        })}
      </div>

      {/* GRID — so renderiza com empresa selecionada (impede salvar em lugar errado) */}
      {empresaUnica && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 8 }}>
        {filtered.map(con => (
          <div key={con.id} style={{ background: C.card, borderRadius: 8, border: '1px solid ' + C.bd, overflow: 'hidden' }}>
            <div onClick={() => setOpen(open === con.id ? null : con.id)} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 6, background: con.cor + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: con.cor }}>{con.id.substring(0, 2).toUpperCase()}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.tx }}>{con.nome}</div>
                  <div style={{ fontSize: 9, color: C.txd }}>{CATS.find(c => c.id === con.cat)?.nome}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {vaultCreds[CONECTOR_PROVIDER[con.id] ?? '__none__'] && (
                  <span title="Credencial cadastrada no Vault para esta empresa" style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, background: C.g + '20', color: C.g, fontWeight: 700, border: '1px solid ' + C.g + '40', letterSpacing: 0.5 }}>
                    🔒 VAULT OK
                  </span>
                )}
                <span style={{ fontSize: 8, padding: '2px 8px', borderRadius: 4, background: statusCor(con.status) + '15', color: statusCor(con.status), fontWeight: 600, border: '1px solid ' + statusCor(con.status) + '30' }}>{statusLabel(con.status)}</span>
              </div>
            </div>

            {open === con.id && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid ' + C.bd + '50' }}>
                {con.campos.length > 0 ? (
                  <>
                    {con.campos.map(campo => (
                      <div key={campo.k} style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, color: C.txd, marginBottom: 3 }}>{campo.l}</div>
                        <input type={(campo as any).secret ? 'password' : 'text'} value={configs[campo.k] || ''} onChange={e => setConfigs({ ...configs, [campo.k]: e.target.value })} placeholder={campo.p} style={{ width: '100%', background: C.bg, border: '1px solid ' + C.bd, color: C.tx, padding: '8px 10px', borderRadius: 6, fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                      </div>
                    ))}
                    {/* FIX-CONECTORES-EDITAR-EXCLUIR (07/07 · CEO): informe se ja existe
                        credencial salva no Vault desta empresa pra este conector.
                        Salvar continua sendo update (upsert por chave). Excluir usa
                        fn_credencial_inativar (soft-delete + esconde badge Vault OK). */}
                    {vaultCreds[CONECTOR_PROVIDER[con.id] ?? '__none__'] && (
                      <div style={{ marginTop: 10, padding: '6px 10px', background: C.g + '10', border: '1px solid ' + C.g + '30', borderRadius: 6, fontSize: 10, color: C.g }}>
                        🔒 Credencial cadastrada no Vault para esta empresa. Digite acima pra ALTERAR ou use Excluir pra desconectar.
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                      {/* FIX-CONECTORES-VAULT (07/07): habilitado tambem em em_breve
                          (mensagem abaixo ja explica que o secret fica salvo pra quando
                          ativarmos a sync). Testar/Sincronizar seguem so em ativo. */}
                      <button onClick={() => salvar(con.id)} disabled={saving || !!deleting} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: C.go, color: '#fff', fontSize: 11, fontWeight: 700, cursor: saving || deleting ? 'not-allowed' : 'pointer', opacity: saving || deleting ? 0.6 : 1 }}>
                        {saving ? '...' : (vaultCreds[CONECTOR_PROVIDER[con.id] ?? '__none__'] ? 'Alterar' : 'Salvar')}
                      </button>
                      {vaultCreds[CONECTOR_PROVIDER[con.id] ?? '__none__'] && (
                        <button
                          onClick={() => excluirCredencial(con.id)}
                          disabled={saving || deleting === con.id}
                          style={{
                            padding: '8px 14px', borderRadius: 6, border: '1px solid ' + C.r + '60',
                            background: 'transparent', color: C.r, fontSize: 11, fontWeight: 700,
                            cursor: (saving || deleting === con.id) ? 'not-allowed' : 'pointer',
                            opacity: (saving || deleting === con.id) ? 0.6 : 1,
                          }}
                        >
                          {deleting === con.id ? '...' : '🗑 Excluir'}
                        </button>
                      )}
                      {con.status === 'ativo' && (
                        <>
                          {(con as any).oauth && <button onClick={() => conectarOAuth(con.id)} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: '#0EA5E9', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>🔗 Conectar</button>}
                          <button onClick={() => testar(con.id)} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid ' + C.b, background: 'transparent', color: C.b, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>Testar</button>
                          <button onClick={() => sincronizar(con.id)} disabled={syncing} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: syncing ? C.bd : C.g, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                            {syncing ? 'Sincronizando...' : 'Sincronizar Agora'}
                          </button>
                        </>
                      )}
                    </div>
                    {con.status !== 'ativo' && <div style={{ fontSize: 9, color: C.txd, marginTop: 6 }}>Integracao em desenvolvimento. Salve as credenciais para quando ativarmos.</div>}
                  </>
                ) : (
                  <div style={{ padding: '10px 0', fontSize: 11, color: C.txd }}>Conector planejado — sem configuracao disponivel ainda.</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      )}

      <div style={{ fontSize: 8, color: C.txd, textAlign: 'center', marginTop: 20 }}>PS Gestao e Capital — Central de Conectores v8.7.4 | {stats.total} conectores | 10 categorias</div>
    </div>
  )
}
