'use client'

// #71 (KGF · Jordana) · "Ao clicar em editar, abrir a MESMA tela da inclusão". NovaDespesaForm/NovaReceitaForm
// ganham o modo edição (prop editarId); este módulo concentra o que é comum aos dois:
//   · carrega o título (erp_pagar / erp_receber) da empresa;
//   · salva SÓ o que mudou via fn_pagar_editar_completo / fn_receber_editar_completo (mesma RPC e mesma trilha
//     em erp_lancamento_log do editor antigo);
//   · título PAGO ou CONCILIADO não altera valor, vencimento nem conta (mexeria numa baixa já conciliada);
//   · depois de salvar, oferece aplicar a alteração às demais parcelas NÃO pagas (Jordana #5).

import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type TipoLancamento = 'pagar' | 'receber'
export type Campos = Record<string, string | null>

// Campos que NUNCA replicam para as outras parcelas (são de cada parcela).
const NAO_REPLICA = new Set(['data_vencimento', 'data_pagamento', 'data_competencia', 'parcela', 'codigo_barras'])
// Pago/conciliado: estes não mudam (a baixa/vínculo bancário depende deles).
const TRAVADOS_SE_BAIXADO = ['valor', 'data_vencimento', 'conta_bancaria', 'conta_bancaria_id']
const NUMERICOS = new Set(['valor', 'juros', 'multa', 'desconto'])

type Irma = { id: string; parcela: string | null; parcela_num: number | null; pago: boolean; atual: boolean }
export type Replica = { campos: Campos; outras: Irma[]; currentNum: number | null }

const norm = (k: string, v: string | null | undefined): string => {
  const s = (v ?? '').toString().trim()
  if (NUMERICOS.has(k)) return s === '' ? '' : String(Math.round((parseFloat(s.replace(',', '.')) || 0) * 100) / 100)
  return s
}

export function diffCampos(base: Campos, atual: Campos): Campos {
  const out: Campos = {}
  for (const k of Object.keys(atual)) {
    if (norm(k, atual[k]) !== norm(k, base[k])) out[k] = NUMERICOS.has(k) ? norm(k, atual[k]) : ((atual[k] ?? '').toString().trim() || null)
  }
  return out
}

