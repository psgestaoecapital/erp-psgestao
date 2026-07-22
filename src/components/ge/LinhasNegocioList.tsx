'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import LdnBudgetForm, { type LDNRef } from './LdnBudgetForm'

interface LDN {
  id: string
  nome: string
  descricao: string | null
  cor: string | null
  ordem: number | null
  ativo: boolean
}

interface BudgetAgregado {
  receita_anual: number
  despesa_anual: number
}

const CORES_SUGERIDAS = [
  '#C8941A', '#3D2314', '#3B6D11', '#BA7517',
  '#A32D2D', '#3B82F6', '#8B5CF6', '#14B8A6',
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '0.5px solid rgba(61,35,20,0.25)',
  borderRadius: 6,
  fontSize: 14,
  color: '#3D2314',
  background: '#FFFFFF',
  boxSizing: 'border-box',
}

function fmt(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function LinhasNegocioList({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [ldns, setLdns] = useState<LDN[]>([])
  const [budgets, setBudgets] = useState<Record<string, BudgetAgregado>>({})
  const [loading, setLoading] = useState(true)
  const [showBudgetForm, setShowBudgetForm] = useState<{ ldn: LDNRef } | null>(null)
  const [showLdnForm, setShowLdnForm] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novaCor, setNovaCor] = useState(CORES_SUGERIDAS[0])
  const [salvandoLdn, setSalvandoLdn] = useState(false)
  const [erroLdn, setErroLdn] = useState<string | null>(null)

  const anoAtual = new Date().getFullYear()

  async function load() {
    setLoading(true)
    // RD-52: business_lines é a fonte da verdade (o agro lê daqui). Mapeia p/ o shape LDN da tela.
    const { data: blData } = await supabase
      .from('business_lines')
      .select('id, name, descricao, cor, ln_number, is_active')
      .eq('company_id', companyId)
      .order('ln_number', { nullsFirst: false })

    if (blData) {
      setLdns((blData as { id: string; name: string; descricao: string | null; cor: string | null; ln_number: number | null; is_active: boolean | null }[])
        .map((b) => ({ id: b.id, nome: b.name, descricao: b.descricao ?? null, cor: b.cor ?? null, ordem: b.ln_number ?? null, ativo: b.is_active ?? true })))
      const { data: budgetsData } = await supabase
        .from('linhas_negocio_budget')
        .select('linha_id, receita_budget, despesa_budget')
        .eq('empresa_id', companyId)
        .eq('ano', anoAtual)

      const agg: Record<string, BudgetAgregado> = {}
      ;(budgetsData ?? []).forEach((b: { linha_id: string; receita_budget: number | null; despesa_budget: number | null }) => {
        const slot = agg[b.linha_id] ?? { receita_anual: 0, despesa_anual: 0 }
        slot.receita_anual += Number(b.receita_budget ?? 0)
        slot.despesa_anual += Number(b.despesa_budget ?? 0)
        agg[b.linha_id] = slot
      })
      setBudgets(agg)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (companyId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function handleCriarLDN() {
    if (!novoNome.trim()) {
      setErroLdn('Dá um nome para essa divisão')
      return
    }
    setSalvandoLdn(true)
    setErroLdn(null)
    // RD-52: grava em business_lines. ln_number é obrigatório (1..12, único por empresa) —
    // escolhe o menor livre.
    const usados = new Set(ldns.map((l) => l.ordem).filter((n): n is number => typeof n === 'number'))
    let prox = 1
    while (prox <= 12 && usados.has(prox)) prox++
    if (prox > 12) {
      setErroLdn('Limite de 12 divisões por empresa atingido.')
      setSalvandoLdn(false)
      return
    }
    const { error } = await supabase.from('business_lines').insert({
      company_id: companyId,
      name: novoNome.trim(),
      cor: novaCor,
      is_active: true,
      ln_number: prox,
    })
    setSalvandoLdn(false)
    if (error) {
      setErroLdn('Não consegui criar: ' + error.message)
      return
    }
    setShowLdnForm(false)
    setNovoNome('')
    setNovaCor(CORES_SUGERIDAS[0])
    load()
  }

  async function handleToggleAtivo(ldn: LDN) {
    // RD-52: business_lines usa is_active
    await supabase.from('business_lines').update({ is_active: !ldn.ativo }).eq('id', ldn.id)
    load()
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'rgba(61,35,20,0.65)' }}>Carregando divisões…</div>
  }

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            Cadastros · Gestão Empresarial
          </div>
          <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 26, color: '#3D2314', margin: 0, fontWeight: 400 }}>
            Divisões da empresa
          </h1>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.65)', marginTop: 4, maxWidth: 560 }}>
            Áreas separadas de receita e despesa (ex: Tintas · Gesso · Consultoria · Imóveis). Necessário para ver DRE de cada divisão.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowLdnForm(true)}
          style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 22px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          + Nova divisão
        </button>
      </div>

      {ldns.length === 0 && !showLdnForm && (
        <div style={{ background: 'rgba(200,148,26,0.1)', border: '0.5px solid rgba(200,148,26,0.4)', borderRadius: 8, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#854F0B' }}>
          💡 <strong>Divisão é opcional.</strong> Se sua empresa tem 1 negócio só, pode pular esse cadastro. Use quando tem 2 ou mais áreas e quer ver performance separada de cada uma no DRE.
        </div>
      )}

      {showLdnForm && (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
          <h3 style={{ margin: 0, marginBottom: 14, fontSize: 14, color: '#3D2314', fontWeight: 600 }}>
            Nova divisão
          </h3>
          {erroLdn && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erroLdn}</div>
          )}
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            placeholder="Ex: Tintas · Gesso · Consultoria · Imóveis · Serviços"
            style={{ ...inputStyle, marginBottom: 12 }}
          />
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, fontWeight: 700 }}>
              Cor (para identificar nos gráficos)
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CORES_SUGERIDAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setNovaCor(c)}
                  aria-label={`Cor ${c}`}
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: c, cursor: 'pointer',
                    border: novaCor === c ? '3px solid #3D2314' : '0.5px solid rgba(61,35,20,0.2)',
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => { setShowLdnForm(false); setNovoNome(''); setErroLdn(null) }}
              disabled={salvandoLdn}
              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleCriarLDN}
              disabled={salvandoLdn}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvandoLdn ? 'wait' : 'pointer' }}
            >
              {salvandoLdn ? 'Criando…' : 'Criar divisão'}
            </button>
          </div>
        </div>
      )}

      {ldns.length === 0 && !showLdnForm ? (
        <div style={{ background: '#FFFFFF', borderRadius: 12, padding: 50, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 14 }}>
          Você ainda não cadastrou divisões. Clique em “+ Nova divisão” se sua empresa tem múltiplas áreas.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ldns.map((ldn) => (
            <CardLDN
              key={ldn.id}
              ldn={ldn}
              budget={budgets[ldn.id] ?? { receita_anual: 0, despesa_anual: 0 }}
              ano={anoAtual}
              onConfigBudget={() => setShowBudgetForm({ ldn: { id: ldn.id, nome: ldn.nome, cor: ldn.cor } })}
              onToggleAtivo={() => handleToggleAtivo(ldn)}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: 28, textAlign: 'center' }}>
        <button
          type="button"
          onClick={() => router.push('/dashboard/gestao-empresarial')}
          style={{ background: 'transparent', color: '#C8941A', border: '0.5px solid #C8941A', padding: '10px 22px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          ← Voltar ao painel
        </button>
      </div>

      {showBudgetForm && (
        <LdnBudgetForm
          companyId={companyId}
          ldn={showBudgetForm.ldn}
          ano={anoAtual}
          onClose={() => setShowBudgetForm(null)}
          onSaved={() => { setShowBudgetForm(null); load() }}
        />
      )}
    </div>
  )
}

function CardLDN({
  ldn, budget, ano, onConfigBudget, onToggleAtivo,
}: {
  ldn: LDN
  budget: BudgetAgregado
  ano: number
  onConfigBudget: () => void
  onToggleAtivo: () => void
}) {
  const margemAnual = budget.receita_anual - budget.despesa_anual
  const temBudget = budget.receita_anual > 0 || budget.despesa_anual > 0
  const corMargem = margemAnual >= 0 ? '#3B6D11' : '#A32D2D'

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: '0.5px solid rgba(61,35,20,0.12)',
        borderRadius: 12,
        padding: '18px 22px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        opacity: ldn.ativo ? 1 : 0.5,
        flexWrap: 'wrap',
      }}
    >
      <div style={{ width: 6, height: 56, borderRadius: 4, background: ldn.cor || '#C8941A', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#3D2314', marginBottom: 4 }}>{ldn.nome}</div>
        {temBudget ? (
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.6)' }}>
            Planejado {ano}: Receita R$ {fmt(budget.receita_anual)} · Despesa R$ {fmt(budget.despesa_anual)} · Margem{' '}
            <strong style={{ color: corMargem }}>R$ {fmt(margemAnual)}</strong>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)', fontStyle: 'italic' }}>
            Sem planejamento de {ano} · clique “Definir planejado” para começar
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onConfigBudget}
          style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
        >
          {temBudget ? 'Ajustar planejado' : 'Definir planejado'}
        </button>
        <button
          type="button"
          onClick={onToggleAtivo}
          style={{ background: 'transparent', color: ldn.ativo ? '#A32D2D' : '#3B6D11', border: `0.5px solid ${ldn.ativo ? '#A32D2D' : '#3B6D11'}`, padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
        >
          {ldn.ativo ? 'Inativar' : 'Ativar'}
        </button>
      </div>
    </div>
  )
}
