'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import LdnBudgetForm, { type LDNRef } from './LdnBudgetForm'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

// Componente compartilhado por /dashboard/cadastros/divisoes e /dashboard/cadastros/linhas-negocio.
// A ajuda (RD-95 "?") usa chaves cadastradas na rota canônica abaixo, passada explicitamente em cada
// AjudaCampo para carregar o mesmo texto em qualquer um dos dois pontos de montagem.
const ROTA_AJUDA = '/dashboard/cadastros/divisoes'

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

// Formulário compartilhado: criar nova divisão ou editar (nome + cor) uma existente.
type FormState = { modo: 'novo' } | { modo: 'editar'; ldn: LDN }

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

// Mensagem em linguagem do usuário para os erros comuns de gravação (RD-96: nunca o erro cru do banco).
function mensagemAmigavel(error: { message?: string; code?: string } | null, acao: string): string {
  const raw = (error?.message ?? '').toLowerCase()
  if (error?.code === '23505' || raw.includes('duplicate') || raw.includes('unique')) {
    return 'Já existe uma divisão com esse nome ou essa posição nesta empresa. Escolha outro nome.'
  }
  if (error?.code === '42501' || raw.includes('permission') || raw.includes('rls') || raw.includes('policy')) {
    return 'Você não tem permissão para alterar as divisões desta empresa. Fale com o administrador.'
  }
  return `Não consegui ${acao} agora. Tente de novo em instantes; se continuar, avise o suporte.`
}

