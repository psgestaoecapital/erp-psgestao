'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

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
  { id: 'contaazul', nome: 'ContaAzul', cat: 'erp_financeiro', status: 'em_breve', cor: '#0EA5E9', campos: [{ k: 'contaazul_token', l: 'Token', p: 'Token OAuth' }] },
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

export default function ConectoresPage() {
  const [companies, setCompanies] = useState<any[]>([])
  const [grupos, setGrupos] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [empresa, setEmpresa] = useState<any>(null)
  const [filtro, setFiltro] = useState('todos')
  const [open, setOpen] = useState<string | null>(null)
  const [configs, setConfigs] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [lastSync, setLastSync] = useState('')
  const [syncCount, setSyncCount] = useState(0)

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
      if (up?.role === 'adm' || up?.role === 'acesso_total') {
        const { data } = await supabase.from('companies').select('*').order('nome_fantasia')
        setCompanies(data || [])
        const { data: grps } = await supabase.from('company_groups').select('*').order('nome')
        setGrupos(grps || [])
        if (data && data.length > 0) { setEmpresaSel(data[0].id); loadEmpresa(data[0]) }
      }
    })()
  }, [])

  const loadEmpresa = (emp: any) => {
    setEmpresa(emp)
    const cfg: Record<string, string> = {}
    for (const con of CONNECTORS) {
      for (const campo of (con.campos || [])) {
        cfg[campo.k] = emp?.[campo.k] || ''
      }
    }
    setConfigs(cfg)
    // Load last sync info
    supabase.from('omie_imports').select('imported_at, record_count').eq('company_id', emp.id).order('imported_at', { ascending: false }).limit(1).then(({ data }) => {
      if (data && data.length > 0) {
        setLastSync(new Date(data[0].imported_at).toLocaleString('pt-BR'))
        supabase.from('omie_imports').select('id').eq('company_id', emp.id).then(({ data: all }) => setSyncCount(all?.length || 0))
      } else { setLastSync('Nunca'); setSyncCount(0) }
    })
  }

  const selectEmpresa = (id: string) => {
    setEmpresaSel(id)
    const emp = companies.find(c => c.id === id)
    if (emp) loadEmpresa(emp)
    setMsg('')
  }

  const salvar = async (conId: string) => {
    if (!empresa) return
    setSaving(true); setMsg('')
    const con = CONNECTORS.find(c => c.id === conId)
    if (!con) { setSaving(false); return }

    const updates: Record<string, string> = {}
    for (const campo of con.campos) {
      updates[campo.k] = configs[campo.k] || ''
    }

    const { error } = await supabase.from('companies').update(updates).eq('id', empresa.id)
    if (error) { setMsg('Erro ao salvar: ' + error.message) }
    else { setMsg('Credenciais salvas para ' + (empresa.nome_fantasia || empresa.razao_social)) }
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
    } else { setMsg('Teste disponivel para Omie e Nibo') }
    setTimeout(() => setMsg(''), 5000)
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
        else { const total = Object.values(data.counts || {}).reduce((s: number, v: any) => s + (Number(v) || 0), 0); setMsg('Omie: ' + total + ' registros importados!'); loadEmpresa(empresa) }
      } else if (conId === 'nibo') {
        const apiKey = configs['nibo_api_key']; const orgId = configs['nibo_org_id']; const apiSecret = configs['nibo_api_secret']
        if (!apiKey || !orgId) { setMsg('Salve as credenciais primeiro'); setSyncing(false); return }
        const res = await fetch('/api/nibo/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company_id: empresa.id, nibo_api_key: apiKey, nibo_api_secret: apiSecret, nibo_org_id: orgId }) })
        const data = await res.json()
        if (data.error) setMsg('Erro: ' + data.error)
        else { setMsg(data.message || 'Nibo sync OK!'); loadEmpresa(empresa) }
      } else { setMsg('Sync disponivel para Omie e Nibo') }
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

      {/* EMPRESA SELECTOR */}
      <div style={{ background: C.card, borderRadius: 10, padding: 14, marginBottom: 14, borderLeft: '3px solid ' + C.tl, border: '1px solid ' + C.bd }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 9, color: C.txd, marginBottom: 3 }}>Empresa (salva credenciais por empresa)</div>
            <select value={empresaSel} onChange={e => selectEmpresa(e.target.value)} style={{ background: C.bg, border: '1px solid ' + C.bd, color: C.tx, padding: '8px 12px', borderRadius: 6, fontSize: 12, minWidth: 250 }}>
              {grupos.map(g => {
                const emps = companies.filter(c => c.group_id === g.id)
                if (emps.length === 0) return null
                return (<optgroup key={g.id} label={'📁 ' + g.nome}>
                  {emps.map(e => <option key={e.id} value={e.id}>{e.nome_fantasia || e.razao_social}</option>)}
                </optgroup>)
              })}
              {companies.filter(c => !c.group_id || !grupos.find(g => g.id === c.group_id)).map(c => (
                <option key={c.id} value={c.id}>{c.nome_fantasia || c.razao_social}</option>
              ))}
            </select>
          </div>
          {empresa && (
            <div style={{ fontSize: 10, color: C.txm }}>
              <span style={{ color: C.go, fontWeight: 600 }}>{empresa.cnpj || 'Sem CNPJ'}</span>
              {' | Ultima sync: '}<span style={{ color: lastSync === 'Nunca' ? C.r : C.g }}>{lastSync}</span>
              {syncCount > 0 && <span> | {syncCount} imports</span>}
            </div>
          )}
        </div>
      </div>

      {msg && <div style={{ background: msg.includes('Erro') || msg.includes('Preencha') ? C.r + '15' : C.g + '15', border: '1px solid ' + (msg.includes('Erro') || msg.includes('Preencha') ? C.r : C.g) + '30', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: msg.includes('Erro') || msg.includes('Preencha') ? C.r : C.g }}>{msg}</div>}

      {/* FILTROS */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={() => setFiltro('todos')} style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: 600, border: filtro === 'todos' ? '1px solid ' + C.go : '1px solid ' + C.bd, background: filtro === 'todos' ? C.go + '10' : 'transparent', color: filtro === 'todos' ? C.gol : C.txm }}>Todos ({stats.total})</button>
        {CATS.map(cat => {
          const count = CONNECTORS.filter(c => c.cat === cat.id).length
          return <button key={cat.id} onClick={() => setFiltro(cat.id)} style={{ padding: '4px 10px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontWeight: 600, border: filtro === cat.id ? '1px solid ' + C.go : '1px solid ' + C.bd, background: filtro === cat.id ? C.go + '10' : 'transparent', color: filtro === cat.id ? C.gol : C.txm }}>{cat.icon} {cat.nome} ({count})</button>
        })}
      </div>

      {/* GRID */}
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
              <span style={{ fontSize: 8, padding: '2px 8px', borderRadius: 4, background: statusCor(con.status) + '15', color: statusCor(con.status), fontWeight: 600, border: '1px solid ' + statusCor(con.status) + '30' }}>{statusLabel(con.status)}</span>
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
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <button onClick={() => salvar(con.id)} disabled={saving || con.status !== 'ativo'} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: con.status === 'ativo' ? C.go : C.bd, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                        {saving ? '...' : 'Salvar'}
                      </button>
                      {con.status === 'ativo' && (
                        <>
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

      <div style={{ fontSize: 8, color: C.txd, textAlign: 'center', marginTop: 20 }}>PS Gestao e Capital — Central de Conectores v8.7.4 | {stats.total} conectores | 10 categorias</div>
    </div>
  )
}
