'use client'

// conciliacao-n-para-1-fatura-cartao-v1
// Painel "Vincular varios" · N contas a pagar -> 1 movimento (pagamento de fatura).
// RPCs: fn_conciliacao_buscar_lancamentos · fn_conciliacao_vincular ·
// fn_conciliacao_desvincular_item · fn_conciliacao_vinculos · fn_conciliacao_fechar_agrupado.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface Vinculo {
  vinculo_id: string
  tabela: 'erp_pagar' | 'erp_receber'
  lancamento_id: string
  valor: number
  descricao: string | null
  vencimento: string | null
}

interface ResumoRPC {
  ok: boolean
  erro?: string
  valor_movimento: number
  soma_vinculada: number
  saldo: number
  fecha: boolean
  qtd_vinculos?: number
  itens?: Vinculo[]
}

interface Sugestao {
  lancamento_tabela: 'erp_pagar' | 'erp_receber'
  lancamento_id: string
  data_lancamento: string | null
  valor_lancamento: number
  contraparte: string | null
  descricao_lancamento: string | null
  status: string | null
  ja_conciliado: boolean
}

interface Props {
  movimentoId: string
  companyId: string
  valorMovimento: number
  natureza: 'debito' | 'credito' | null
  descricao: string | null
  onClose: () => void
  onConciliado?: () => void
}

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.split('T')[0]
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

