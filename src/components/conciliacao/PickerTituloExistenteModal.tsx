'use client'

// Modal picker REVERSO da conciliacao: dado um MOVIMENTO bancario pendente,
// lista titulos (erp_pagar se debito | erp_receber se credito) da mesma empresa
// abertos/vencidos/parciais e permite ao usuario escolher o titulo correto.
// Ao aplicar chama fn_conciliacao_aplicar_match — o trigger trg_baixa_por_conciliacao
// cuida da baixa. Espelha o ConciliarTituloModal (fluxo direto).

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Natureza = 'credito' | 'debito' | string
type LancamentoTabela = 'erp_pagar' | 'erp_receber'

type Candidato = {
  id: string
  descricao: string | null
  nome_pessoa: string | null
  numero_documento: string | null
  valor: number
  valor_pago: number | null
  data_vencimento: string
  status: string
  diff_valor: number
  diff_dias: number
  score: number
}

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  companyId: string
  movimentoId: string
  movimentoDescricao: string
  movimentoValor: number
  movimentoData: string          // YYYY-MM-DD
  movimentoNatureza: Natureza
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const fmtData = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function diasEntre(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime()
  const db = new Date(b + 'T00:00:00Z').getTime()
  return Math.round((da - db) / (1000 * 60 * 60 * 24))
}