export default function LinhasNegocioList({ companyId }: { companyId: string }) {
  const router = useRouter()
  const [ldns, setLdns] = useState<LDN[]>([])
  const [budgets, setBudgets] = useState<Record<string, BudgetAgregado>>({})
  const [loading, setLoading] = useState(true)
  const [showBudgetForm, setShowBudgetForm] = useState<{ ldn: LDNRef } | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [nomeForm, setNomeForm] = useState('')
  const [corForm, setCorForm] = useState(CORES_SUGERIDAS[0])
  const [salvandoLdn, setSalvandoLdn] = useState(false)
  const [erroLdn, setErroLdn] = useState<string | null>(null)
  // Confirmação antes de inativar (clique único sem confirmação já fez cliente inativar sem querer).
  const [confirmarInativar, setConfirmarInativar] = useState<string | null>(null)
  // Permite desfazer a última inativação na hora (rede de segurança).
  const [desfazer, setDesfazer] = useState<{ id: string; nome: string } | null>(null)

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

  function abrirNovo() {
    setForm({ modo: 'novo' })
    setNomeForm('')
    setCorForm(CORES_SUGERIDAS[0])
    setErroLdn(null)
  }

  function abrirEditar(ldn: LDN) {
    setForm({ modo: 'editar', ldn })
    setNomeForm(ldn.nome)
    setCorForm(ldn.cor || CORES_SUGERIDAS[0])
    setErroLdn(null)
  }

  function fecharForm() {
    setForm(null)
    setNomeForm('')
    setErroLdn(null)
  }

  async function handleSalvarLDN() {
    if (!form) return
    if (!nomeForm.trim()) {
      setErroLdn('Dá um nome para essa divisão')
      return
    }
    setSalvandoLdn(true)
    setErroLdn(null)

    if (form.modo === 'editar') {
      // RD-98 p2: editar nome + cor de uma divisão já criada. business_lines, escopo por RLS da empresa.
      const { error } = await supabase
        .from('business_lines')
        .update({ name: nomeForm.trim(), cor: corForm })
        .eq('id', form.ldn.id)
      setSalvandoLdn(false)
      if (error) {
        setErroLdn(mensagemAmigavel(error, 'salvar a alteração'))
        return
      }
      fecharForm()
      load()
      return
    }

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
      name: nomeForm.trim(),
      // type é obrigatório para a linha contar como OPERACIONAL no rateio/DRE Divisional.
      // Default 'servico', igual ao caminho oficial fn_psgc_cadastrar_ln (tipo || 'servico').
      type: 'servico',
      cor: corForm,
      is_active: true,
      ln_number: prox,
    })
    setSalvandoLdn(false)
    if (error) {
      setErroLdn(mensagemAmigavel(error, 'criar a divisão'))
      return
    }
    fecharForm()
    load()
  }

  async function inativar(ldn: LDN) {
    // RD-52: business_lines usa is_active
    await supabase.from('business_lines').update({ is_active: false }).eq('id', ldn.id)
    setConfirmarInativar(null)
    setDesfazer({ id: ldn.id, nome: ldn.nome })
    load()
  }

  async function reativar(id: string) {
    await supabase.from('business_lines').update({ is_active: true }).eq('id', id)
    setDesfazer(null)
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
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            onClick={abrirNovo}
            style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '12px 22px', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            + Nova divisão
          </button>
          <AjudaCampo chave="ge.divisoes.nova" rota={ROTA_AJUDA} />
        </div>
      </div>

      {ldns.length === 0 && !form && (
        <div style={{ background: 'rgba(200,148,26,0.1)', border: '0.5px solid rgba(200,148,26,0.4)', borderRadius: 8, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: '#854F0B' }}>
          💡 <strong>Divisão é opcional.</strong> Se sua empresa tem 1 negócio só, pode pular esse cadastro. Use quando tem 2 ou mais áreas e quer ver performance separada de cada uma no DRE.
        </div>
      )}

      {form && (
        <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 12, padding: '20px 24px', marginBottom: 20 }}>
          <h3 style={{ margin: 0, marginBottom: 14, fontSize: 14, color: '#3D2314', fontWeight: 600 }}>
            {form.modo === 'editar' ? 'Editar divisão' : 'Nova divisão'}
          </h3>
          {erroLdn && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{erroLdn}</div>
          )}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontWeight: 700 }}>
              Nome da divisão<AjudaCampo chave="ge.divisoes.nome" rota={ROTA_AJUDA} />
            </span>
            <input
              value={nomeForm}
              onChange={(e) => setNomeForm(e.target.value)}
              placeholder="Ex: Tintas · Gesso · Consultoria · Imóveis · Serviços"
              style={inputStyle}
            />
          </label>
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8, fontWeight: 700 }}>
              Cor (para identificar nos gráficos)<AjudaCampo chave="ge.divisoes.cor" rota={ROTA_AJUDA} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CORES_SUGERIDAS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCorForm(c)}
                  aria-label={`Cor ${c}`}
                  style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: c, cursor: 'pointer',
                    border: corForm === c ? '3px solid #3D2314' : '0.5px solid rgba(61,35,20,0.2)',
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={fecharForm}
              disabled={salvandoLdn}
              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '10px 18px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvarLDN}
              disabled={salvandoLdn}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '10px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvandoLdn ? 'wait' : 'pointer' }}
            >
              {salvandoLdn ? 'Salvando…' : form.modo === 'editar' ? 'Salvar alteração' : 'Criar divisão'}
            </button>
          </div>
        </div>
      )}

      {ldns.length === 0 && !form ? (
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
              confirmando={confirmarInativar === ldn.id}
              onEditar={() => abrirEditar(ldn)}
              onConfigBudget={() => setShowBudgetForm({ ldn: { id: ldn.id, nome: ldn.nome, cor: ldn.cor } })}
              onPedirInativar={() => setConfirmarInativar(ldn.id)}
              onConfirmarInativar={() => inativar(ldn)}
              onCancelarInativar={() => setConfirmarInativar(null)}
              onReativar={() => reativar(ldn.id)}
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

      {desfazer && (
        <div
          role="status"
          style={{
            position: 'fixed', left: 20, right: 20, bottom: 20, maxWidth: 520, margin: '0 auto',
            background: '#3D2314', color: '#FAF7F2', padding: '14px 18px', borderRadius: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            boxShadow: '0 8px 24px rgba(61,35,20,0.3)', fontSize: 13, zIndex: 50, flexWrap: 'wrap',
          }}
        >
          <span>Divisão <strong>{desfazer.nome}</strong> inativada.</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => reativar(desfazer.id)}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Desfazer
            </button>
            <button
              type="button"
              onClick={() => setDesfazer(null)}
              style={{ background: 'transparent', color: 'rgba(250,247,242,0.7)', border: '0.5px solid rgba(250,247,242,0.35)', padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}
            >
              Fechar
            </button>
          </span>
        </div>
      )}

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
  ldn, budget, ano, confirmando, onEditar, onConfigBudget, onPedirInativar, onConfirmarInativar, onCancelarInativar, onReativar,
}: {
  ldn: LDN
  budget: BudgetAgregado
  ano: number
  confirmando: boolean
  onEditar: () => void
  onConfigBudget: () => void
  onPedirInativar: () => void
  onConfirmarInativar: () => void
  onCancelarInativar: () => void
  onReativar: () => void
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
        <div style={{ fontSize: 15, fontWeight: 600, color: '#3D2314', marginBottom: 4, display: 'flex', alignItems: 'center' }}>{ldn.nome}{!ldn.ativo && <span style={{ fontSize: 11, fontWeight: 600, color: '#A32D2D', background: '#FCEBEB', padding: '2px 8px', borderRadius: 10, marginLeft: 8 }}>Inativa</span>}<AjudaCampo chave="ge.divisoes.resultado" rota={ROTA_AJUDA} /></div>
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
      {confirmando ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'rgba(163,45,45,0.06)', border: '0.5px solid rgba(163,45,45,0.3)', borderRadius: 8, padding: '8px 12px' }}>
          <span style={{ fontSize: 12, color: '#A32D2D', fontWeight: 600 }}>Inativar “{ldn.nome}”?</span>
          <button
            type="button"
            onClick={onConfirmarInativar}
            style={{ background: '#A32D2D', color: '#FFFFFF', border: 'none', padding: '7px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            Sim, inativar
          </button>
          <button
            type="button"
            onClick={onCancelarInativar}
            style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.3)', padding: '7px 14px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={onEditar}
              style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.3)', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              Editar
            </button>
            <AjudaCampo chave="ge.divisoes.editar" rota={ROTA_AJUDA} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={onConfigBudget}
              style={{ background: '#C8941A', color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
            >
              {temBudget ? 'Ajustar planejado' : 'Definir planejado'}
            </button>
            <AjudaCampo chave="ge.divisoes.planejado" rota={ROTA_AJUDA} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              onClick={ldn.ativo ? onPedirInativar : onReativar}
              style={{ background: 'transparent', color: ldn.ativo ? '#A32D2D' : '#3B6D11', border: `0.5px solid ${ldn.ativo ? '#A32D2D' : '#3B6D11'}`, padding: '8px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
            >
              {ldn.ativo ? 'Inativar' : 'Ativar'}
            </button>
            <AjudaCampo chave="ge.divisoes.inativar" rota={ROTA_AJUDA} />
          </div>
        </div>
      )}
    </div>
  )
}
