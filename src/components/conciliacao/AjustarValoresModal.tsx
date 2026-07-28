'use client'

// AjustarValoresModal · Sub-frente 4.2 Onda 4 (CEO 27/05/2026) + melhorias 28/07/2026:
//  (1) Backdrop NÃO fecha (evita perder o ajuste com clique acidental) — só Cancelar/X, com confirmação
//      de descarte se houver algo digitado.
//  (2) VALOR da conta EDITÁVEL: conta recorrente (energia/água/telefone) vem programada com valor estimado;
//      quando a fatura real chega diferente, o operador corrige o valor REAL do título — não é juros/desconto.
//      Persiste via fn_conciliacao_ajustar_valores(p_valor_novo) com trilha de→para na observação; o recompute
//      (soma vs líquido = valor+juros−desconto) fecha o status sozinho. Aviso (não bloqueia) se já pago/conciliado.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  lancamentoId: string
  tipo: 'pagar' | 'receber'
  valorOriginal: number
  valorBanco?: number | null
  descricao?: string
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type Modo = 'parcial' | 'desconto'

export default function AjustarValoresModal({
  open, onClose, onSucesso, lancamentoId, tipo, valorOriginal, valorBanco, descricao,
}: Props) {
  const tabela = tipo === 'pagar' ? 'erp_pagar' : 'erp_receber'
  const [valorConta, setValorConta] = useState(String(valorOriginal ?? ''))
  const [juros, setJuros] = useState('')
  const [desconto, setDesconto] = useState('')
  const [obs, setObs] = useState('')
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [modo, setModo] = useState<Modo>('parcial')
  const [mexeu, setMexeu] = useState(false)            // usuário tocou juros/desconto manualmente
  const [pagoConciliado, setPagoConciliado] = useState(false)

  const valorContaNum = Number(String(valorConta).replace(',', '.')) || 0
  const valorMudou = Math.round(valorContaNum * 100) !== Math.round((valorOriginal ?? 0) * 100)
  const diferenca = (valorBanco ?? valorContaNum) - valorContaNum
  const recebeuMenos = diferenca < -0.001
  const recebeuMais = diferenca > 0.001

  // reset ao abrir + puxa status do título (aviso pago/conciliado, como no editor F2)
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect */
    setValorConta(String(valorOriginal ?? ''))
    setObs(''); setErro(null); setMexeu(false)
    setModo((valorBanco ?? valorOriginal) - valorOriginal < -0.001 ? 'parcial' : 'desconto')
    /* eslint-enable react-hooks/set-state-in-effect */
    supabase.from(tabela).select('status, conciliado, movimento_banco_id').eq('id', lancamentoId).maybeSingle()
      .then(({ data }) => {
        const d = data as { status?: string | null; conciliado?: boolean | null; movimento_banco_id?: string | null } | null
        setPagoConciliado(!!d && (d.status === 'pago' || !!d.conciliado || d.movimento_banco_id != null))
      })
  }, [open, lancamentoId, tabela, valorOriginal, valorBanco])

  // enquanto o operador não mexe manualmente, sugere juros/desconto = diferença entre banco e o VALOR DA CONTA.
  // Ao corrigir o valor da conta p/ o valor real, a diferença some e a sugestão zera (não vira juros indevido).
  useEffect(() => {
    if (!open || mexeu) return
    const dif = (valorBanco ?? valorContaNum) - valorContaNum
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    if (dif > 0.001) { setJuros(dif.toFixed(2)); setDesconto('') }
    else if (dif < -0.001) { setDesconto(Math.abs(dif).toFixed(2)); setJuros('') }
    else { setJuros(''); setDesconto('') }
  }, [open, mexeu, valorConta, valorBanco, valorContaNum])

  const valorAjustado = useMemo(() => {
    const j = Number(juros) || 0
    const d = Number(desconto) || 0
    return valorContaNum + j - d
  }, [juros, desconto, valorContaNum])

  const sujo = mexeu || obs.trim() !== '' || valorMudou

  function fecharComGuarda() {
    if (sujo && !window.confirm('Descartar o ajuste? O que você digitou será perdido.')) return
    onClose()
  }

  async function confirmar() {
    if (valorContaNum <= 0) { setErro('O valor da conta deve ser maior que zero.'); return }
    setLoading(true); setErro(null)

    // caminho PARCIAL ("deixar em aberto"): se o valor foi corrigido, persiste a correção primeiro (só valor),
    // depois registra o recebido/pago parcial (mantém saldo em aberto → título 'parcial').
    if (recebeuMenos && modo === 'parcial') {
      if (valorMudou) {
        const { data: dv, error: ev } = await supabase.rpc('fn_conciliacao_ajustar_valores', {
          p_lancamento_id: lancamentoId, p_tipo: tipo, p_valor_juros: 0, p_valor_desconto: 0,
          p_observacao: obs.trim() || null, p_valor_novo: valorContaNum,
        })
        if (ev || (dv as { sucesso?: boolean; erro?: string } | null)?.sucesso === false) {
          setLoading(false); setErro(ev?.message ?? (dv as { erro?: string })?.erro ?? 'Falha ao corrigir o valor'); return
        }
      }
      const hoje = new Date().toISOString().slice(0, 10)
      const rpcName = tipo === 'receber' ? 'fn_receber_registrar_recebimento' : 'fn_pagar_registrar_pagamento'
      const params = tipo === 'receber'
        ? { p_receber_id: lancamentoId, p_data_pagamento: hoje, p_valor_recebido: valorBanco ?? 0, p_forma_pagamento: 'PIX', p_observacao: obs.trim() || null }
        : { p_pagar_id: lancamentoId, p_data_pagamento: hoje, p_valor_pago: valorBanco ?? 0, p_forma_pagamento: 'PIX', p_observacao: obs.trim() || null }
      const { data, error } = await supabase.rpc(rpcName, params)
      setLoading(false)
      if (error) { setErro(error.message); return }
      const r = data as { sucesso?: boolean; erro?: string } | null
      if (r && r.sucesso === false) { setErro(r.erro ?? 'Erro no registro parcial'); return }
      onSucesso(); onClose()
      return
    }

    // caminho QUITA: corrige valor (se mudou) + aplica juros/desconto por cima; recompute fecha o status.
    const { data, error } = await supabase.rpc('fn_conciliacao_ajustar_valores', {
      p_lancamento_id: lancamentoId, p_tipo: tipo,
      p_valor_juros: Number(juros) || 0, p_valor_desconto: Number(desconto) || 0,
      p_observacao: obs.trim() || null, p_valor_novo: valorMudou ? valorContaNum : null,
    })
    setLoading(false)
    if (error) { setErro(error.message); return }
    if ((data as { sucesso?: boolean; erro?: string } | null)?.sucesso === false) {
      setErro((data as { erro?: string }).erro ?? 'Falha ao ajustar'); return
    }
    onSucesso(); onClose()
  }

  if (!open) return null

  return (
    <div onClick={() => { /* backdrop NÃO fecha — evita perder o ajuste com clique acidental */ }} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <h2 style={h2}>Ajustar valores</h2>
          <button type="button" aria-label="Fechar" onClick={fecharComGuarda} style={xBtn}>✕</button>
        </div>
        {descricao && <p style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 4, marginBottom: 14 }}>{descricao}</p>}

        {pagoConciliado && (
          <div style={{ background: '#FEF3C7', color: '#7A5A0F', border: '0.5px solid rgba(200,148,26,0.35)', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12 }}>
            ⚠️ Este lançamento já está <b>pago/conciliado</b>. Ajustar o valor aqui altera o título e a baixa é
            recalculada — confira antes de confirmar. (Não bloqueia.)
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <label style={{ display: 'block' }}>
            <span style={labelSpan}>✏️ Valor da conta (editável)</span>
            <input
              type="number" step="0.01" min="0" value={valorConta}
              onChange={(e) => setValorConta(e.target.value)}
              style={{ ...input, fontWeight: 700, border: '1px solid #C8941A', background: '#FFFDF6' }}
              title="Valor real do título. Para conta recorrente (energia/água), corrija aqui quando a fatura vier diferente do programado."
            />
            <span style={{ fontSize: 10.5, color: valorMudou ? '#854F0B' : 'rgba(61,35,20,0.5)', display: 'block', marginTop: 3 }}>
              {valorMudou ? `editado de R$ ${fmtBRL(valorOriginal)}` : 'clique para corrigir o valor real do título'}
            </span>
          </label>
          {valorBanco != null && (
            <Info label={tipo === 'receber' ? 'Valor recebido' : 'Valor pago'} valor={`R$ ${fmtBRL(valorBanco)}`} cor="#3D2314" />
          )}
        </div>

        {valorBanco != null && Math.abs(diferenca) > 0.001 && (
          <div style={{ background: '#FAEEDA', border: '0.5px solid rgba(186,117,23,0.3)', padding: '8px 12px', borderRadius: 6, marginBottom: 12, fontSize: 12, color: '#854F0B' }}>
            Diferença (banco − conta): <strong>{diferenca > 0 ? '+' : '−'} R$ {fmtBRL(Math.abs(diferenca))}</strong>
            {recebeuMais ? ' · juros/acréscimo ou corrija o valor da conta acima' : recebeuMenos ? ' · escolha como tratar o saldo' : ''}
          </div>
        )}

        {recebeuMenos && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button type="button" onClick={() => setModo('parcial')} style={modoBtn(modo === 'parcial')}>
              🟢 Pagamento parcial
            </button>
            <button type="button" onClick={() => setModo('desconto')} style={modoBtn(modo === 'desconto')}>
              Desconto (quitar)
            </button>
          </div>
        )}

        {recebeuMenos && modo === 'parcial' ? (
          <div style={{ background: '#EAF3DE', border: '0.5px solid rgba(59,109,17,0.25)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#3B6D11' }}>
            Conta R$ {fmtBRL(valorContaNum)}{valorMudou ? ` (editado de R$ ${fmtBRL(valorOriginal)})` : ''} · {tipo === 'receber' ? 'Recebido' : 'Pago'} R$ {fmtBRL(valorBanco ?? 0)} · Saldo em aberto R$ {fmtBRL(Math.max(valorContaNum - (valorBanco ?? 0), 0))} · título fica <strong>PARCIAL</strong>.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <Field label="Juros R$">
                <input type="number" step="0.01" min="0" value={juros} onChange={(e) => { setMexeu(true); setJuros(e.target.value) }} placeholder="0,00" style={input} />
              </Field>
              <Field label="Desconto R$">
                <input type="number" step="0.01" min="0" value={desconto} onChange={(e) => { setMexeu(true); setDesconto(e.target.value) }} placeholder="0,00" style={input} />
              </Field>
            </div>
            <div style={{ background: '#EAF3DE', border: '0.5px solid rgba(59,109,17,0.25)', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: 13, color: '#3B6D11' }}>
              Valor da conta R$ {fmtBRL(valorContaNum)}{valorMudou ? ` (editado de R$ ${fmtBRL(valorOriginal)})` : ''} + juros R$ {fmtBRL(Number(juros) || 0)} − desconto R$ {fmtBRL(Number(desconto) || 0)} = <strong>R$ {fmtBRL(valorAjustado)}</strong> · título quita.
            </div>
          </>
        )}

        <Field label="Observação">
          <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Detalhes do ajuste (opcional)" style={input} />
        </Field>

        {erro && <div style={erroBox}>{erro}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
          <button onClick={fecharComGuarda} disabled={loading} style={secondaryBtn(loading)}>Cancelar</button>
          <button onClick={confirmar} disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Salvando…' : recebeuMenos && modo === 'parcial' ? 'Registrar parcial' : 'Confirmar ajuste'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Info({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <div style={{ background: '#FAF7F2', border: '0.5px solid rgba(61,35,20,0.08)', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: cor, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={labelSpan}>{label}</span>
      {children}
    </label>
  )
}

const labelSpan: React.CSSProperties = { fontSize: 10, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, display: 'block', marginBottom: 4 }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }
const modal: React.CSSProperties = { background: '#FFFFFF', borderRadius: 12, padding: 24, maxWidth: 480, width: '100%' }
const h2: React.CSSProperties = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, fontWeight: 400, color: '#3D2314', margin: 0 }
const xBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 2 }
const input: React.CSSProperties = { width: '100%', background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.2)', borderRadius: 6, padding: '8px 10px', fontSize: 13, color: '#3D2314', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' as const }
const erroBox: React.CSSProperties = { background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginTop: 8 }
function primaryBtn(loading: boolean): React.CSSProperties {
  return { background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A', color: '#3D2314', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }
}
function secondaryBtn(disabled: boolean): React.CSSProperties {
  return { background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)', padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer' }
}
function modoBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    background: active ? '#3D2314' : '#FAF7F2',
    color: active ? '#FAF7F2' : '#3D2314',
    border: active ? '0.5px solid #3D2314' : '0.5px solid rgba(61,35,20,0.18)',
    padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
  }
}