export function useEdicaoLancamento(tipo: TipoLancamento, id: string | undefined, companyId: string) {
  const [linha, setLinha] = useState<Record<string, unknown> | null>(null)
  const [carregando, setCarregando] = useState(!!id)
  const [erroCarga, setErroCarga] = useState<string | null>(null)
  const [replica, setReplica] = useState<Replica | null>(null)
  const [replicando, setReplicando] = useState(false)

  useEffect(() => {
    if (!id) return
    let alive = true
    setCarregando(true); setErroCarga(null)
    supabase.from(tipo === 'pagar' ? 'erp_pagar' : 'erp_receber').select('*').eq('id', id).eq('company_id', companyId).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        setCarregando(false)
        if (error) { setErroCarga(error.message); return }
        if (!data) { setErroCarga('Lançamento não encontrado nesta empresa.'); return }
        setLinha(data as Record<string, unknown>)
      })
    return () => { alive = false }
  }, [tipo, id, companyId])

  const status = String(linha?.status ?? '')
  const baixado = !!linha && (status === 'pago' || !!linha.conciliado || linha.movimento_banco_id != null)
  // #137 (André) · "baixei sem conciliar e não deixa incluir a conta de débito". A conta só é intocável quando há
  // EXTRATO por trás (conciliado ou com movimento do banco). Baixa manual sem conciliação: a conta pode ser
  // informada/corrigida — é ela que a conciliação vai procurar depois. Valor e vencimento seguem travados.
  const comExtrato = !!linha && (!!linha.conciliado || linha.movimento_banco_id != null)

  // Salva o que mudou. Devolve erro (texto) ou ok; se houver outras parcelas não pagas e campos replicáveis,
  // deixa `replica` preenchido para a tela perguntar "aplicar às demais?".
  const salvarEdicao = useCallback(async (base: Campos, atual: Campos): Promise<{ ok: true; alterados: number } | { ok: false; erro: string }> => {
    if (!id) return { ok: false, erro: 'Lançamento não informado.' }
    const payload = diffCampos(base, atual)
    if (Object.keys(payload).length === 0) return { ok: false, erro: 'Nada foi alterado — nenhuma mudança para salvar.' }
    const travados = comExtrato ? TRAVADOS_SE_BAIXADO : TRAVADOS_SE_BAIXADO.filter((k) => !k.startsWith('conta_bancaria'))
    if (baixado && travados.some((k) => k in payload)) {
      return { ok: false, erro: comExtrato
        ? `Este lançamento está CONCILIADO com o extrato — não dá para alterar valor, vencimento ou conta (isso mexeria numa baixa já conciliada). Os demais campos podem ser editados. Para corrigir a baixa, use Desvincular no inbox de conciliação.`
        : `Este lançamento está PAGO — não dá para alterar valor nem vencimento (a baixa depende deles). A conta e os demais campos podem ser editados.` }
    }
    const rpc = tipo === 'pagar' ? 'fn_pagar_editar_completo' : 'fn_receber_editar_completo'
    const { data, error } = await supabase.rpc(rpc, { p_id: id, p_campos: payload })
    if (error) return { ok: false, erro: error.message }
    const j = data as { sucesso?: boolean; erro?: string } | null
    if (!j?.sucesso) {
      return { ok: false, erro: j?.erro === 'fornecedor_de_outra_empresa' ? 'Esse fornecedor não é desta empresa.' : (j?.erro ?? 'Não foi possível salvar.') }
    }

    const replicaveis: Campos = {}
    for (const k of Object.keys(payload)) if (!NAO_REPLICA.has(k)) replicaveis[k] = payload[k]
    if (Object.keys(replicaveis).length > 0) {
      const { data: irmas } = await supabase.rpc('fn_parcela_grupo_irmas', { p_tipo: tipo, p_id: id })
      const rows = (irmas as Irma[] | null) ?? []
      const outras = rows.filter((r) => !r.pago && !r.atual)
      if (outras.length > 0) setReplica({ campos: replicaveis, outras, currentNum: rows.find((r) => r.atual)?.parcela_num ?? null })
    }
    return { ok: true, alterados: Object.keys(payload).length }
  }, [id, tipo, baixado, comExtrato])

  const aplicarReplica = useCallback(async (escopo: 'proximas' | 'todas'): Promise<string | null> => {
    if (!replica) return null
    const ids = (escopo === 'proximas'
      ? replica.outras.filter((r) => r.parcela_num != null && replica.currentNum != null && r.parcela_num > replica.currentNum)
      : replica.outras).map((r) => r.id)
    setReplicando(true)
    try {
      if (ids.length > 0) {
        const { data, error } = await supabase.rpc(tipo === 'pagar' ? 'fn_pagar_editar_massa' : 'fn_receber_editar_massa', { p_ids: ids, p_campos: replica.campos })
        if (error) return error.message
        const r = data as { sucesso?: boolean; erro?: string } | null
        if (r?.sucesso === false) return r?.erro ?? 'falha ao aplicar nas demais parcelas'
      }
      setReplica(null)
      return null
    } finally { setReplicando(false) }
  }, [replica, tipo])

  return { linha, carregando, erroCarga, baixado, comExtrato, status, salvarEdicao, replica, replicando, aplicarReplica, descartarReplica: () => setReplica(null) }
}

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'

