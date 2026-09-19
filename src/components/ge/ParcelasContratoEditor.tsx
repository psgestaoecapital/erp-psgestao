'use client'

// #59 PDOIS parte 2 · Editor de parcelas do CONTRATO de fee (padrão SIGA "Adicionar Fee").
// Reaproveita a UI/preset do ParcelasEditor do pedido, mas grava no domínio do contrato:
//   - lê/escreve erp_contrato_parcelas (não erp_pedidos_parcelas);
//   - "Automáticas": primeiro vencimento + nº → fn_contrato_parcelas_gerar (mensal);
//   - "+ / X / editar": fn_contrato_parcelas_salvar (pagador padrão = cliente, resolvido no servidor);
//   - rodapé: soma das parcelas × (valor mensal × nº) — aviso amarelo se divergir;
//   - plano trava quando o contrato está 'ativo' (as RPCs recusam edição; a tela fica read-only).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Trash2, Plus, AlertCircle, CheckCircle2, Wand2 } from 'lucide-react'

export interface ParcelaContrato {
  id?: string
  numero: number
  valor: number
  vencimento: string
  conta_bancaria_id?: string | null
  forma_pagamento?: string | null
}

interface Conta { id: string; nome: string; banco: string | null }

interface Props {
  contratoId: string
  companyId: string
  valorMensal: number              // referência do rodapé (soma esperada = valorMensal × nº parcelas)
  readOnly?: boolean               // contrato 'ativo' → plano imutável
  defaultPrimeiro?: string | null  // sugestão do "Automáticas" (= data De do fee)
  defaultN?: number | null         // sugestão do "Automáticas" (= nº calculado de De/Até)
  onSaved?: (n: number) => void
}

const C = {
  espresso: '#3D2314', espressoM: '#6B5D4F', white: '#FFFFFF', cream: '#F0ECE3',
  border: '#E0D8CC', gold: '#C8941A', goldD: '#A57A15', goldBg: '#FDF7E8',
  green: '#10B981', greenBg: '#ECFDF5', red: '#EF4444', redBg: '#FEE2E2',
  amber: '#C88A1A', amberBg: '#FFF8E1',
}
const fmtBRL = (v: number) => 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100
function addMonthsISO(baseISO: string, m: number): string {
  const d = new Date(baseISO + 'T00:00:00'); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10)
}
function hojeISO(): string { return new Date().toISOString().slice(0, 10) }

