'use client'

// Modal picker: dado um titulo (erp_pagar ou erp_receber), lista movimentos
// bancarios compativeis (fn_movimentos_compativeis_titulo) e permite ao usuario
// escolher qual movimento representa esse titulo. Ao aplicar, chama
// fn_conciliacao_aplicar_match — o trigger trg_baixa_por_conciliacao cuida da
// baixa automatica em erp_pagar/erp_receber. Nunca chama baixa manual daqui.

import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type TituloTabela = 'erp_pagar' | 'erp_receber'

type Candidato = {
  id: string
  lote_id: string
  conta_bancaria_id: string | null
  data_transacao: string
  valor: number
  descricao: string
  natureza: 'credito' | 'debito'
  documento: string | null
  match_score: number
  diff_valor: number
  diff_dias: number
}

interface Props {
  open: boolean
  onClose: () => void
  onSucesso: () => void
  tituloTabela: TituloTabela
  tituloId: string
  tituloDescricao: string
  tituloValor: number
  tituloVencimento: string
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const fmtData = (iso: string) => {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export default function ConciliarTituloModal({
  open, onClose, onSucesso,
  tituloTabela, tituloId, tituloDescricao, tituloValor, tituloVencimento,
}: Props) {
  const [candidatos, setCandidatos] = useState<Candidato[]>([])
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dias, setDias] = useState(15)
  const [selecionado, setSelecionado] = useState<Candidato | null>(null)
  const [aplicando, setAplicando] = useState(false)

  useEffect(() => {
    if (!open) return
    setSelecionado(null)
    setErro(null)
    setLoading(true)
    supabase
      .rpc('fn_movimentos_compativeis_titulo', {
        p_titulo_tabela: tituloTabela,
        p_titulo_id: tituloId,
        p_dias: dias,
      })
      .then(({ data, error }) => {
        setLoading(false)
        if (error) { setErro(error.message); return }
        setCandidatos((data as Candidato[]) ?? [])
      })
  }, [open, tituloTabela, tituloId, dias])

  const matchCheio = useMemo(() => {
    return candidatos.find((c) => Math.abs(c.diff_valor) < 0.01) ?? null
  }, [candidatos])

  async function aplicar() {
    if (!selecionado) return
    setAplicando(true)
    setErro(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
        p_movimento_id: selecionado.id,
        p_lancamento_tabela: tituloTabela,
        p_lancamento_id: tituloId,
        p_operador_id: user?.id ?? null,
        p_origem: 'manual_titulo',
      })
      if (error) { setErro(error.message); return }
      const first = Array.isArray(data) ? data[0] : data
      const status = (first as { status_resultado?: string } | null)?.status_resultado ?? 'conciliado'
      if (status !== 'conciliado') {
        const msg = (first as { mensagem?: string } | null)?.mensagem ?? 'nao foi possivel conciliar'
        setErro(msg)
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
          maxWidth: 720, width: '100%', maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ padding: '18px 20px', borderBottom: '0.5px solid rgba(61,35,20,0.15)' }}>
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            Conciliar com extrato bancário
          </div>
          <div style={{ fontSize: 16, color: '#3D2314', fontWeight: 600 }}>
            {tituloDescricao}
          </div>
          <div style={{ fontSize: 13, color: 'rgba(61,35,20,0.7)', marginTop: 4 }}>
            {fmtBRL(tituloValor)} · vence {fmtData(tituloVencimento)}
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderBottom: '0.5px solid rgba(61,35,20,0.08)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'rgba(61,35,20,0.7)' }}>Janela ± dias do vencimento:</label>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            style={{ padding: '4px 8px', border: '0.5px solid rgba(61,35,20,0.25)', borderRadius: 6, fontSize: 12, background: '#FFFFFF', color: '#3D2314' }}>
            <option value={7}>7 dias</option>
            <option value={15}>15 dias</option>
            <option value={30}>30 dias</option>
            <option value={60}>60 dias</option>
          </select>
          {matchCheio && (
            <span style={{ fontSize: 11, background: '#DCFCE7', color: '#16A34A', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
              🎯 valor exato encontrado
            </span>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '10px 12px' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(61,35,20,0.55)' }}>Buscando movimentos...</div>
          ) : erro ? (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: 12, borderRadius: 6, margin: 8, fontSize: 13 }}>{erro}</div>
          ) : candidatos.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'rgba(61,35,20,0.6)', fontSize: 13 }}>
              Nenhum movimento bancário pendente compatível na janela selecionada.
              <div style={{ fontSize: 12, marginTop: 6, color: 'rgba(61,35,20,0.5)' }}>
                Aumente a janela ou sincronize o extrato para trazer mais movimentos.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {candidatos.map((c) => {
                const ativo = selecionado?.id === c.id
                const exato = Math.abs(c.diff_valor) < 0.01
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
                    <input type="radio" checked={ativo} readOnly aria-label="Selecionar movimento" />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#3D2314', fontSize: 14 }}>{fmtBRL(c.valor)}</strong>
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
                          {fmtData(c.data_transacao)}
                          {c.diff_dias !== 0 && (
                            <span style={{ color: 'rgba(61,35,20,0.5)', marginLeft: 4 }}>
                              ({c.diff_dias > 0 ? '+' : ''}{c.diff_dias}d)
                            </span>
                          )}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.65)', marginTop: 2 }}>
                        {c.descricao}{c.documento ? ` · doc ${c.documento}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.5)', fontWeight: 600 }}>
                      score {Math.round(c.match_score)}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '0.5px solid rgba(61,35,20,0.15)', display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ marginRight: 'auto', fontSize: 11, color: 'rgba(61,35,20,0.55)' }}>
            {selecionado && Math.abs(selecionado.diff_valor) >= 0.01 && (
              <>Diferença: <strong>{fmtBRL(Math.abs(selecionado.diff_valor))}</strong> — o título ficará como <strong>parcial</strong>.</>
            )}
          </div>
          <button type="button" onClick={onClose} disabled={aplicando}
            style={{ background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.25)', padding: '8px 16px', borderRadius: 6, fontSize: 13, cursor: aplicando ? 'not-allowed' : 'pointer' }}>
            Cancelar
          </button>
          <button type="button" onClick={aplicar} disabled={!selecionado || aplicando}
            style={{
              background: (!selecionado || aplicando) ? 'rgba(200,148,26,0.4)' : '#C8941A',
              color: '#3D2314', border: 'none', padding: '8px 20px',
              borderRadius: 6, fontSize: 13, fontWeight: 600,
              cursor: (!selecionado || aplicando) ? 'not-allowed' : 'pointer',
            }}>
            {aplicando ? 'Conciliando...' : 'Conciliar (dá baixa automática)'}
          </button>
        </div>
      </div>
    </div>
  )
}
