'use client'

// #106 (Jordana · Gean): na conciliação, o título a receber PARCIAL abre em linhas — cada pagamento já registrado
// pelo atendente (pago, aguardando o extrato) ou já conciliado, e o saldo em aberto. "Conciliar este pagamento" usa o
// mesmo caminho do "Conciliar" (fn_conciliacao_aplicar_match); o banco liga o crédito à baixa de mesmo valor, sem
// criar outra baixa (fn_receber_conciliacao_sync, #38). Leitura pela RLS da empresa (erp_receber, erp_receber_baixa).

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { linhasDoTitulo, type BaixaTitulo, type LinhaTitulo, type TituloReceber } from '@/lib/conciliacao/baixasTitulo'

interface Props {
  receberId: string
  credito: number
  desabilitado?: boolean
  /** concilia o crédito com o título usando o valor desta linha como referência (sem abrir ajuste à toa) */
  onConciliar: (valorReferencia: number) => void
}

const brl = (n: number) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dataBR = (s: string | null) => { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}` }

export default function PagamentosDoTitulo({ receberId, credito, desabilitado, onConciliar }: Props) {
  const [aberto, setAberto] = useState(false)
  const [linhas, setLinhas] = useState<LinhaTitulo[] | null>(null)
  const [qtdBaixas, setQtdBaixas] = useState(0)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const [{ data: t }, { data: b }] = await Promise.all([
        supabase.from('erp_receber').select('valor, juros, multa, desconto, valor_pago').eq('id', receberId).maybeSingle(),
        supabase.from('erp_receber_baixa').select('id, valor, data, forma, movimento_banco_id').eq('receber_id', receberId).is('deleted_at', null),
      ])
      if (!vivo || !t) return
      const baixas = (b ?? []) as BaixaTitulo[]
      setQtdBaixas(baixas.length)
      setLinhas(linhasDoTitulo(t as TituloReceber, baixas))
    })()
    return () => { vivo = false }
  }, [receberId])

  // título sem pagamento registrado: nada a separar (segue o "Conciliar" de sempre)
  if (!linhas || qtdBaixas === 0) return null

  return (
    <div style={{ marginTop: 6 }} data-testid="conc-pagamentos-titulo">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={() => setAberto(!aberto)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#8B5E3C' }}
          data-testid="conc-pagamentos-expandir"
        >
          {aberto ? '▾' : '▸'} {qtdBaixas} pagamento(s) já registrado(s) · ver separado do saldo
        </button>
        <AjudaCampo chave="conciliacao.pagamentos_titulo" rota="/dashboard/financeiro/conciliacao/inbox" />
      </div>
      {aberto && (
        <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
          {linhas.map((l, i) => {
            const cor = l.tipo === 'aberto' ? '#A35A00' : l.tipo === 'conciliado' ? '#3B6D11' : '#1F5F8B'
            const rotulo = l.tipo === 'aberto' ? 'Saldo em aberto' : l.tipo === 'conciliado' ? 'Conciliado' : 'Pago · aguardando extrato'
            const bate = Math.abs(l.valor - Math.abs(credito)) <= 0.01
            return (
              <div key={l.baixa_id ?? `aberto-${i}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                padding: '6px 8px', background: '#fff', border: `1px solid ${bate && l.tipo !== 'conciliado' ? cor : 'rgba(61,35,20,0.12)'}`, borderRadius: 6,
              }} data-testid={`conc-linha-${l.tipo}`}>
                <div style={{ fontSize: 12, color: '#3D2314' }}>
                  <span style={{ fontWeight: 700, color: cor }}>{rotulo}</span>
                  {' · '}<strong>{brl(l.valor)}</strong>
                  {l.data && <> · {dataBR(l.data)}</>}
                  {l.forma && <> · {l.forma}</>}
                  {bate && l.tipo !== 'conciliado' && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: cor }}>= valor do extrato</span>}
                </div>
                {l.tipo !== 'conciliado' && (
                  <button
                    type="button"
                    disabled={desabilitado}
                    onClick={() => onConciliar(l.valor)}
                    style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: `1px solid ${cor}`, background: bate ? cor : '#fff', color: bate ? '#fff' : cor, cursor: desabilitado ? 'not-allowed' : 'pointer' }}
                    data-testid={`conc-conciliar-${l.tipo}`}
                  >
                    {l.tipo === 'pago' ? 'Conciliar este pagamento' : 'Conciliar com o saldo'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
