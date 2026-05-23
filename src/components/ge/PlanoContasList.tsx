'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import PlanoContasForm, { type ContaPlano } from './PlanoContasForm'

export default function PlanoContasList({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [contas, setContas] = useState<ContaPlano[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ContaPlano | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'receita' | 'despesa'>('todos')
  const [aplicando, setAplicando] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('erp_plano_contas')
      .select('id, codigo, descricao, grupo, tipo, pai_codigo, nivel, ativo')
      .eq('company_id', companyId)
      .order('codigo')
    if (data) setContas(data as ContaPlano[])
    setLoading(false)
  }

  useEffect(() => {
    if (companyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function handleAplicarPadrao() {
    if (!confirm('Aplicar 15 contas padrão DRE? Contas já existentes não duplicam.')) return
    setAplicando(true)
    const { data, error } = await supabase.rpc('fn_plano_contas_aplicar_sugestoes_padrao', {
      p_company_id: companyId,
    })
    setAplicando(false)
    if (error) {
      alert('Erro: ' + error.message)
      return
    }
    const result = data as { sem_plano?: boolean; mensagem?: string } | null
    if (result?.sem_plano) {
      alert('Empresa sem plano GE ativo')
      return
    }
    alert(result?.mensagem ?? 'Plano padrão aplicado')
    load()
  }

  async function handleToggleAtivo(c: ContaPlano) {
    await supabase.from('erp_plano_contas').update({ ativo: !c.ativo }).eq('id', c.id)
    load()
  }

  const filtradas = contas.filter((c) => filtroTipo === 'todos' || c.tipo === filtroTipo)
  const qtdRec = contas.filter((c) => c.tipo === 'receita' && c.ativo).length
  const qtdDesp = contas.filter((c) => c.tipo === 'despesa' && c.ativo).length

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.5)' }}>Carregando plano de contas…</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '32px 28px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Cadastros · Gestão Empresarial
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
            Plano de Contas
          </h1>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4, maxWidth: 560 }}>
            Hierarquia DRE de receitas e despesas. Usada em lançamentos e relatórios.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {contas.length === 0 && (
            <button
              type="button"
              onClick={handleAplicarPadrao}
              disabled={aplicando}
              style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: aplicando ? 'wait' : 'pointer' }}
            >
              {aplicando ? 'Aplicando…' : '✨ Aplicar plano padrão'}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            + Nova conta
          </button>
        </div>
      </div>

      <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '14px 18px', marginBottom: 20, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Tab label={`Todas (${contas.filter((c) => c.ativo).length})`} ativo={filtroTipo === 'todos'} onClick={() => setFiltroTipo('todos')} cor="#3D2314" />
        <Tab label={`Receitas (${qtdRec})`} ativo={filtroTipo === 'receita'} onClick={() => setFiltroTipo('receita')} cor="#3B6D11" />
        <Tab label={`Despesas (${qtdDesp})`} ativo={filtroTipo === 'despesa'} onClick={() => setFiltroTipo('despesa')} cor="#A32D2D" />
      </div>

      {filtradas.length === 0 ? (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: 60, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }} aria-hidden>📊</div>
          <div style={{ fontSize: 14, color: 'rgba(61,35,20,0.65)', marginBottom: 16 }}>
            {contas.length === 0
              ? 'Plano de contas vazio. Aplique o padrão para começar.'
              : 'Sem contas nesse filtro.'}
          </div>
          {contas.length === 0 && (
            <button
              type="button"
              onClick={handleAplicarPadrao}
              disabled={aplicando}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: aplicando ? 'wait' : 'pointer' }}
            >
              {aplicando ? 'Aplicando…' : '✨ Aplicar 15 contas padrão (DRE)'}
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtradas.map((c) => (
            <CardConta
              key={c.id}
              conta={c}
              onEditar={() => {
                setEditing(c)
                setShowForm(true)
              }}
              onToggleAtivo={() => handleToggleAtivo(c)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 32, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao Dashboard
        </button>
      </div>

      {showForm && (
        <PlanoContasForm
          companyId={companyId}
          conta={editing}
          contasExistentes={contas}
          onClose={() => {
            setShowForm(false)
            setEditing(null)
          }}
          onSaved={() => {
            setShowForm(false)
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function Tab({ label, ativo, onClick, cor }: { label: string; ativo: boolean; onClick: () => void; cor: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: ativo ? cor : 'transparent',
        color: ativo ? '#FAF7F2' : '#3D2314',
        border: `0.5px solid ${ativo ? cor : 'rgba(61,35,20,0.15)'}`,
        padding: '6px 14px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function CardConta({ conta, onEditar, onToggleAtivo }: { conta: ContaPlano; onEditar: () => void; onToggleAtivo: () => void }) {
  const isNivel1 = conta.nivel === 1
  const indent = isNivel1 ? 0 : 24
  const corBarra = conta.tipo === 'receita' ? '#3B6D11' : '#A32D2D'

  return (
    <div
      style={{
        background: isNivel1 ? 'rgba(61,35,20,0.04)' : '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.1)',
        borderRadius: 8,
        padding: '10px 14px',
        marginLeft: indent,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        opacity: conta.ativo ? 1 : 0.5,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: 4, height: 28, borderRadius: 4, background: corBarra, flexShrink: 0 }} />
      <div style={{ minWidth: 70, fontSize: 12, color: 'rgba(61,35,20,0.7)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {conta.codigo}
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <span style={{ fontSize: 13, fontWeight: isNivel1 ? 600 : 400, color: '#3D2314' }}>
          {conta.descricao}
        </span>
        {conta.grupo && (
          <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'rgba(200,148,26,0.15)', color: '#854F0B', fontWeight: 600, textTransform: 'capitalize' }}>
            {conta.grupo.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" onClick={onEditar} style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
          Editar
        </button>
        <button
          type="button"
          onClick={onToggleAtivo}
          style={{ background: 'transparent', color: conta.ativo ? '#A32D2D' : '#3B6D11', border: `0.5px solid ${conta.ativo ? '#A32D2D' : '#3B6D11'}`, padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          {conta.ativo ? 'Inativar' : 'Ativar'}
        </button>
      </div>
    </div>
  )
}
