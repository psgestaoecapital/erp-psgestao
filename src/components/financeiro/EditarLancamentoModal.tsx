'use client'

// Editor COMPLETO de erp_pagar / erp_receber (F2 + Lote A.2). Todos os campos editáveis; salva via
// fn_pagar_editar_completo / fn_receber_editar_completo (payload jsonb) com trilha em erp_lancamento_log.
// Usa o <Modal> central (não fecha no clique-fora; X + Esc; scroll-lock). RLS isola por company_id.
//
// A.2: no contexto RECEBER, Conta bancária e Centro de custo viram <select> (gravam conta_bancaria_id /
// centro_custo_id). Contexto PAGAR fica como texto (erp_pagar ainda não tem as FKs — sem regressão).
// Aviso (não bloqueia) ao editar campo financeiro de um pago/conciliado.

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import Modal from '@/components/ui/Modal'
import { validarCodigoBarrasEntrada } from '@/lib/financeiro/boleto-parser'

type Tipo = 'pagar' | 'receber'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  tipo: Tipo
  itemId: string
  companyId: string
}

const ESP = '#3D2314', GOLD = '#C8941A', LINE = '#E7DECF', ESP60 = 'rgba(61,35,20,0.55)'
const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `0.5px solid ${LINE}`,
  borderRadius: 6, fontSize: 13, background: '#fff', color: ESP, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl: React.CSSProperties = { fontSize: 11, color: ESP60, display: 'block', marginBottom: 4 }
const hintErr: React.CSSProperties = { fontSize: 10.5, color: '#854F0B', display: 'block', marginTop: 3 }

// Campos financeiros que disparam o aviso quando pago/conciliado.
const CAMPOS_FINANCEIROS = ['valor', 'data_pagamento', 'conta_bancaria', 'conta_bancaria_id']

// Réplica pras demais parcelas (Jordana #5): campos que NUNCA replicam (são por-parcela).
const NAO_REPLICA = new Set(['data_vencimento', 'data_pagamento', 'data_competencia', 'parcela', 'codigo_barras'])
type Irma = { id: string; parcela: string | null; parcela_num: number | null; status: string; valor: number; data_vencimento: string; pago: boolean; atual: boolean }

type CampoTipo = 'text' | 'num' | 'date' | 'area' | 'bool' | 'select' | 'conta' | 'centro'
type Campo = { col: string; label: string; tipo: CampoTipo; opcoes?: string[]; largo?: boolean }
const FORMAS = ['', 'boleto', 'pix', 'dinheiro', 'transferencia', 'cartao_debito', 'cartao_credito', 'cheque', 'permuta', 'debito_automatico']
const TIPOS_CHAVE_PIX_OPCOES = ['', 'cpf_cnpj', 'telefone', 'email', 'aleatoria', 'copia_cola']

