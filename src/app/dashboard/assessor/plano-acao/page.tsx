'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

interface Acao { id?: string; acao: string; responsavel: string; prazo: string; prioridade: string; status: string; categoria: string; impacto_esperado: string; observacoes: string; company_id?: string; percentual?: number }

const CATEGORIAS = ['Financeiro', 'Comercial', 'Operacional', 'RH', 'Fiscal', 'Estrategico', 'Custos', 'Processos']
const PRIORIDADES = ['alta', 'media', 'baixa']

export default function PlanoAcaoPage() {
  const [acoes, setAcoes] = useState<Acao[]>([])
  const [empresas, setEmpresas] = useState<any[]>([])
  const [empresaSel, setEmpresaSel] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Acao>({ acao: '', responsavel: '', prazo: '', prioridade: 'media', status: 'pendente', categoria: 'Financeiro', impacto_esperado: '', observacoes: '' })
  const [filtroStatus, setFiltroStatus] = useState('todos')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  useEffect(() => { loadEmpresas() }, [])
  useEffect(() => { if (empresaSel) loadAcoes() }, [empresaSel])

  const loadEmpresas = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }
    const { data: up } = await supabase.from('users').select('role').eq('id', user.id).single()
    let comps: any[] = []
    if (up?.role === 'adm' || up?.role === 'acesso_total') {
      const { data } = await supabase.from('companies').select('id, nome_fantasia, razao_social').order('nome_fantasia')
      comps = data || []
    } else {
      const { data: uc } = await supabase.from('user_companies').select('companies(id, nome_fantasia, razao_social)').eq('user_id', user.id)
      comps = (uc || []).map((u: any) => u.companies).filter(Boolean)
    }
    // Also load clientes_assessoria
    const { data: clientes } = await supabase.from('clientes_assessoria').select('id, nome, cnpj').eq('status', 'ativo').order('nome')
    const all = [
      ...comps.map((c: any) => ({ id: c.id, nome: c.nome_fantasia || c.razao_social || 'Sem nome', fonte: 'companies' })),
      ...(clientes || []).filter((c: any) => !comps.some((comp: any) => comp.id === c.id)).map((c: any) => ({ id: c.id, nome: c.nome + (c.cnpj ? ' (' + c.cnpj + ')' : ''), fonte: 'assessoria' })),
    ]
    setEmpresas(all)
    if (all.length > 0) {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('ps_empresa_sel') : ''
      const match = all.find(e => e.id === saved)
      setEmpresaSel(match ? match.id : all[0].id)
    }
    setLoading(false)
  }

  const loadAcoes = async () => {
    const { data } = await supabase.from('plano_acao').select('*').eq('company_id', empresaSel).order('created_at', { ascending: false })
    setAcoes((data || []).map((a: any) => ({ ...a, percentual: a.status === 'concluida' ? 100 : a.status === 'andamento' ? 50 : a.status === 'atrasada' ? 30 : 0 })))
  }

  const saveAcao = async () => {
    if (!form.acao.trim()) return
    const payload = { ...form, company_id: empresaSel }
    let ok = false
    if (editId) {
      const { error } = await supabase.from('plano_acao').update(payload).eq('id', editId)
      ok = !error
    } else {
      const { error } = await supabase.from('plano_acao').insert(payload)
      ok = !error
    }
    if (ok) {
      setMsg(editId ? 'Acao atualizada!' : 'Acao criada!')
      setShowForm(false)
      setEditId(null)
      setForm({ acao: '', responsavel: '', prazo: '', prioridade: 'media', status: 'pendente', categoria: 'Financeiro', impacto_esperado: '', observacoes: '' })
      loadAcoes()
    } else { setMsg('Erro ao salvar') }
    setTimeout(() => setMsg(''), 3000)
  }

  const deleteAcao = async (id: string) => {
    if (!confirm('Excluir esta acao?')) return
    await supabase.from('plano_acao').delete().eq('id', id)
    loadAcoes()
    setMsg('Acao excluida')
    setTimeout(() => setMsg(''), 3000)
  }

  const updateStatus = async (id: string, status: string) => {
    await supabase.from('plano_acao').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    loadAcoes()
  }

  const editAcao = (a: Acao) => {
    setForm({ acao: a.acao, responsavel: a.responsavel || '', prazo: a.prazo || '', prioridade: a.prioridade || 'media', status: a.status || 'pendente', categoria: a.categoria || 'Financeiro', impacto_esperado: a.impacto_esperado || '', observacoes: a.observacoes || '' })
    setEditId(a.id || null)
    setShowForm(true)
  }

  const filtered = acoes.filter(a => filtroStatus === 'todos' || a.status === filtroStatus)
  const total = acoes.length
  const concluidas = acoes.filter(a => a.status === 'concluida').length
  const atrasadas = acoes.filter(a => a.status === 'atrasada').length
  const andamento = acoes.filter(a => a.status === 'andamento').length
  const pctGeral = total > 0 ? Math.round(acoes.reduce((s, a) => s + (a.percentual || 0), 0) / total) : 0

  const stColor = (s: string) => s === 'concluida' ? C.green : s === 'atrasada' ? C.red : s === 'andamento' ? C.blue : C.muted
  const stLabel = (s: string) => s === 'concluida' ? 'Concluida' : s === 'atrasada' ? 'Atrasada' : s === 'andamento' ? 'Em Andamento' : 'Pendente'
  const prioColor = (p: string) => p === 'alta' ? C.red : p === 'media' ? C.yellow : C.green
  const inputSt: React.CSSProperties = { background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 12, width: '100%' }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: C.muted, background: C.bg, minHeight: '100vh' }}>Carregando...</div>

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>Plano de Acao Monitorado</h1>
          <div style={{ fontSize: 11, color: C.muted }}>PS Assessor | Acoes salvas no Supabase</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={empresaSel} onChange={e => { setEmpresaSel(e.target.value); if (typeof window !== 'undefined') localStorage.setItem('ps_empresa_sel', e.target.value) }} style={{ ...inputSt, width: 200 }}>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ acao: '', responsavel: '', prazo: '', prioridade: 'media', status: 'pendente', categoria: 'Financeiro', impacto_esperado: '', observacoes: '' }) }} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            + Nova Acao
          </button>
        </div>
      </div>

      {msg && <div onClick={() => setMsg('')} style={{ padding: 10, borderRadius: 8, background: msg.includes('Erro') ? C.red + '15' : C.green + '15', color: msg.includes('Erro') ? C.red : C.green, fontSize: 12, marginBottom: 10, cursor: 'pointer' }}>{msg}</div>}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Total', val: String(total), color: C.gold },
          { label: 'Concluidas', val: String(concluidas), color: C.green },
          { label: 'Andamento', val: String(andamento), color: C.blue },
          { label: 'Atrasadas', val: String(atrasadas), color: C.red },
          { label: 'Progresso', val: pctGeral + '%', color: pctGeral > 70 ? C.green : pctGeral > 40 ? C.yellow : C.red },
        ].map((s, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 8, padding: 12, borderTop: '3px solid ' + s.color, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 9, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Barra progresso */}
      <div style={{ background: C.card, borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: C.gold, fontWeight: 700 }}>Progresso Geral</span>
          <span style={{ color: C.gold }}>{pctGeral}%</span>
        </div>
        <div style={{ height: 12, background: C.border, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pctGeral + '%', background: pctGeral > 70 ? C.green : pctGeral > 40 ? C.yellow : C.red, borderRadius: 6, transition: '0.5s' }} />
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {['todos', 'pendente', 'andamento', 'atrasada', 'concluida'].map(s => (
          <button key={s} onClick={() => setFiltroStatus(s)} style={{ padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 11, cursor: 'pointer', fontWeight: 600, background: filtroStatus === s ? C.gold : C.card, color: filtroStatus === s ? '#3D2314' : C.muted }}>{s === 'todos' ? 'Todos (' + total + ')' : stLabel(s)}</button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: '3px solid ' + C.gold }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>{editId ? 'Editar Acao' : 'Nova Acao'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Titulo *</div><input value={form.acao} onChange={e => setForm({...form, acao: e.target.value})} style={inputSt} /></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Responsavel</div><input value={form.responsavel} onChange={e => setForm({...form, responsavel: e.target.value})} style={inputSt} /></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Prazo</div><input type="date" value={form.prazo} onChange={e => setForm({...form, prazo: e.target.value})} style={inputSt} /></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Categoria</div>
              <select value={form.categoria} onChange={e => setForm({...form, categoria: e.target.value})} style={inputSt}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Prioridade</div>
              <select value={form.prioridade} onChange={e => setForm({...form, prioridade: e.target.value})} style={inputSt}>
                {PRIORIDADES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Impacto Esperado</div><input value={form.impacto_esperado} onChange={e => setForm({...form, impacto_esperado: e.target.value})} placeholder="Ex: Reduzir custos em 15%" style={inputSt} /></div>
          </div>
          <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Observacoes</div>
            <textarea value={form.observacoes} onChange={e => setForm({...form, observacoes: e.target.value})} rows={2} style={{ ...inputSt, resize: 'vertical' }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={saveAcao} disabled={!form.acao} style={{ background: C.green, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>{editId ? 'Atualizar' : 'Salvar Acao'}</button>
            <button onClick={() => { setShowForm(false); setEditId(null) }} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, padding: '10px 20px', borderRadius: 6, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {filtered.length === 0 && !showForm && (
        <div style={{ background: C.card, borderRadius: 8, padding: 30, textAlign: 'center' }}>
          <div style={{ fontSize: 14, color: C.muted }}>Nenhuma acao {filtroStatus !== 'todos' ? 'com status "' + stLabel(filtroStatus) + '"' : 'cadastrada'}.</div>
          <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>Clique em "+ Nova Acao" para comecar.</div>
        </div>
      )}

      {filtered.map(a => (
        <div key={a.id} style={{ background: C.card, borderRadius: 8, padding: 14, marginBottom: 8, borderLeft: '3px solid ' + stColor(a.status) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.acao}</div>
              {a.impacto_esperado && <div style={{ fontSize: 11, color: C.teal, marginTop: 2 }}>Impacto: {a.impacto_esperado}</div>}
              {a.observacoes && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{a.observacoes}</div>}
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: prioColor(a.prioridade) + '20', color: prioColor(a.prioridade) }}>{(a.prioridade || 'media').toUpperCase()}</span>
              <button onClick={() => editAcao(a)} style={{ background: C.gold + '15', border: 'none', color: C.gold, padding: '3px 8px', borderRadius: 4, fontSize: 9, cursor: 'pointer' }}>Editar</button>
              <button onClick={() => deleteAcao(a.id || '')} style={{ background: C.red + '15', border: 'none', color: C.red, padding: '3px 8px', borderRadius: 4, fontSize: 9, cursor: 'pointer' }}>X</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.muted, marginBottom: 6, flexWrap: 'wrap' }}>
            <span>Responsavel: <b style={{ color: C.text }}>{a.responsavel || '-'}</b></span>
            <span>Prazo: <b style={{ color: a.prazo && new Date(a.prazo) < new Date() && a.status !== 'concluida' ? C.red : C.text }}>{a.prazo ? new Date(a.prazo + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</b></span>
            <span>Categoria: <b style={{ color: C.gold }}>{a.categoria}</b></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: (a.percentual || 0) + '%', background: stColor(a.status), borderRadius: 4, transition: '0.3s' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: stColor(a.status), minWidth: 35 }}>{a.percentual || 0}%</span>
            <select value={a.status} onChange={e => updateStatus(a.id || '', e.target.value)} style={{ background: C.bg, border: '1px solid ' + C.border, color: stColor(a.status), padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
              <option value="pendente">Pendente</option>
              <option value="andamento">Em Andamento</option>
              <option value="concluida">Concluida</option>
              <option value="atrasada">Atrasada</option>
            </select>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 10, color: C.muted, textAlign: 'center', marginTop: 16 }}>
        PS Gestao e Capital - Plano de Acao v8.6.1 | Dados persistidos no Supabase
      </div>
    </div>
  )
}