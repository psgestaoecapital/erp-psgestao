'use client'
// SPEC · Confirmar consumo de insumos ao concluir um atendimento → baixa do estoque da GE (realizado).
// A ficha técnica padrão é o ponto de partida, EDITÁVEL (o profissional ajusta o que usou de fato).
// [→GE] o estoque é da GE; a odonto dispara o evento. Idempotente + estorno (RD-55). Nunca trava (RD-51).
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { TOK } from './ui'
import { Package, X, Check, RotateCcw, AlertTriangle } from 'lucide-react'

const brl = (n: number) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
type Padrao = { produto_id: string; nome: string; unidade: string | null; quantidade: number; preco: number; estoque_atual: number; sem_preco: boolean }
type Real = { produto_id: string; nome: string; quantidade: number; custo_unitario: number; subtotal: number }
type Consumo = { ok?: boolean; baixado: boolean; padrao: Padrao[]; realizado: Real[] }

export function ConsumoInsumos({ agendamentoId, procedimentoNome, onClose, onDone }: {
  agendamentoId: string; procedimentoNome?: string | null; onClose: () => void; onDone: () => void
}) {
  const [c, setC] = useState<Consumo | null>(null)
  const [loading, setLoading] = useState(true)
  const [qtd, setQtd] = useState<Record<string, string>>({})
  const [inc, setInc] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.rpc('fn_odonto_atendimento_consumo', { p_agendamento_id: agendamentoId })
    const r = data as Consumo | null
    if (r?.ok) {
      setC(r)
      const q: Record<string, string> = {}; const k: Record<string, boolean> = {}
      for (const p of r.padrao) { q[p.produto_id] = String(p.quantidade); k[p.produto_id] = true }
      setQtd(q); setInc(k)
    }
    setLoading(false)
  }, [agendamentoId])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void carregar() }, [carregar])

  const confirmar = async () => {
    if (!c) return
    const itens = c.padrao.filter((p) => inc[p.produto_id]).map((p) => ({ produto_id: p.produto_id, quantidade: Number((qtd[p.produto_id] ?? '0').replace(',', '.')) || 0 })).filter((x) => x.quantidade > 0)
    if (itens.length === 0) { setMsg('Marque ao menos um insumo com quantidade.'); return }
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_odonto_baixar_insumos_atendimento', { p_agendamento_id: agendamentoId, p_itens: itens })
    setBusy(false)
    const r = data as { ok?: boolean; itens?: number; saldo_negativo?: unknown[]; erro?: string } | null
    if (error || !r?.ok) { setMsg(r?.erro || 'Falha ao baixar o consumo.'); return }
    const neg = Array.isArray(r.saldo_negativo) ? r.saldo_negativo.length : 0
    setMsg(neg > 0 ? `Consumo baixado. Atenção: ${neg} insumo(s) ficaram com saldo negativo — reponha no estoque.` : 'Consumo baixado do estoque.')
    await carregar(); onDone()
  }
  const estornar = async () => {
    if (!confirm('Estornar o consumo? As entradas compensatórias voltam ao estoque (o histórico é mantido).')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_odonto_estornar_insumos_atendimento', { p_agendamento_id: agendamentoId })
    setBusy(false)
    if (error || (data as { ok?: boolean })?.ok === false) { setMsg('Falha ao estornar.'); return }
    setMsg('Consumo estornado — insumos devolvidos ao estoque.')
    await carregar(); onDone()
  }

  const totalReal = (c?.realizado ?? []).reduce((s, r) => s + r.subtotal, 0)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(61,35,20,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 560, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: `0.5px solid ${TOK.line}` }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: TOK.gold }}><Package size={16} /> Consumo de insumos{procedimentoNome ? ` · ${procedimentoNome}` : ''}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TOK.mut }}><X size={20} /></button>
        </div>

        <div style={{ padding: 14, overflowY: 'auto' }}>
          <div style={{ fontSize: 11, color: TOK.mut, marginBottom: 10 }}>A baixa sai do <strong>Estoque (GE)</strong> <span style={{ color: TOK.gold, fontWeight: 700 }}>[→GE]</span>. Ajuste as quantidades para o que foi usado de fato.</div>

          {loading ? (
            <div style={{ fontSize: 13, color: TOK.mut }}>Carregando…</div>
          ) : c?.baixado ? (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: TOK.green, marginBottom: 8 }}>✓ Consumo já baixado (realizado)</div>
              <div style={{ border: `0.5px solid ${TOK.line}`, borderRadius: 10, overflow: 'hidden' }}>
                {(c.realizado ?? []).map((r, i) => (
                  <div key={r.produto_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 11px', borderTop: i ? `0.5px solid ${TOK.line}` : 'none' }}>
                    <span style={{ fontSize: 13, color: TOK.esp }}>{r.nome} <span style={{ color: TOK.mut }}>· {r.quantidade} × {brl(r.custo_unitario)}</span></span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: TOK.esp }}>{brl(r.subtotal)}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 11px', borderTop: `1px solid ${TOK.line}`, background: TOK.bg }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Custo de material realizado</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: TOK.gold }}>{brl(totalReal)}</span>
                </div>
              </div>
            </>
          ) : (c?.padrao ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: TOK.mut }}>Este procedimento não tem <strong>ficha técnica</strong> de insumos. Monte em <Link href="/dashboard/odonto/custeio" style={{ color: TOK.gold, fontWeight: 700, textDecoration: 'none' }}>Custeio</Link> para baixar o consumo.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(c?.padrao ?? []).map((p) => (
                <div key={p.produto_id} style={{ display: 'flex', alignItems: 'center', gap: 8, border: `0.5px solid ${inc[p.produto_id] ? TOK.gold : TOK.line}`, borderRadius: 10, padding: '8px 10px' }}>
                  <input type="checkbox" checked={!!inc[p.produto_id]} onChange={(e) => setInc((s) => ({ ...s, [p.produto_id]: e.target.checked }))} style={{ accentColor: TOK.gold }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: TOK.esp }} className="truncate">{p.nome}</div>
                    <div style={{ fontSize: 11, color: p.sem_preco ? TOK.red : TOK.mut }}>
                      {p.sem_preco ? 'sem preço no estoque' : `${brl(p.preco)}/${p.unidade || 'un'}`} · saldo {p.estoque_atual}{Number(qtd[p.produto_id] ?? p.quantidade) > p.estoque_atual ? <span style={{ color: '#B45309' }}> · ficará negativo</span> : ''}
                    </div>
                  </div>
                  <input value={qtd[p.produto_id] ?? ''} onChange={(e) => setQtd((s) => ({ ...s, [p.produto_id]: e.target.value }))} inputMode="decimal"
                    style={{ width: 62, border: `0.5px solid ${TOK.line}`, borderRadius: 8, padding: '6px 8px', fontSize: 13, color: TOK.esp, textAlign: 'center' }} />
                  <span style={{ fontSize: 11, color: TOK.mut, width: 26 }}>{p.unidade || 'un'}</span>
                </div>
              ))}
            </div>
          )}
          {msg && <div style={{ fontSize: 12.5, color: TOK.esp, marginTop: 10 }}>{msg}</div>}
        </div>

        <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: `0.5px solid ${TOK.line}`, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {c?.baixado ? (
            <button onClick={() => void estornar()} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `0.5px solid ${TOK.line}`, borderRadius: 999, padding: '8px 16px', fontSize: 13, fontWeight: 600, color: TOK.red, cursor: busy ? 'not-allowed' : 'pointer' }}><RotateCcw size={14} /> Estornar consumo</button>
          ) : (c?.padrao ?? []).length > 0 ? (
            <>
              {(c?.padrao ?? []).some((p) => p.sem_preco) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#B45309' }}><AlertTriangle size={13} /> insumo sem preço</span>}
              <button onClick={() => void confirmar()} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}><Check size={16} /> {busy ? 'Baixando…' : 'Confirmar consumo (baixar)'}</button>
            </>
          ) : (
            <button onClick={onClose} style={{ background: TOK.gold, color: '#fff', border: 'none', borderRadius: 999, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>Fechar</button>
          )}
        </div>
      </div>
    </div>
  )
}