function campos(tipo: Tipo): Campo[] {
  const contraparte: Campo = tipo === 'pagar'
    ? { col: 'fornecedor_nome', label: 'Fornecedor', tipo: 'text', largo: true }
    : { col: 'cliente_nome', label: 'Cliente', tipo: 'text', largo: true }
  // conta/centro: dropdown (FK) no receber; texto no pagar.
  const contaCampo: Campo = tipo === 'receber'
    ? { col: 'conta_bancaria_id', label: 'Conta bancária', tipo: 'conta' }
    : { col: 'conta_bancaria', label: 'Conta bancária', tipo: 'text' }
  const centroCampo: Campo = tipo === 'receber'
    ? { col: 'centro_custo_id', label: 'Centro de custo', tipo: 'centro' }
    : { col: 'centro_custo', label: 'Centro de custo', tipo: 'text' }
  const base: Campo[] = [
    contraparte,
    { col: 'descricao', label: 'Descrição *', tipo: 'text', largo: true },
    { col: 'categoria', label: 'Categoria', tipo: 'text' },
    { col: 'linha_negocio', label: 'Linha de negócio', tipo: 'text' },
    { col: 'valor', label: 'Valor (R$) *', tipo: 'num' },
    { col: 'forma_pagamento', label: 'Forma de pagamento', tipo: 'select', opcoes: FORMAS },
    { col: 'tipo_chave_pix', label: 'Tipo de chave PIX', tipo: 'select', opcoes: TIPOS_CHAVE_PIX_OPCOES },
    { col: 'chave_pix', label: 'Chave PIX (p/ remessa)', tipo: 'text', largo: true },
    { col: 'data_emissao', label: 'Emissão', tipo: 'date' },
    { col: 'data_vencimento', label: 'Vencimento *', tipo: 'date' },
    { col: 'data_pagamento', label: 'Pagamento', tipo: 'date' },
    { col: 'data_competencia', label: 'Competência', tipo: 'date' },
    { col: 'numero_documento', label: 'Nº documento', tipo: 'text' },
    { col: 'numero_nf', label: 'Nº NF', tipo: 'text' },
    { col: 'parcela', label: 'Parcela', tipo: 'text' },
    contaCampo,
    centroCampo,
    { col: 'juros', label: 'Juros (R$)', tipo: 'num' },
    { col: 'multa', label: 'Multa (R$)', tipo: 'num' },
    { col: 'desconto', label: 'Desconto (R$)', tipo: 'num' },
    { col: 'recorrente', label: 'Recorrente?', tipo: 'bool' },
    { col: 'recorrencia_meses', label: 'Recorrência (meses)', tipo: 'num' },
    { col: 'observacoes', label: 'Observações', tipo: 'area', largo: true },
  ]
  if (tipo === 'pagar') base.splice(11, 0, { col: 'codigo_barras', label: 'Código de barras', tipo: 'text', largo: true })
  else base.splice(11, 0, { col: 'contrato_id', label: 'Contrato (UUID)', tipo: 'text', largo: true })
  return base
}

