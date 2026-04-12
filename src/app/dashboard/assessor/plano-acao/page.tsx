'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = { bg: '#0F0F0F', card: '#1A1410', border: '#2A2822', gold: '#C8941A', text: '#FAF7F2', muted: '#B0AB9F', green: '#4CAF50', red: '#EF5350', yellow: '#FFC107', blue: '#42A5F5', teal: '#009688' }

interface Acao { id?: string; titulo: string; descricao: string; responsavel: string; prazo: string; prioridade: 'alta' | 'media' | 'baixa'; status: 'pendente' | 'andamento' | 'concluida' | 'atrasada'; categoria: string; percentual: number; cliente_id?: string; assessoria_id?: string }

const CATEGORIAS = ['Financeiro', 'Comercial', 'Operacional', 'RH', 'Fiscal', 'Estrategico', 'Custos', 'Processos']

export default function PlanoAcaoPage() {
  const [acoes, setAcoes] = useState<Acao[]>([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Acao>({ titulo: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media', status: 'pendente', categoria: 'Financeiro', percentual: 0 })
  const [filtroStatus, setFiltroStatus] = useState('todos')

  useEffect(() => {
    // Dados simulados
    const sim: Acao[] = [
      { id: '1', titulo: 'Reduzir CMV em 5%', descricao: 'Renegociar com 3 maiores fornecedores de MP', responsavel: 'Diretor Compras', prazo: '2026-05-15', prioridade: 'alta', status: 'andamento', categoria: 'Custos', percentual: 40 },
      { id: '2', titulo: 'Implantar controle de estoque', descricao: 'Sistema FIFO/FEFO para pereciveis', responsavel: 'Gerente Logistica', prazo: '2026-05-30', prioridade: 'alta', status: 'pendente', categoria: 'Operacional', percentual: 0 },
      { id: '3', titulo: 'Revisar pricing cortes nobres', descricao: 'Analise de margem por SKU e ajuste de tabela', responsavel: 'Gerente Comercial', prazo: '2026-04-30', prioridade: 'media', status: 'atrasada', categoria: 'Comercial', percentual: 60 },
      { id: '4', titulo: 'Adequar folha de pagamento', descricao: 'Regularizar 55% dos pagamentos por fora', responsavel: 'RH + Contabilidade', prazo: '2026-06-30', prioridade: 'alta', status: 'pendente', categoria: 'Fiscal', percentual: 0 },
      { id: '5', titulo: 'Reduzir quebra desossa para 2%', descricao: 'Treinamento equipe + ajuste de facas', responsavel: 'Supervisor Desossa', prazo: '2026-05-10', prioridade: 'media', status: 'andamento', categoria: 'Operacional', percentual: 70 },
      { id: '6', titulo: 'Mapear fluxo de caixa semanal', descricao: 'DFC semanal com projecao 4 semanas', responsavel: 'Controller', prazo: '2026-04-20', prioridade: 'alta', status: 'concluida', categoria: 'Financeiro', percentual: 100 },
    ]
    setAcoes(sim)
  }, [])

  const filtered = acoes.filter(a => filtroStatus === 'todos' || a.status === filtroStatus)
  const total = acoes.length
  const concluidas = acoes.filter(a => a.status === 'concluida').length
  const atrasadas = acoes.filter(a => a.status === 'atrasada').length
  const andamento = acoes.filter(a => a.status === 'andamento').length
  const pctGeral = total > 0 ? Math.round(acoes.reduce((s, a) => s + a.percentual, 0) / total) : 0

  const stColor = (s: string) => s === 'concluida' ? C.green : s === 'atrasada' ? C.red : s === 'andamento' ? C.blue : C.muted
  const stLabel = (s: string) => s === 'concluida' ? 'Concluida' : s === 'atrasada' ? 'Atrasada' : s === 'andamento' ? 'Em Andamento' : 'Pendente'
  const prioColor = (p: string) => p === 'alta' ? C.red : p === 'media' ? C.yellow : C.green

  const addAcao = () => {
    setAcoes([...acoes, { ...form, id: 'n' + Date.now(), percentual: 0, status: 'pendente' }])
    setShowForm(false)
    setForm({ titulo: '', descricao: '', responsavel: '', prazo: '', prioridade: 'media', status: 'pendente', categoria: 'Financeiro', percentual: 0 })
  }

  const updateStatus = (id: string, status: string) => {
    setAcoes(acoes.map(a => a.id === id ? { ...a, status: status as Acao['status'], percentual: status === 'concluida' ? 100 : a.percentual } : a))
  }

  const inputSt: React.CSSProperties = { background: C.bg, border: '1px solid ' + C.border, color: C.text, padding: '8px 12px', borderRadius: 6, fontSize: 12, width: '100%' }

  return (
    <div style={{ padding: 16, minHeight: '100vh', background: C.bg, color: C.text }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.gold, margin: 0 }}>Plano de Acao Monitorado</h1>
          <div style={{ fontSize: 11, color: C.muted }}>PS Assessor | Acompanhamento de acoes do cliente</div>
        </div>
        <button onClick={() => setShowForm(!showForm)} style={{ background: C.gold, color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>
          + Nova Acao
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Total Acoes', val: String(total), color: C.gold },
          { label: 'Concluidas', val: String(concluidas), color: C.green },
          { label: 'Em Andamento', val: String(andamento), color: C.blue },
          { label: 'Atrasadas', val: String(atrasadas), color: C.red },
          { label: 'Progresso Geral', val: pctGeral + '%', color: pctGeral > 70 ? C.green : pctGeral > 40 ? C.yellow : C.red },
        ].map((s, i) => (
          <div key={i} style={{ background: C.card, borderRadius: 8, padding: 12, borderTop: '3px solid ' + s.color, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 9, color: C.muted }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar geral */}
      <div style={{ background: C.card, borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: C.gold, fontWeight: 700 }}>Progresso Geral do Plano</span>
          <span style={{ color: C.gold }}>{pctGeral}%</span>
        </div>
        <div style={{ height: 12, background: C.border, borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pctGeral + '%', background: pctGeral > 70 ? C.green : pctGeral > 40 ? C.yellow : C.red, borderRadius: 6, transition: '0.5s' }} />
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {['todos', 'pendente', 'andamento', 'atrasada', 'concluida'].map(s => (
          <button key={s} onClick={() => setFiltroStatus(s)} style={{
            padding: '6px 14px', borderRadius: 16, border: 'none', fontSize: 11, cursor: 'pointer', fontWeight: 600,
            background: filtroStatus === s ? C.gold : C.card, color: filtroStatus === s ? '#3D2314' : C.muted,
          }}>{s === 'todos' ? 'Todos' : stLabel(s)}</button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: C.card, borderRadius: 8, padding: 16, marginBottom: 12, borderLeft: '3px solid ' + C.gold }}>
          <div style={{ fontWeight: 700, color: C.gold, marginBottom: 10 }}>Nova Acao</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Titulo</div><input value={form.titulo} onChange={e => setForm({...form, titulo: e.target.value})} style={inputSt} /></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Responsavel</div><input value={form.responsavel} onChange={e => setForm({...form, responsavel: e.target.value})} style={inputSt} /></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Prazo</div><input type="date" value={form.prazo} onChange={e => setForm({...form, prazo: e.target.value})} style={inputSt} /></div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Categoria</div>
              <select value={form.categoria} onChange={e => setForm({...form, categoria: e.target.value})} style={inputSt}>
                {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Prioridade</div>
              <select value={form.prioridade} onChange={e => setForm({...form, prioridade: e.target.value as Acao['prioridade']})} style={inputSt}>
                <option value="alta">Alta</option><option value="media">Media</option><option value="baixa">Baixa</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>Descricao</div>
            <textarea value={form.descricao} onChange={e => setForm({...form, descricao: e.target.value})} rows={2} style={{ ...inputSt, resize: 'vertical' }} />
          </div>
          <button onClick={addAcao} disabled={!form.titulo} style={{ background: C.green, color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 6, fontWeight: 700, cursor: 'pointer' }}>Salvar Acao</button>
        </div>
      )}

      {/* Lista de Acoes */}
      {filtered.map(a => (
        <div key={a.id} style={{ background: C.card, borderRadius: 8, padding: 14, marginBottom: 8, borderLeft: '3px solid ' + stColor(a.status) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{a.titulo}</div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{a.descricao}</div>
            </div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 10px', borderRadius: 12, background: prioColor(a.prioridade) + '20', color: prioColor(a.prioridade), whiteSpace: 'nowrap', flexShrink: 0 }}>
              {a.prioridade.toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.muted, marginBottom: 8, flexWrap: 'wrap' }}>
            <span>Responsavel: <b style={{ color: C.text }}>{a.responsavel}</b></span>
            <span>Prazo: <b style={{ color: new Date(a.prazo) < new Date() && a.status !== 'concluida' ? C.red : C.text }}>{a.prazo ? new Date(a.prazo + 'T12:00:00').toLocaleDateString('pt-BR') : '-'}</b></span>
            <span>Categoria: <b style={{ color: C.gold }}>{a.categoria}</b></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: a.percentual + '%', background: stColor(a.status), borderRadius: 4, transition: '0.3s' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: stColor(a.status), minWidth: 35 }}>{a.percentual}%</span>
            <select value={a.status} onChange={e => updateStatus(a.id || '', e.target.value)} style={{ background: C.bg, border: '1px solid ' + C.border, color: stColor(a.status), padding: '4px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>
              <option value="pendente">Pendente</option>
              <option value="andamento">Em Andamento</option>
              <option value="concluida">Concluida</option>
              <option value="atrasada">Atrasada</option>
            </select>
          </div>
        </div>
      ))}
    </div>
  )
}