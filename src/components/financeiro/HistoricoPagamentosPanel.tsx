'use client'

// #3188 (Jordana · Gean) · aba "Histórico de pagamentos" da ficha do título (Receitas e Despesas): uma linha por baixa
// (data, valor, forma, conta, quem registrou e quando, Recebido/Pago ou Conciliado) e o rodapé com valor do título,
// total pago e saldo em aberto. Só leitura, tudo sob RLS (baixas, extrato importado, contas) + fn_usuario_nome.
// A montagem é a função pura src/lib/financeiro/historicoPagamentos.ts (provada no gate check-historico-pagamentos).

import React, { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { montarHistoricoPagamentos, type BaixaBruta, type HistoricoPagamentos, type TipoTitulo } from '@/lib/financeiro/historicoPagamentos'

// rota única dos textos do "?" deste painel (aparece em Receitas e em Despesas)
const ROTA_AJUDA = '/dashboard/financeiro/historico-pagamentos'
const ESP = '#3D2314'
const ESP60 = 'rgba(61,35,20,0.6)'
const LINE = '#E7DECF'
const GOLD = '#C8941A'

const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtDia = (iso: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('T')[0].split('-')
  return y && m && d ? `${d}/${m}/${y}` : iso
}
const fmtQuando = (iso: string | null) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

async function nomesContas(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  const { data } = await supabase.from('erp_banco_contas').select('id, nome').in('id', ids)
  const out: Record<string, string> = {}
  ;((data ?? []) as { id: string; nome: string | null }[]).forEach((c) => { if (c.nome) out[c.id] = c.nome })
  return out
}

export default function HistoricoPagamentosPanel({ tipo, tituloId }: { tipo: TipoTitulo; tituloId: string }) {
  const [hist, setHist] = useState<HistoricoPagamentos | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setHist(null); setErro(null)
    ;(async () => {
      const tabela = tipo === 'receber' ? 'erp_receber' : 'erp_pagar'
      const colTitulo = tipo === 'receber' ? 'valor, conta_bancaria, conta_bancaria_id' : 'valor, conta_bancaria'
      const [{ data: titulo, error: e1 }, { data: baixas, error: e2 }] = await Promise.all([
        supabase.from(tabela).select(colTitulo).eq('id', tituloId).maybeSingle(),
        supabase.from(tipo === 'receber' ? 'erp_receber_baixa' : 'erp_pagar_baixa')
          .select('id, valor, data, forma, origem, movimento_banco_id, criado_por, criado_em')
          .eq(tipo === 'receber' ? 'receber_id' : 'pagar_id', tituloId)
          .is('deleted_at', null),
      ])
      if (!vivo) return
      if (e1 || e2) { setErro('Não foi possível carregar os pagamentos deste título.'); return }
      const t = (titulo ?? {}) as { valor?: number; conta_bancaria?: string | null; conta_bancaria_id?: string | null }
      const lista = (baixas ?? []) as BaixaBruta[]

      // conta de cada baixa conciliada = conta do extrato importado (movimento → lote → conta)
      const movIds = Array.from(new Set(lista.map((b) => b.movimento_banco_id).filter((x): x is string => !!x)))
      const contaPorMovimento: Record<string, string> = {}
      let contaTitulo = t.conta_bancaria ?? null
      if (movIds.length > 0) {
        const { data: movs } = await supabase.from('conciliacao_movimento').select('id, lote_id').in('id', movIds)
        const loteIds = Array.from(new Set(((movs ?? []) as { lote_id: string | null }[]).map((m) => m.lote_id).filter((x): x is string => !!x)))
        const { data: lotes } = loteIds.length ? await supabase.from('conciliacao_lote').select('id, conta_bancaria_id').in('id', loteIds) : { data: [] }
        const contaPorLote: Record<string, string> = {}
        ;((lotes ?? []) as { id: string; conta_bancaria_id: string | null }[]).forEach((l) => { if (l.conta_bancaria_id) contaPorLote[l.id] = l.conta_bancaria_id })
        const nomes = await nomesContas(Array.from(new Set([...Object.values(contaPorLote), ...(t.conta_bancaria_id ? [t.conta_bancaria_id] : [])])))
        ;((movs ?? []) as { id: string; lote_id: string | null }[]).forEach((m) => {
          const c = m.lote_id ? contaPorLote[m.lote_id] : undefined
          if (c && nomes[c]) contaPorMovimento[m.id] = nomes[c]
        })
        if (t.conta_bancaria_id && nomes[t.conta_bancaria_id]) contaTitulo = nomes[t.conta_bancaria_id]
      } else if (t.conta_bancaria_id) {
        const nomes = await nomesContas([t.conta_bancaria_id])
        if (nomes[t.conta_bancaria_id]) contaTitulo = nomes[t.conta_bancaria_id]
      }

      // quem registrou: poucos usuários por título → uma chamada por usuário distinto
      const usuarios = Array.from(new Set(lista.map((b) => b.criado_por).filter((x): x is string => !!x)))
      const nomePorUsuario: Record<string, string> = {}
      await Promise.all(usuarios.map(async (u) => {
        const { data } = await supabase.rpc('fn_usuario_nome', { p_id: u })
        if (typeof data === 'string' && data.trim()) nomePorUsuario[u] = data.trim()
      }))
      if (!vivo) return
      setHist(montarHistoricoPagamentos({ tipo, valorTitulo: t.valor ?? 0, contaTitulo, baixas: lista, contaPorMovimento, nomePorUsuario }))
    })()
    return () => { vivo = false }
  }, [tipo, tituloId])

  const verbo = tipo === 'receber' ? 'recebimento' : 'pagamento'
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700, color: ESP60, textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: `1px solid ${LINE}`, whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '10px', fontSize: 13, color: ESP, borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' }
  const rotulo = (txt: string, chave: string) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{txt}<AjudaCampo chave={chave} rota={ROTA_AJUDA} /></span>
  )

  return (
    <div data-testid="historico-pagamentos" style={{ padding: '20px 24px 24px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 17, color: ESP }}>Histórico de {tipo === 'receber' ? 'recebimentos' : 'pagamentos'}</h3>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: ESP60 }}>Cada {verbo} registrado neste título, do mais antigo ao mais recente.</p>

      {erro && <div style={{ color: '#A32D2D', fontSize: 13 }}>{erro}</div>}
      {!erro && !hist && <div style={{ color: ESP60, fontSize: 13 }}>Carregando…</div>}
      {hist && hist.linhas.length === 0 && (
        <div data-testid="historico-pagamentos-vazio" style={{ color: ESP60, fontSize: 13, padding: '12px 0' }}>Nenhum {verbo} registrado neste título ainda.</div>
      )}

      {hist && hist.linhas.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
            <thead>
              <tr>
                <th style={th}>{rotulo('Data', 'financeiro.historico_pagamentos.data')}</th>
                <th style={{ ...th, textAlign: 'right' }}>{rotulo('Valor', 'financeiro.historico_pagamentos.valor')}</th>
                <th style={th}>{rotulo('Forma', 'financeiro.historico_pagamentos.forma')}</th>
                <th style={th}>{rotulo('Conta', 'financeiro.historico_pagamentos.conta')}</th>
                <th style={th}>{rotulo('Registrado por', 'financeiro.historico_pagamentos.usuario')}</th>
                <th style={th}>{rotulo('Situação', 'financeiro.historico_pagamentos.status')}</th>
              </tr>
            </thead>
            <tbody>
              {hist.linhas.map((l) => (
                <tr key={l.id} data-testid="historico-pagamentos-linha">
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDia(l.data)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, whiteSpace: 'nowrap' }}>{fmtBRL(l.valor)}</td>
                  <td style={td}>{l.forma}</td>
                  <td style={td}>{l.conta}</td>
                  <td style={td}>{l.usuario}<div style={{ fontSize: 11, color: ESP60 }}>{fmtQuando(l.registradoEm)}</div></td>
                  <td style={td}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
                      color: l.status === 'Conciliado' ? '#0F6E56' : '#854F0B',
                      background: l.status === 'Conciliado' ? 'rgba(15,110,86,0.10)' : 'rgba(200,148,26,0.14)' }}>{l.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hist && (
        <div data-testid="historico-pagamentos-rodape" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 16 }}>
          {[
            { t: 'Valor do título', v: hist.valorTitulo, chave: 'financeiro.historico_pagamentos.valor_titulo', cor: ESP },
            { t: tipo === 'receber' ? 'Total recebido' : 'Total pago', v: hist.totalPago, chave: 'financeiro.historico_pagamentos.total_pago', cor: '#0F6E56' },
            { t: 'Saldo em aberto', v: hist.saldoAberto, chave: 'financeiro.historico_pagamentos.saldo_aberto', cor: hist.saldoAberto > 0 ? GOLD : ESP },
          ].map((k) => (
            <div key={k.t} style={{ flex: '1 1 160px', border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 14px', background: '#FAF7F2' }}>
              <div style={{ fontSize: 11.5, color: ESP60, fontWeight: 600 }}>{rotulo(k.t, k.chave)}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: k.cor, fontVariantNumeric: 'tabular-nums' }}>{fmtBRL(k.v)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