export default function PickerTituloExistenteModal({
  open, onClose, onSucesso,
  companyId, movimentoId, movimentoDescricao, movimentoValor, movimentoData, movimentoNatureza,
}: Props) {
  const tabela: LancamentoTabela = movimentoNatureza === 'credito' ? 'erp_receber' : 'erp_pagar'
  const [candidatos, setCandidatos] = useState<Candidato[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dias, setDias] = useState(30)
  const [busca, setBusca] = useState('')
  const [selecionado, setSelecionado] = useState<Candidato | null>(null)
  const [aplicando, setAplicando] = useState(false)

  useEffect(() => {
    if (!open || !companyId || !movimentoId) return
    setSelecionado(null); setErro(null); setLoading(true)
    // Janela +/- dias em torno da data do movimento
    const d = new Date(movimentoData + 'T00:00:00Z')
    const de = new Date(d); de.setUTCDate(de.getUTCDate() - dias)
    const ate = new Date(d); ate.setUTCDate(ate.getUTCDate() + dias)
    const iso = (x: Date) => x.toISOString().slice(0, 10)

    supabase.from(tabela)
      .select('id, descricao, nome_pessoa, numero_documento, valor, valor_pago, data_vencimento, status')
      .eq('company_id', companyId)
      .in('status', ['aberto', 'vencido', 'parcial'])
      .gte('data_vencimento', iso(de))
      .lte('data_vencimento', iso(ate))
      .order('data_vencimento', { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        setLoading(false)
        if (error) { setErro(error.message); return }
        type Row = {
          id: string; descricao: string | null; nome_pessoa: string | null
          numero_documento: string | null; valor: number
          valor_pago: number | null; data_vencimento: string; status: string
        }
        const rows = (data ?? []) as Row[]
        const lista: Candidato[] = rows.map((r) => {
          const saldo = Math.max(0, Number(r.valor) - Number(r.valor_pago ?? 0))
          const alvo = movimentoValor
          const diff_valor = saldo - alvo
          const diff_dias = diasEntre(r.data_vencimento, movimentoData)
          // score: 60 por valor + 40 por data
          const scoreValor = Math.max(0, 60 - Math.min(60, (Math.abs(diff_valor) / Math.max(alvo, 1)) * 300))
          const scoreData = Math.max(0, 40 - Math.min(40, Math.abs(diff_dias) * 3))
          return {
            id: r.id, descricao: r.descricao, nome_pessoa: r.nome_pessoa,
            numero_documento: r.numero_documento, valor: Number(r.valor),
            valor_pago: r.valor_pago, data_vencimento: r.data_vencimento, status: r.status,
            diff_valor, diff_dias, score: scoreValor + scoreData,
          }
        }).sort((a, b) => {
          const av = Math.abs(a.diff_valor); const bv = Math.abs(b.diff_valor)
          if (Math.abs(av - bv) > 0.01) return av - bv
          return Math.abs(a.diff_dias) - Math.abs(b.diff_dias)
        })
        setCandidatos(lista)
      })
  }, [open, companyId, movimentoId, movimentoData, dias, tabela, movimentoValor])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return candidatos
    return candidatos.filter((c) => {
      const hay = `${c.descricao ?? ''} ${c.nome_pessoa ?? ''} ${c.numero_documento ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [candidatos, busca])

  const matchExato = useMemo(
    () => candidatos.find((c) => Math.abs(c.diff_valor) < 0.01) ?? null,
    [candidatos],
  )

  async function aplicar() {
    if (!selecionado) return
    setAplicando(true); setErro(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
        p_movimento_id: movimentoId,
        p_lancamento_tabela: tabela,
        p_lancamento_id: selecionado.id,
        p_operador_id: user?.id ?? null,
        p_origem: 'manual_reverso',
      })
      if (error) { setErro(error.message); return }
      const first = Array.isArray(data) ? data[0] : data
      const status = (first as { status_resultado?: string } | null)?.status_resultado ?? 'conciliado'
      if (status !== 'conciliado') {
        setErro((first as { mensagem?: string } | null)?.mensagem ?? 'nao foi possivel conciliar')
        return
      }
      onSucesso()
      onClose()
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setAplicando(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FAF7F2', borderRadius: 12,
          maxWidth: 760, width: '100%', maxHeight: '92vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '0.5px solid rgba(61,35,20,0.15)' }}>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Vincular movimento a título existente
          </div>
          <div style={{ fontSize: 15, color: '#3D2314', fontWeight: 600 }}>
            {movimentoDescricao}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.7)', marginTop: 4 }}>
            {fmtBRL(movimentoValor)} · {fmtData(movimentoData)} · buscando em <b>{tabela === 'erp_pagar' ? 'Contas a Pagar' : 'Contas a Receber'}</b>
          </div>
        </div>

        {/* Filtros */}
        <div style={{ padding: '10px 20px', borderBottom: '0.5px solid rgba(61,35,20,0.08)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="buscar por descrição, quem, documento..."
            style={{
              flex: 1, minWidth: 180, padding: '6px 10px',
              border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6,
              fontSize: 12, background: '#FFFFFF', color: '#3D2314',
            }}
          />
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            style={{ padding: '6px 10px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 12, background: '#FFFFFF', color: '#3D2314' }}>
            <option value={7}>± 7 dias</option>
            <option value={15}>± 15 dias</option>
            <option value={30}>± 30 dias</option>
            <option value={60}>± 60 dias</option>
            <option value={180}>± 180 dias</option>
          </select>
          {matchExato && (
            <span style={{ fontSize: 11, background: '#DCFCE7', color: '#16A34A', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
              🎯 valor exato encontrado
            </span>
          )}
        </div>

        {/* Lista */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 12px' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(61,35,20,0.55)' }}>
              Buscando títulos compatíveis...
            </div>
          ) : erro ? (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: 12, borderRadius: 6, margin: 8, fontSize: 13 }}>{erro}</div>
          ) : filtrados.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 13 }}>
              Nenhum título compatível na janela ± {dias} dias.
              <div style={{ fontSize: 12, marginTop: 6, color: 'rgba(61,35,20,0.5)' }}>
                Aumente a janela ou verifique se a conta já foi cadastrada.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filtrados.map((c) => {
                const ativo = selecionado?.id === c.id
                const exato = Math.abs(c.diff_valor) < 0.01
                const saldo = Math.max(0, c.valor - Number(c.valor_pago ?? 0))
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelecionado(c)}
                    style={{
                      textAlign: 'left', padding: '10px 12px',
                      background: ativo ? '#FEF3C7' : '#FFFFFF',
                      border: `0.5px solid ${ativo ? '#C8941A' : 'rgba(61,35,20,0.12)'}`,
                      borderRadius: 8, cursor: 'pointer',
                      display: 'flex', gap: 12, alignItems: 'center',
                    }}
                  >
                    <input type="radio" checked={ativo} readOnly aria-label="Selecionar título" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#3D2314', fontSize: 14 }}>{fmtBRL(saldo)}</strong>
                        {exato ? (
                          <span style={{ fontSize: 10, background: '#DCFCE7', color: '#16A34A', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
                            EXATO
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: c.diff_valor > 0 ? '#16A34A' : '#DC2626' }}>
                            {c.diff_valor > 0 ? '+' : ''}{fmtBRL(c.diff_valor)}
                          </span>
                        )}
                        <span style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)' }}>
                          vence {fmtData(c.data_vencimento)}
                          {c.diff_dias !== 0 && (
                            <span style={{ color: 'rgba(61,35,20,0.5)', marginLeft: 4 }}>
                              ({c.diff_dias > 0 ? '+' : ''}{c.diff_dias}d)
                            </span>
                          )}
                        </span>
                        <span style={{ fontSize: 9, background: c.status === 'vencido' ? '#FEE2E2' : c.status === 'parcial' ? '#FEF3C7' : '#F3EFE8', color: 'rgba(61,35,20,0.7)', padding: '2px 6px', borderRadius: 3, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                          {c.status}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.85)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>{c.descricao ?? '—'}</strong>
                        {c.nome_pessoa && <> · {c.nome_pessoa}</>}
                        {c.numero_documento && <> · nº {c.numero_documento}</>}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', fontWeight: 600 }}>
                      score {Math.round(c.score)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Rodape */}
        <div style={{ padding: '14px 20px', borderTop: '0.5px solid rgba(61,35,20,0.15)', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ marginRight: 'auto', fontSize: 11, color: 'rgba(61,35,20,0.55)' }}>
            {selecionado && Math.abs(selecionado.diff_valor) >= 0.01 && (
              <>Diferença: <strong>{fmtBRL(Math.abs(selecionado.diff_valor))}</strong> — o título ficará como <strong>parcial</strong>.</>
            )}
          </div>
          <button
            type="button" onClick={onClose} disabled={aplicando}
            style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: aplicando ? 'not-allowed' : 'pointer' }}
          >Cancelar</button>
          <button
            type="button" onClick={aplicar} disabled={!selecionado || aplicando}
            style={{
              background: (!selecionado || aplicando) ? 'rgba(200,148,26,0.4)' : '#C8941A',
              color: '#3D2314', border: 'none', padding: '8px 20px',
              borderRadius: 6, fontSize: 13, fontWeight: 600,
              cursor: (!selecionado || aplicando) ? 'not-allowed' : 'pointer',
            }}
          >
            {aplicando ? 'Vinculando...' : 'CONCILIAR (baixa automática)'}
          </button>
        </div>
      </div>
    </div>
  )
}