export default function VincularVariosModal({
  movimentoId, companyId, valorMovimento, natureza, descricao, onClose, onConciliado,
}: Props) {
  const [resumo, setResumo] = useState<ResumoRPC | null>(null)
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [valorMin, setValorMin] = useState('')
  const [valorMax, setValorMax] = useState('')
  const [sugestoes, setSugestoes] = useState<Sugestao[]>([])
  const [buscando, setBuscando] = useState(false)
  const [acao, setAcao] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [fechando, setFechando] = useState(false)

  const naturezaBusca: 'debito' | 'credito' = natureza === 'credito' ? 'credito' : 'debito'

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  useEffect(() => {
    void carregarResumo()
    void buscar('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movimentoId])

  async function carregarResumo() {
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_conciliacao_vinculos', { p_movimento_id: movimentoId })
    setLoading(false)
    if (error) { setErro(error.message); return }
    setResumo(data as ResumoRPC)
  }

  async function buscar(termo: string) {
    setBuscando(true)
    const args: Record<string, unknown> = {
      p_company_id: companyId,
      p_natureza: naturezaBusca,
      p_valor_min: valorMin ? Number(valorMin.replace(',', '.')) : null,
      p_valor_max: valorMax ? Number(valorMax.replace(',', '.')) : null,
      p_termo: termo || null,
      p_valor_ref: null,
      p_limite: 50,
    }
    const { data, error } = await supabase.rpc('fn_conciliacao_buscar_lancamentos', args)
    setBuscando(false)
    if (error) { setErro(error.message); return }
    setSugestoes((data as Sugestao[]) ?? [])
  }

  async function vincular(s: Sugestao) {
    setAcao(s.lancamento_id)
    setErro(null)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_conciliacao_vincular', {
      p_movimento_id: movimentoId,
      p_lancamento_tabela: s.lancamento_tabela,
      p_lancamento_id: s.lancamento_id,
      p_valor: null,
      p_operador_id: user?.id ?? null,
    })
    setAcao(null)
    if (error) { setErro(error.message); return }
    const r = data as ResumoRPC
    if (!r.ok) { setErro(r.erro ?? 'Erro ao vincular'); return }
    await carregarResumo()
  }

  async function desvincular(v: Vinculo) {
    setAcao(v.vinculo_id)
    setErro(null)
    const { data, error } = await supabase.rpc('fn_conciliacao_desvincular_item', {
      p_vinculo_id: v.vinculo_id,
    })
    setAcao(null)
    if (error) { setErro(error.message); return }
    const r = data as ResumoRPC
    if (!r.ok) { setErro(r.erro ?? 'Erro ao desvincular'); return }
    await carregarResumo()
  }

  async function fecharFatura() {
    if (!resumo?.fecha) return
    if (!window.confirm(`CONCILIAR a fatura?\n\n${resumo.qtd_vinculos ?? resumo.itens?.length ?? 0} conta(s) baixadas como pagas pelo total da fatura.`)) return
    setFechando(true)
    setErro(null)
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase.rpc('fn_conciliacao_fechar_agrupado', {
      p_movimento_id: movimentoId,
      p_operador_id: user?.id ?? null,
      p_tolerancia: 0.05,
    })
    setFechando(false)
    if (error) { setErro(error.message); return }
    const r = data as { ok: boolean; erro?: string }
    if (!r.ok) { setErro(r.erro ?? 'Erro ao conciliar'); return }
    onConciliado?.()
    onClose()
  }

  const valorAbs = Math.abs(valorMovimento)
  const pct = resumo ? Math.min(100, (resumo.soma_vinculada / valorAbs) * 100) : 0
  const corBarra = resumo?.fecha ? '#3B6D11' : '#C8941A'

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(61,35,20,0.5)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px', zIndex: 60, overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#FAF7F2', borderRadius: 12, width: '100%', maxWidth: 1000,
          boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid rgba(61,35,20,0.12)',
          background: '#3D2314', borderRadius: '12px 12px 0 0',
        }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#C8941A', margin: 0, fontFamily: 'Fraunces, Georgia, serif' }}>
              🔗 Vincular vários · fatura agrupada
            </h2>
            <div style={{ fontSize: 11, color: 'rgba(250,247,242,0.75)', marginTop: 2 }}>
              {descricao ?? '(sem descrição)'} · R$ {fmt(valorAbs)}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{
              background: 'transparent', border: 'none', color: '#FAF7F2',
              cursor: 'pointer', padding: 6, display: 'flex',
              minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {/* Resumo + barra de progresso */}
          <div style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 12, color: '#3D2314', marginBottom: 8 }}>
              <span><strong>Fatura:</strong> R$ {fmt(valorAbs)}</span>
              <span><strong>Vinculado:</strong> R$ {fmt(resumo?.soma_vinculada ?? 0)}</span>
              <span style={{ color: resumo?.fecha ? '#3B6D11' : '#BA7517' }}>
                {resumo?.fecha ? '✅ Fatura fechada' : `Faltam R$ ${fmt(Math.max(0, resumo?.saldo ?? valorAbs))} pra fechar`}
              </span>
            </div>
            <div style={{ height: 10, background: 'rgba(61,35,20,0.08)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: corBarra, transition: 'width 0.2s' }} />
            </div>
          </div>

          {erro && (
            <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '8px 12px', borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
              {erro}
            </div>
          )}

          {/* Vinculados */}
          {(resumo?.itens ?? []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
                Contas vinculadas ({resumo!.itens!.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {resumo!.itens!.map((v) => (
                  <div key={v.vinculo_id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    gap: 10, padding: '8px 10px', background: '#EAF3DE', borderRadius: 6, flexWrap: 'wrap',
                  }}>
                    <div style={{ flex: 1, minWidth: 200, fontSize: 12 }}>
                      <div style={{ fontWeight: 600, color: '#3D2314' }}>
                        {v.descricao ?? '(sem descrição)'}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                        {v.tabela} · venc {fmtDate(v.vencimento)}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
                      R$ {fmt(v.valor)}
                    </div>
                    <button
                      onClick={() => void desvincular(v)}
                      disabled={acao === v.vinculo_id || fechando}
                      style={ghostBtn}
                    >
                      remover
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Busca de contas */}
          <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 6 }}>
            Buscar contas a {naturezaBusca === 'debito' ? 'pagar' : 'receber'}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscar(busca) }}
              placeholder="Buscar por nome ou descrição"
              style={inputStyle}
            />
            <input
              value={valorMin}
              onChange={(e) => setValorMin(e.target.value)}
              placeholder="Valor min"
              style={{ ...inputStyle, maxWidth: 110 }}
            />
            <input
              value={valorMax}
              onChange={(e) => setValorMax(e.target.value)}
              placeholder="Valor max"
              style={{ ...inputStyle, maxWidth: 110 }}
            />
            <button onClick={() => void buscar(busca)} disabled={buscando} style={primaryBtn(buscando)}>
              {buscando ? 'Buscando…' : '🔍 Buscar'}
            </button>
          </div>

          <div style={{ border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, overflow: 'auto', maxHeight: 320, marginBottom: 16 }}>
            {loading ? (
              <div style={{ padding: 12, fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>Carregando…</div>
            ) : sugestoes.length === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>Nenhuma conta encontrada · ajuste filtros.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {sugestoes.map((s) => {
                  const jaVinc = (resumo?.itens ?? []).some(
                    (v) => v.tabela === s.lancamento_tabela && v.lancamento_id === s.lancamento_id,
                  )
                  return (
                    <div key={`${s.lancamento_tabela}:${s.lancamento_id}`} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      gap: 10, padding: '8px 12px', borderBottom: '0.5px solid rgba(61,35,20,0.06)', flexWrap: 'wrap',
                    }}>
                      <div style={{ flex: 1, minWidth: 200, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: '#3D2314' }}>
                          {s.contraparte ?? s.descricao_lancamento ?? '(sem nome)'}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                          venc {fmtDate(s.data_lancamento)} · {s.status ?? '—'}
                          {s.ja_conciliado && <span style={{ color: '#BA7517' }}> · ja conciliado</span>}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#3D2314', fontVariantNumeric: 'tabular-nums' }}>
                        R$ {fmt(s.valor_lancamento)}
                      </div>
                      <button
                        onClick={() => void vincular(s)}
                        disabled={jaVinc || acao === s.lancamento_id || fechando}
                        style={jaVinc ? ghostBtn : primaryBtn(acao === s.lancamento_id)}
                      >
                        {jaVinc ? 'vinculada' : acao === s.lancamento_id ? '...' : '+ adicionar'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onClose} style={ghostBtn}>Fechar</button>
            <button
              onClick={() => void fecharFatura()}
              disabled={!resumo?.fecha || fechando}
              style={primaryBtn(fechando)}
            >
              {fechando ? 'Conciliando…' : '✅ Conciliar fatura'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1, minWidth: 140, padding: '8px 10px', border: '0.5px solid rgba(61,35,20,0.2)',
  borderRadius: 6, fontSize: 12, color: '#3D2314', background: '#FFFFFF', fontFamily: 'inherit',
}
function primaryBtn(loading: boolean): React.CSSProperties {
  return {
    background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A',
    color: '#3D2314', border: 'none', padding: '8px 14px', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer', minHeight: 44,
  }
}
const ghostBtn: React.CSSProperties = {
  background: 'transparent', color: '#3D2314',
  border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: 36,
}