// Pergunta pós-salvar: aplicar às demais parcelas não pagas.
export function ReplicaParcelasDialog({ replica, replicando, erro, onEscolher, onSoEsta }: {
  replica: Replica; replicando: boolean; erro: string | null
  onEscolher: (escopo: 'proximas' | 'todas') => void; onSoEsta: () => void
}) {
  const proximas = replica.outras.filter((r) => r.parcela_num != null && replica.currentNum != null && r.parcela_num > replica.currentNum).length
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div role="dialog" aria-label="Aplicar às demais parcelas" style={{ background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%', padding: 20, border: `0.5px solid ${LINE}` }}>
        <div style={{ fontSize: 18, color: ESP, marginBottom: 4, fontWeight: 600 }}>Essa conta tem {replica.outras.length + 1} parcelas</div>
        <div style={{ fontSize: 13, color: ESP, marginBottom: 12 }}>Aplicar a alteração também às demais parcelas <b>não pagas</b>? (as já pagas ficam intactas)</div>
        {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{erro}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" disabled={replicando} onClick={() => onEscolher('proximas')}
            style={{ background: GOLD, color: ESP, border: 'none', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: replicando ? 'wait' : 'pointer', textAlign: 'left' }}>
            Esta e as próximas <span style={{ opacity: 0.75 }}>({proximas} parcela{proximas === 1 ? '' : 's'} futura{proximas === 1 ? '' : 's'})</span>
          </button>
          <button type="button" disabled={replicando} onClick={() => onEscolher('todas')}
            style={{ background: '#fff', color: ESP, border: `0.5px solid ${GOLD}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: replicando ? 'wait' : 'pointer', textAlign: 'left' }}>
            Todas as parcelas não pagas <span style={{ opacity: 0.6 }}>({replica.outras.length})</span>
          </button>
          <button type="button" disabled={replicando} onClick={onSoEsta}
            style={{ background: 'transparent', color: ESP60, border: `0.5px solid ${LINE}`, padding: '9px 14px', borderRadius: 8, fontSize: 13, cursor: replicando ? 'wait' : 'pointer' }}>
            Só esta
          </button>
        </div>
      </div>
    </div>
  )
}

// Situação do título na edição (substitui o "Já paguei/recebi" da inclusão) + aviso da trava.
export function SituacaoEdicao({ tipo, linha, baixado }: { tipo: TipoLancamento; linha: Record<string, unknown>; baixado: boolean }) {
  const st = String(linha.status ?? 'aberto')
  const pago = Number(linha.valor_pago ?? 0)
  const dt = linha.data_pagamento ? String(linha.data_pagamento).split('-').reverse().join('/') : null
  const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const rot = st === 'pago' ? (tipo === 'pagar' ? 'Paga' : 'Recebida') : st === 'parcial' ? 'Parcial' : st === 'vencido' ? 'Vencida' : 'Em aberto'
  return (
    <div data-testid="edicao-situacao" style={{ display: 'grid', gap: 6 }}>
      <div style={{ fontSize: 13, color: ESP }}>
        Situação: <b>{rot}</b>{pago > 0 ? ` · ${tipo === 'pagar' ? 'pago' : 'recebido'} ${brl(pago)}` : ''}{dt ? ` em ${dt}` : ''}
        {linha.conciliado ? ' · conciliado com o extrato' : ''}{linha.parcela ? ` · parcela ${String(linha.parcela)}` : ''}
      </div>
      {baixado && (
        <div style={{ background: '#FEF3C7', color: '#7A5A0F', padding: '8px 10px', borderRadius: 6, fontSize: 12, border: '0.5px solid rgba(200,148,26,0.35)' }}>
          {linha.conciliado || linha.movimento_banco_id != null
            ? <>Este lançamento está conciliado com o extrato. <b>Valor, vencimento e conta</b> ficam travados; os demais campos podem ser alterados. Para corrigir a baixa, use <b>Desvincular</b> no inbox de conciliação.</>
            : <>Este lançamento já tem baixa (sem conciliação). <b>Valor e vencimento</b> ficam travados; a <b>conta</b> e os demais campos podem ser alterados.</>}
        </div>
      )}
    </div>
  )
}