export default function EditarLancamentoModal({ open, onClose, onSucesso, tipo, itemId, companyId }: Props) {
  const tabela = tipo === 'pagar' ? 'erp_pagar' : 'erp_receber'
  const defs = useMemo(() => campos(tipo), [tipo])

  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [orig, setOrig] = useState<Record<string, string>>({})
  const [statusOrig, setStatusOrig] = useState('aberto')
  const [conciliadoOrig, setConciliadoOrig] = useState(false)
  const [movimentoBanco, setMovimentoBanco] = useState(false)
  const [contas, setContas] = useState<{ id: string; nome: string; banco: string | null }[]>([])
  const [centros, setCentros] = useState<{ id: string; nome: string }[]>([])
  const [legadoConta, setLegadoConta] = useState('')     // conta_bancaria (texto) p/ hint quando _id nulo
  const [legadoCentro, setLegadoCentro] = useState('')
  const [replica, setReplica] = useState<{ campos: Record<string, string | null>; outras: Irma[]; currentNum: number | null } | null>(null)
  const [replicando, setReplicando] = useState(false)

  // dropdowns só no receber
  useEffect(() => {
    if (!open || tipo !== 'receber') return
    let alive = true
    ;(async () => {
      const [bcs, ccs] = await Promise.all([
        supabase.from('erp_banco_contas').select('id, nome, banco').eq('company_id', companyId).eq('ativo', true).order('nome'),
        supabase.from('erp_centros_custo').select('id, nome').eq('company_id', companyId).eq('ativo', true).order('nome'),
      ])
      if (!alive) return
      setContas((bcs.data as { id: string; nome: string; banco: string | null }[] | null) ?? [])
      setCentros((ccs.data as { id: string; nome: string }[] | null) ?? [])
    })()
    return () => { alive = false }
  }, [open, tipo, companyId])

  useEffect(() => {
    if (!open || !itemId) return
    setErro(null); setCarregando(true)
    supabase.from(tabela).select('*').eq('id', itemId).eq('company_id', companyId).maybeSingle()
      .then(({ data, error }) => {
        setCarregando(false)
        if (error) { setErro(error.message); return }
        if (!data) { setErro('lançamento não encontrado'); return }
        const d = data as Record<string, unknown>
        const next: Record<string, string> = {}
        for (const c of defs) {
          const v = d[c.col]
          next[c.col] = c.tipo === 'bool' ? (v ? 'true' : 'false') : (v == null ? '' : String(v))
        }
        setForm(next); setOrig(next)
        setLegadoConta(String(d.conta_bancaria ?? ''))
        setLegadoCentro(String(d.centro_custo ?? ''))
        setStatusOrig(String(d.status ?? 'aberto'))
        setConciliadoOrig(!!d.conciliado)
        setMovimentoBanco(d.movimento_banco_id != null)
      })
  }, [open, itemId, tabela, companyId, defs])

  const set = (col: string, v: string) => setForm((f) => ({ ...f, [col]: v }))
  const pagoOuConciliado = statusOrig === 'pago' || conciliadoOrig || movimentoBanco
  const financeiroAlterado = CAMPOS_FINANCEIROS.some((c) => (form[c] ?? '') !== (orig[c] ?? ''))
  const mostrarAviso = pagoOuConciliado && financeiroAlterado

  async function salvar() {
    if (!(form.descricao ?? '').trim()) { setErro('Descreva o lançamento.'); return }
    const v = parseFloat((form.valor ?? '').replace(',', '.'))
    if (!v || v <= 0) { setErro('Valor deve ser maior que zero.'); return }
    if (!(form.data_vencimento ?? '')) { setErro('Data de vencimento é obrigatória.'); return }

    // SAFEGUARD do código de barras (RD-57 · RD-55): só quando o usuário ALTEROU o barras nesta edição
    // (não bloqueia editar outros campos de uma linha com barras legado). Confere o DV e, p/ boleto
    // bancário, se o valor embutido bate com o informado. O valor é gravado verbatim pela RPC.
    if (tipo === 'pagar') {
      const cbNovo = (form.codigo_barras ?? '').trim()
      const cbMudou = cbNovo !== (orig.codigo_barras ?? '').trim()
      if (cbMudou && cbNovo) {
        const vb = validarCodigoBarrasEntrada(cbNovo)
        if (!vb.ok) { setErro(vb.motivo!); return }
        const vNum = parseFloat((form.valor ?? '').replace(',', '.'))
        if (vb.tipo === 'boleto' && vb.valorBoleto != null && vNum && Math.abs(vb.valorBoleto - vNum) > 0.005) {
          setErro(`O valor do boleto (R$ ${vb.valorBoleto.toFixed(2)}) diverge do valor informado (R$ ${vNum.toFixed(2)}). Confira o código de barras.`)
          return
        }
      }
    }
    setSalvando(true); setErro(null)
    try {
      const payload: Record<string, string | null> = {}
      for (const c of defs) {
        if ((form[c.col] ?? '') === (orig[c.col] ?? '')) continue
        const raw = (form[c.col] ?? '').trim()
        payload[c.col] = c.tipo === 'num' ? raw.replace(',', '.') : raw
      }
      if (Object.keys(payload).length === 0) { onClose(); return }
      const rpc = tipo === 'pagar' ? 'fn_pagar_editar_completo' : 'fn_receber_editar_completo'
      const { data, error } = await supabase.rpc(rpc, { p_id: itemId, p_campos: payload })
      if (error) throw error
      const j = data as { sucesso?: boolean; erro?: string } | null
      if (!j?.sucesso) throw new Error(j?.erro ?? 'falha ao salvar')

      // Réplica pras demais parcelas (Jordana #5): grupo com outras parcelas NÃO pagas + campos replicáveis.
      const campos: Record<string, string | null> = {}
      for (const k of Object.keys(payload)) if (!NAO_REPLICA.has(k)) campos[k] = payload[k]
      if (Object.keys(campos).length > 0) {
        const { data: irmasData } = await supabase.rpc('fn_parcela_grupo_irmas', { p_tipo: tipo, p_id: itemId })
        const rows = (irmasData as Irma[] | null) ?? []
        const outras = rows.filter((r) => !r.pago && !r.atual)
        if (outras.length > 0) {
          const atual = rows.find((r) => r.atual)
          setReplica({ campos, outras, currentNum: atual?.parcela_num ?? null })
          setSalvando(false)
          return // não fecha — abre o prompt "aplicar às demais?"
        }
      }
      onSucesso()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setSalvando(false)
    }
  }

  async function aplicarReplica(escopo: 'proximas' | 'todas') {
    if (!replica) return
    setReplicando(true); setErro(null)
    const ids = (escopo === 'proximas'
      ? replica.outras.filter((r) => r.parcela_num != null && replica.currentNum != null && r.parcela_num > (replica.currentNum as number))
      : replica.outras).map((r) => r.id)
    try {
      if (ids.length > 0) {
        const rpc = tipo === 'pagar' ? 'fn_pagar_editar_massa' : 'fn_receber_editar_massa'
        const { data, error } = await supabase.rpc(rpc, { p_ids: ids, p_campos: replica.campos })
        if (error) throw error
        const r = data as { sucesso?: boolean; erro?: string } | null
        if (r?.sucesso === false) throw new Error(r?.erro ?? 'falha ao replicar')
      }
      setReplica(null); setReplicando(false); onSucesso()
    } catch (e) { setErro((e as Error).message); setReplicando(false) }
  }

  if (!open) return null

  const totalGrupo = replica ? replica.outras.length + 1 : 0
  const qtdProximas = replica ? replica.outras.filter((r) => r.parcela_num != null && replica.currentNum != null && r.parcela_num > (replica.currentNum as number)).length : 0

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      maxWidth={720}
      title={`Editar ${tipo === 'pagar' ? 'conta a pagar' : 'conta a receber'}`}
      subtitle={form.descricao || (carregando ? 'Carregando…' : '—')}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={salvando} style={{ background: 'transparent', color: ESP, border: `0.5px solid ${LINE}`, padding: '8px 14px', borderRadius: 6, fontSize: 13, cursor: salvando ? 'not-allowed' : 'pointer' }}>Cancelar</button>
          <button type="button" onClick={salvar} disabled={salvando || carregando} style={{ background: (salvando || carregando) ? 'rgba(200,148,26,0.4)' : GOLD, color: '#3D2314', border: 'none', padding: '8px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}>{salvando ? 'Salvando…' : 'ALTERAR'}</button>
        </>
      }
    >
      {mostrarAviso && (
        <div style={{ marginBottom: 12, background: '#FEF3C7', color: '#7A5A0F', padding: '8px 10px', borderRadius: 6, fontSize: 11, border: '0.5px solid rgba(200,148,26,0.35)' }}>
          ⚠️ Este lançamento está <b>{statusOrig === 'pago' ? 'PAGO' : 'CONCILIADO'}</b> e você alterou um campo
          financeiro (valor / data de pagamento / conta). A alteração é <b>salva</b>, mas <b>não</b> muda a baixa
          nem o vínculo bancário. Para corrigir a baixa, use <b>Desvincular</b> no inbox de conciliação.
        </div>
      )}

      {carregando ? (
        <div style={{ padding: 20, textAlign: 'center', color: ESP60 }}>Carregando…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {defs.map((c) => {
            const val = form[c.col] ?? ''
            const span: React.CSSProperties = c.largo || c.tipo === 'area' ? { gridColumn: '1 / -1' } : {}
            return (
              <div key={c.col} style={span}>
                <label style={lbl}>{c.label}</label>
                {c.tipo === 'area' ? (
                  <textarea value={val} onChange={(e) => set(c.col, e.target.value)} rows={2} style={{ ...inp, resize: 'vertical' }} />
                ) : c.tipo === 'bool' ? (
                  <select value={val || 'false'} onChange={(e) => set(c.col, e.target.value)} style={inp}>
                    <option value="false">Não</option><option value="true">Sim</option>
                  </select>
                ) : c.tipo === 'select' ? (
                  <select value={val} onChange={(e) => set(c.col, e.target.value)} style={inp}>
                    {(c.opcoes ?? []).map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                  </select>
                ) : c.tipo === 'conta' ? (
                  <>
                    <select value={val} onChange={(e) => set(c.col, e.target.value)} style={inp}>
                      <option value="">— sem conta —</option>
                      {contas.map((o) => <option key={o.id} value={o.id}>{o.nome}{o.banco ? ` · ${o.banco}` : ''}</option>)}
                    </select>
                    {!val && legadoConta && <span style={hintErr}>conta atual (texto legado): {legadoConta}</span>}
                  </>
                ) : c.tipo === 'centro' ? (
                  <>
                    <select value={val} onChange={(e) => set(c.col, e.target.value)} style={inp}>
                      <option value="">— sem centro de custo —</option>
                      {centros.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                    </select>
                    {centros.length === 0 && <span style={hintErr}>nenhum centro · <a href="/dashboard/gestao-empresarial/centros-custo" style={{ color: GOLD }}>cadastrar</a></span>}
                    {!val && legadoCentro && <span style={hintErr}>centro atual (texto legado): {legadoCentro}</span>}
                  </>
                ) : (
                  <input value={val} onChange={(e) => set(c.col, e.target.value)} type={c.tipo === 'date' ? 'date' : 'text'} inputMode={c.tipo === 'num' ? 'decimal' : undefined} style={inp} />
                )}
              </div>
            )
          })}
          {erro && <div style={{ gridColumn: '1 / -1', background: '#FEE2E2', color: '#B91C1C', padding: 10, borderRadius: 6, fontSize: 12 }}>{erro}</div>}
        </div>
      )}
    </Modal>

    {replica && (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(61,35,20,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div style={{ background: '#fff', borderRadius: 14, maxWidth: 460, width: '100%', padding: 20, border: `0.5px solid ${LINE}` }}>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, color: ESP, marginBottom: 4 }}>Essa conta tem {totalGrupo} parcelas</div>
          <div style={{ fontSize: 13, color: ESP, marginBottom: 12 }}>Aplicar a alteração também às demais parcelas <b>não pagas</b>? (as já pagas ficam intactas)</div>
          <div style={{ background: '#FAF7F2', border: `0.5px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
            {Object.keys(replica.campos).map((k) => {
              const label = defs.find((c) => c.col === k)?.label ?? k
              return (
                <div key={k} style={{ fontSize: 12.5, color: ESP, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: ESP60 }}>{label}</span>
                  <b>{orig[k] ? `${orig[k]} → ` : ''}{replica.campos[k] || '—'}</b>
                </div>
              )
            })}
          </div>
          {erro && <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>{erro}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="button" disabled={replicando} onClick={() => void aplicarReplica('proximas')}
              style={{ background: GOLD, color: '#3D2314', border: 'none', padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: replicando ? 'wait' : 'pointer', textAlign: 'left' }}>
              Esta e as próximas <span style={{ opacity: 0.75 }}>({qtdProximas} parcela{qtdProximas === 1 ? '' : 's'} futura{qtdProximas === 1 ? '' : 's'})</span>
            </button>
            <button type="button" disabled={replicando} onClick={() => void aplicarReplica('todas')}
              style={{ background: '#fff', color: ESP, border: `0.5px solid ${GOLD}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: replicando ? 'wait' : 'pointer', textAlign: 'left' }}>
              Todas as parcelas não pagas <span style={{ opacity: 0.6 }}>({replica.outras.length})</span>
            </button>
            <button type="button" disabled={replicando} onClick={() => { setReplica(null); onSucesso() }}
              style={{ background: 'transparent', color: ESP60, border: `0.5px solid ${LINE}`, padding: '9px 14px', borderRadius: 8, fontSize: 13, cursor: replicando ? 'wait' : 'pointer' }}>
              Só esta
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