const inp: React.CSSProperties = { width: '100%', minHeight: 36, padding: '6px 8px', fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 6, background: C.white, color: C.espresso, outline: 'none' }
const btn: React.CSSProperties = { minHeight: 32, padding: '6px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${C.gold}`, borderRadius: 6, background: C.goldBg, color: C.goldD, cursor: 'pointer' }
const btnPri: React.CSSProperties = { minHeight: 44, padding: '10px 16px', fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 8, background: C.gold, color: C.white, cursor: 'pointer' }

export default function ParcelasContratoEditor({ contratoId, companyId, valorMensal, readOnly, defaultPrimeiro, defaultN, onSaved }: Props) {
  const [parcelas, setParcelas] = useState<ParcelaContrato[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msgErr, setMsgErr] = useState<string | null>(null)
  const [msgOk, setMsgOk] = useState<string | null>(null)
  // "Automáticas" (defaults vêm do fee: primeiro vencimento = "De", nº calculado de De/Até)
  const [autoAberto, setAutoAberto] = useState(false)
  const [autoPrimeiro, setAutoPrimeiro] = useState(defaultPrimeiro || hojeISO())
  const [autoN, setAutoN] = useState(defaultN && defaultN > 0 ? String(defaultN) : '12')
  const [gerando, setGerando] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('erp_contrato_parcelas')
      .select('id,numero,valor,vencimento,conta_bancaria_id,forma_pagamento')
      .eq('contrato_id', contratoId)
      .order('numero', { ascending: true })
    const { data: cts } = await supabase
      .from('erp_banco_contas').select('id,nome,banco').eq('company_id', companyId).eq('ativo', true).order('nome')
    setContas((cts ?? []) as Conta[])
    setParcelas((data ?? []).map((p) => ({ ...p, valor: Number(p.valor), conta_bancaria_id: p.conta_bancaria_id ?? null })) as ParcelaContrato[])
    setLoading(false)
  }, [contratoId, companyId])

  useEffect(() => { void carregar() }, [carregar])

  const soma = useMemo(() => round2(parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0)), [parcelas])
  const esperado = useMemo(() => round2((Number(valorMensal) || 0) * parcelas.length), [valorMensal, parcelas.length])
  const diff = round2(soma - esperado)
  const bate = Math.abs(diff) < 0.005

  function alterar(idx: number, patch: Partial<ParcelaContrato>) {
    setMsgErr(null); setMsgOk(null)
    setParcelas((arr) => arr.map((p, i) => (i === idx ? { ...p, ...patch } : p)))
  }
  function adicionar() {
    setMsgErr(null); setMsgOk(null)
    const last = parcelas[parcelas.length - 1]
    setParcelas((arr) => [...arr, {
      numero: arr.length + 1,
      valor: round2(Number(valorMensal) || 0),
      vencimento: last ? addMonthsISO(last.vencimento, 1) : hojeISO(),
      conta_bancaria_id: last?.conta_bancaria_id ?? null,
      forma_pagamento: last?.forma_pagamento ?? null,
    }])
  }
  function remover(idx: number) {
    setMsgErr(null); setMsgOk(null)
    setParcelas((arr) => arr.filter((_, i) => i !== idx).map((p, i) => ({ ...p, numero: i + 1 })))
  }

  async function gerarAutomaticas() {
    const n = Math.max(1, parseInt(autoN, 10) || 0)
    if (!autoPrimeiro || n < 1) { setMsgErr('Informe o primeiro vencimento e o número de parcelas.'); return }
    setGerando(true); setMsgErr(null); setMsgOk(null)
    const conta = parcelas[0]?.conta_bancaria_id ?? contas.find(() => true)?.id ?? null
    const { data, error } = await supabase.rpc('fn_contrato_parcelas_gerar', {
      p_contrato_id: contratoId, p_primeiro_vencimento: autoPrimeiro, p_n: n,
      p_valor: round2(Number(valorMensal) || 0), p_conta_id: conta,
    })
    setGerando(false)
    if (error) { setMsgErr(error.message); return }
    const r = data as { ok?: boolean; erro?: string; parcelas?: number }
    if (!r?.ok) { setMsgErr(traduzErro(r?.erro)); return }
    setAutoAberto(false)
    await carregar()
    setMsgOk(`Geradas ${r.parcelas ?? n} parcelas mensais a partir de ${autoPrimeiro.split('-').reverse().join('/')}.`)
    onSaved?.(r.parcelas ?? n)
  }

  async function salvar() {
    if (parcelas.some((p) => !p.vencimento)) { setMsgErr('Toda parcela precisa de vencimento.'); return }
    if (parcelas.some((p) => (Number(p.valor) || 0) <= 0)) { setMsgErr('Toda parcela precisa de valor maior que zero.'); return }
    setSalvando(true); setMsgErr(null); setMsgOk(null)
    const payload = parcelas.map((p) => ({
      vencimento: p.vencimento, valor: round2(p.valor),
      conta_bancaria_id: p.conta_bancaria_id || null, forma_pagamento: p.forma_pagamento || null,
    }))
    const { data, error } = await supabase.rpc('fn_contrato_parcelas_salvar', { p_contrato_id: contratoId, p_parcelas: payload })
    setSalvando(false)
    if (error) { setMsgErr(error.message); return }
    const r = data as { ok?: boolean; erro?: string; parcelas?: number }
    if (!r?.ok) { setMsgErr(traduzErro(r?.erro)); return }
    await carregar()
    setMsgOk(`Plano salvo · ${r.parcelas ?? payload.length} parcela(s).`)
    onSaved?.(r.parcelas ?? payload.length)
  }

  if (loading) return <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>Carregando parcelas…</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {readOnly && (
        <div style={{ padding: 8, background: C.cream, borderRadius: 6, fontSize: 11, color: C.espressoM }}>
          Contrato ativo — o plano de parcelas está travado. Os títulos já foram lançados no financeiro.
        </div>
      )}

      {!readOnly && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <button type="button" onClick={() => setAutoAberto((v) => !v)} style={btn} data-testid="parcelas-contrato-automaticas">
            <Wand2 size={12} style={{ display: 'inline', marginRight: 4, verticalAlign: 'middle' }} />
            Automáticas
          </button>
          <button type="button" onClick={adicionar} style={btn} data-testid="parcela-contrato-adicionar">
            <Plus size={12} style={{ display: 'inline', marginRight: 2, verticalAlign: 'middle' }} />
            Adicionar parcela
          </button>
        </div>
      )}

      {autoAberto && !readOnly && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', padding: 8, background: C.cream, borderRadius: 6, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 130 }}>
            <span style={{ fontSize: 10, color: C.espressoM }}>Primeiro vencimento</span>
            <input type="date" value={autoPrimeiro} onChange={(e) => setAutoPrimeiro(e.target.value)} style={inp} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 90 }}>
            <span style={{ fontSize: 10, color: C.espressoM }}>Nº parcelas</span>
            <input type="number" min="1" max="120" value={autoN} onChange={(e) => setAutoN(e.target.value)} style={inp} />
          </label>
          <button type="button" onClick={() => void gerarAutomaticas()} disabled={gerando} style={{ ...btn, opacity: gerando ? 0.5 : 1 }}>
            {gerando ? 'Gerando…' : `Gerar ${autoN}× de ${fmtBRL(valorMensal)}`}
          </button>
        </div>
      )}

      {parcelas.length === 0 ? (
        <p style={{ fontSize: 12, color: C.espressoM, fontStyle: 'italic', margin: 0 }}>
          Nenhuma parcela ainda · use "Automáticas" (primeiro vencimento + nº) ou "+ Adicionar parcela".
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {parcelas.map((p, i) => (
            <div key={i} data-testid={`parcela-contrato-row-${i}`} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, display: 'grid', gridTemplateColumns: '44px 1fr 1fr 1.4fr 32px', gap: 6, alignItems: 'end' }}>
              <label>
                <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Nº</span>
                <div style={{ ...inp, textAlign: 'center', fontWeight: 700, color: C.goldD, background: C.goldBg }}>{i + 1}</div>
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Vencimento</span>
                <input type="date" value={p.vencimento} disabled={readOnly} onChange={(e) => alterar(i, { vencimento: e.target.value })} style={inp} data-testid={`parcela-contrato-vencimento-${i}`} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Valor (R$)</span>
                <input type="number" step="0.01" min="0" value={p.valor || ''} disabled={readOnly} onChange={(e) => alterar(i, { valor: parseFloat(e.target.value) || 0 })} style={{ ...inp, textAlign: 'right' }} data-testid={`parcela-contrato-valor-${i}`} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 10, color: C.espressoM, marginBottom: 2 }}>Conta de recebimento</span>
                <select value={p.conta_bancaria_id ?? ''} disabled={readOnly || contas.length === 0} onChange={(e) => alterar(i, { conta_bancaria_id: e.target.value || null })} style={inp} data-testid={`parcela-contrato-conta-${i}`}>
                  <option value="">{contas.length === 0 ? 'Sem contas ativas' : 'Conta…'}</option>
                  {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.banco ? ` · ${c.banco}` : ''}</option>)}
                </select>
              </label>
              {!readOnly ? (
                <button type="button" onClick={() => remover(i)} data-testid={`parcela-contrato-remover-${i}`} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer', padding: 4, alignSelf: 'center' }} aria-label="Remover">
                  <Trash2 size={16} />
                </button>
              ) : <span />}
            </div>
          ))}
        </div>
      )}

      {/* Rodapé: soma × (valor mensal × nº) */}
      {parcelas.length > 0 && (
        <div style={{ padding: 10, background: bate ? C.greenBg : C.amberBg, borderRadius: 6, fontSize: 11, color: bate ? C.green : C.amber, fontWeight: 600 }}>
          Soma <strong>{fmtBRL(soma)}</strong> · {parcelas.length}× de {fmtBRL(valorMensal)} = <strong>{fmtBRL(esperado)}</strong>
          {!bate && <> · Diferença <strong>{diff > 0 ? '+' : ''}{fmtBRL(diff)}</strong> — confira antes de ativar.</>}
        </div>
      )}

      {msgErr && (
        <div style={{ padding: 10, background: C.redBg, color: C.red, borderRadius: 6, fontSize: 12, display: 'flex', gap: 6, alignItems: 'start' }}>
          <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} /><span>{msgErr}</span>
        </div>
      )}
      {msgOk && (
        <div style={{ padding: 10, background: C.greenBg, color: C.green, borderRadius: 6, fontSize: 12, display: 'flex', gap: 6, alignItems: 'start' }}>
          <CheckCircle2 size={14} style={{ marginTop: 1, flexShrink: 0 }} /><span>{msgOk}</span>
        </div>
      )}

      {!readOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={() => void salvar()} disabled={salvando || parcelas.length === 0} data-testid="parcelas-contrato-salvar" style={{ ...btnPri, opacity: (salvando || parcelas.length === 0) ? 0.5 : 1 }}>
            {salvando ? 'Salvando…' : 'Salvar plano de parcelas'}
          </button>
        </div>
      )}
    </div>
  )
}

function traduzErro(e?: string): string {
  switch (e) {
    case 'contrato_ativo_nao_edita_plano': return 'Contrato ativo — o plano não pode mais ser editado.'
    case 'contrato_nao_encontrado': return 'Contrato não encontrado.'
    case 'sem_acesso': return 'Você não tem acesso a esta empresa.'
    case 'n_parcelas_invalido': return 'Número de parcelas inválido.'
    case 'parcelas_invalidas': return 'Plano de parcelas inválido.'
    default: return e || 'Não foi possível salvar as parcelas.'
  }
}
