'use client'

// ONDA-A-INBOX-SELO-v1
// Blinda "Aplicar todos OURO" contra duplo-vinculo (via fn_conciliacao_rodar_lote),
// adiciona toggle de auto-conciliacao por empresa, selo de precisao em pendentes
// e aba "Conciliados". Linguagem CONCILIOU/CONCILIADO.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'
import ArquivarMovimentoModal from '@/components/conciliacao/ArquivarMovimentoModal'

interface Item {
  movimento_id: string
  lote_nome: string | null
  tipo_lote: string | null
  data_transacao: string
  valor: number
  descricao: string | null
  natureza: string | null
  status: string
  sugestao_lancamento_tabela: string | null
  sugestao_lancamento_id: string | null
  sugestao_data: string | null
  sugestao_valor: number | null
  sugestao_contraparte: string | null
  sugestao_score: number | null
  sugestao_categoria: string | null
}

interface Conciliado {
  movimento_id: string
  lote_nome: string | null
  data_transacao: string
  valor: number
  descricao: string | null
  natureza: string | null
  lancamento_tabela: string | null
  lancamento_id: string | null
  contraparte: string | null
  valor_lancamento: number | null
  data_lancamento: string | null
  precisao: number | null
  match_origem: string | null
  conciliado_em: string | null
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

function fmtBR(d?: string | null): string {
  return d ? new Date(d).toLocaleDateString('pt-BR') : ''
}

// ONDA-A-INBOX-SELO-v1: selo de precisao (escala 0-100, vinda de psgc_confianca/match_score)
function seloPrecisao(score?: number | null) {
  const s = Number(score ?? 0)
  if (s >= 90) return { emoji: '🟢', label: 'OURO',   cor: '#1B873F', bg: '#E7F4EC' }
  if (s >= 70) return { emoji: '🟡', label: 'PRATA',  cor: '#B7791F', bg: '#FBF3E0' }
  if (s >= 50) return { emoji: '🟠', label: 'BRONZE', cor: '#C05621', bg: '#FBEAE0' }
  return         { emoji: '🔴', label: 'BAIXA',  cor: '#C53030', bg: '#FCE8E8' }
}

function iconeOrigem(o?: string | null): string {
  return o === 'auto' ? '🤖 automático' : '👤 manual'
}

// Sugestao_score do fn_conciliacao_inbox vem como 0-1 (legado). Normaliza para 0-100.
function scoreParaPercent(s: number | null | undefined): number {
  const v = Number(s ?? 0)
  if (v <= 1) return Math.round(v * 100)
  return Math.round(v)
}

export default function InboxPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [items, setItems] = useState<Item[]>([])
  const [conciliados, setConciliados] = useState<Conciliado[]>([])
  const [loading, setLoading] = useState(true)
  const [soOuro, setSoOuro] = useState(false)
  const [aba, setAba] = useState<'pendentes' | 'conciliados'>('pendentes')
  const [autoGlobal, setAutoGlobal] = useState(false)
  const [aplicandoIds, setAplicandoIds] = useState<Set<string>>(new Set())
  const [conciliandoLote, setConciliandoLote] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [arquivando, setArquivando] = useState<Item | null>(null)

  async function carregar() {
    if (!empresaUnica) return
    setLoading(true)
    const { data, error } = await supabase.rpc('fn_conciliacao_inbox', {
      p_lote_id: null,
      p_company_id: empresaUnica,
      p_status: 'pendente',
      p_limite: 200,
    })
    if (error) setErro(error.message)
    setItems((data ?? []) as Item[])
    setLoading(false)
  }

  async function carregarConciliados() {
    if (!empresaUnica) return
    const { data, error } = await supabase.rpc('fn_conciliacao_conciliados', {
      p_company_id: empresaUnica,
      p_limite: 500,
    })
    if (!error) setConciliados((data ?? []) as Conciliado[])
  }

  async function carregarConfig() {
    if (!empresaUnica) return
    const { data } = await supabase
      .from('erp_conciliacao_config')
      .select('auto_conciliar_global')
      .eq('company_id', empresaUnica)
      .maybeSingle()
    setAutoGlobal(data?.auto_conciliar_global ?? false)
  }

  async function toggleAutoGlobal(v: boolean) {
    if (!empresaUnica) return
    setAutoGlobal(v)
    const { error } = await supabase.from('erp_conciliacao_config').upsert({
      company_id: empresaUnica,
      auto_conciliar_global: v,
      updated_at: new Date().toISOString(),
    })
    if (error) {
      setErro('Erro ao salvar preferência: ' + error.message)
      setAutoGlobal(!v)
    }
  }

  useEffect(() => {
    void carregar()
    void carregarConciliados()
    void carregarConfig()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [empresaUnica])

  useEffect(() => {
    if (aba === 'conciliados') void carregarConciliados()
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [aba])

  const filtrados = useMemo(() => {
    if (soOuro) return items.filter((i) => (i.sugestao_score ?? 0) >= 0.8)
    return items
  }, [items, soOuro])

  async function aplicarMatch(it: Item) {
    if (!it.sugestao_lancamento_tabela || !it.sugestao_lancamento_id) return
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }

    setAplicandoIds(new Set([...aplicandoIds, it.movimento_id]))
    const { error } = await supabase.rpc('fn_conciliacao_aplicar_match', {
      p_movimento_id: it.movimento_id,
      p_lancamento_tabela: it.sugestao_lancamento_tabela,
      p_lancamento_id: it.sugestao_lancamento_id,
      p_operador_id: operadorId,
      p_origem: 'manual',
    })
    if (error) setErro(error.message)
    await carregar()
    const ns = new Set(aplicandoIds); ns.delete(it.movimento_id); setAplicandoIds(ns)
  }

  async function rejeitar(it: Item) {
    if (!it.sugestao_lancamento_tabela || !it.sugestao_lancamento_id) return
    const { data: userResp } = await supabase.auth.getUser()
    const operadorId = userResp.user?.id ?? null
    if (!operadorId) { setErro('Sessão expirada · faça login novamente'); return }

    setAplicandoIds(new Set([...aplicandoIds, it.movimento_id]))
    const { error } = await supabase.rpc('fn_conciliacao_rejeitar_sugestao', {
      p_movimento_id: it.movimento_id,
      p_lancamento_tabela: it.sugestao_lancamento_tabela,
      p_lancamento_id: it.sugestao_lancamento_id,
      p_operador_id: operadorId,
    })
    if (error) setErro(error.message)
    await carregar()
    const ns = new Set(aplicandoIds); ns.delete(it.movimento_id); setAplicandoIds(ns)
  }

  // ONDA-A-INBOX-SELO-v1: agora usa fn_conciliacao_rodar_lote (blindado anti-colisao)
  // em vez de loop client-side. Override manual: auto=true, score>=80 (cobre OURO).
  async function aplicarTodosOuro() {
    const companyId = empresaUnica
    if (!companyId) return
    if (!confirm('Conciliar automaticamente os matches OURO seguros (1:1)? Movimentos em disputa ficam pra revisão manual.')) return
    setConciliandoLote(true)
    setErro(null)
    try {
      const { data, error } = await supabase.rpc('fn_conciliacao_rodar_lote', {
        p_company_id: companyId,
        p_lote_id: null,
        p_auto_aplicar: true,
        p_score_auto: 80,
      })
      if (error) throw error
      const r = (data ?? {}) as {
        auto_conciliados?: number
        colisao_pulada?: number
      }
      alert(`CONCILIOU ${r.auto_conciliados ?? 0} movimento(s) automaticamente. ${r.colisao_pulada ?? 0} em disputa ficaram pra revisão manual.`)
      await carregar()
      await carregarConciliados()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setErro('Erro ao conciliar em lote: ' + msg)
    } finally {
      setConciliandoLote(false)
    }
  }

  async function desvincularConciliado(c: Conciliado) {
    if (!c.lancamento_id || !c.lancamento_tabela) return
    if (!confirm(`Desvincular este lançamento conciliado? O movimento volta para pendente.`)) return
    // fn_conciliacao_desvincular(p_lancamento_id uuid, p_tipo text)
    const { error } = await supabase.rpc('fn_conciliacao_desvincular', {
      p_lancamento_id: c.lancamento_id,
      p_tipo: c.lancamento_tabela,
    })
    if (error) { setErro('Erro ao desvincular: ' + error.message); return }
    await carregarConciliados()
    await carregar()
  }

  if (!empresaUnica) {
    return <div style={infoBox}>Selecione uma empresa para ver a inbox.</div>
  }

  const qtdOuro = items.filter((i) => (i.sugestao_score ?? 0) >= 0.8).length

  return (
    <div style={{ background: '#FAF7F2', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <button onClick={() => router.push('/dashboard/financeiro/conciliacao')} style={backLink}>
          ← Conciliação
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
          <div>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 28, fontWeight: 400, color: '#3D2314', margin: '0 0 6px' }}>
              Inbox · Movimentos pendentes
            </h1>
            <p style={{ color: 'rgba(61,35,20,0.65)', fontSize: 13, margin: 0 }}>
              {items.length} pendentes · {qtdOuro} com match OURO (score ≥ 0.8)
            </p>
          </div>
          {qtdOuro > 0 && aba === 'pendentes' && (
            <button onClick={aplicarTodosOuro} disabled={conciliandoLote} style={primaryBtnLoad(conciliandoLote)}>
              {conciliandoLote ? 'Conciliando…' : `Aplicar todos OURO (${qtdOuro})`}
            </button>
          )}
        </div>

        {/* Toggles agrupados, alinhados a direita */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', marginBottom: 16, fontSize: 13, color: '#3D2314' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', cursor: 'pointer' }}>
            <input type="checkbox" checked={autoGlobal} onChange={(e) => void toggleAutoGlobal(e.target.checked)} />
            Auto-conciliar OURO desta empresa (perfeitos 1:1 entram sozinhos)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', cursor: 'pointer' }}>
            <input type="checkbox" checked={soOuro} onChange={(e) => setSoOuro(e.target.checked)} />
            Mostrar só matches OURO
          </label>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            onClick={() => setAba('pendentes')}
            style={aba === 'pendentes' ? tabActive : tabInactive}
          >Pendentes ({items.length})</button>
          <button
            onClick={() => setAba('conciliados')}
            style={aba === 'conciliados' ? tabActive : tabInactive}
          >Conciliados ({conciliados.length})</button>
        </div>

        {erro && (
          <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
            {erro}
          </div>
        )}

        {aba === 'pendentes' ? (
          loading ? (
            <div style={emptyBox}>Carregando…</div>
          ) : filtrados.length === 0 ? (
            <div style={emptyBox}>
              <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
                {items.length === 0 ? 'Inbox vazia · todos movimentos conciliados' : 'Nenhum match OURO no momento'}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                {items.length === 0 ? 'Importe um novo lote para começar.' : 'Desmarque o filtro pra ver outros.'}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtrados.map((it) => {
                const aplicando = aplicandoIds.has(it.movimento_id)
                const temSugestao = !!it.sugestao_lancamento_id
                const selo = seloPrecisao(scoreParaPercent(it.sugestao_score))
                return (
                  <div key={it.movimento_id} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 4 }}>
                          {fmtDate(it.data_transacao)} · {it.lote_nome ?? '—'} · {it.natureza ?? '—'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', marginBottom: 6, wordBreak: 'break-word' }}>
                          {it.descricao ?? '(sem descrição)'}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: Number(it.valor) < 0 ? '#A32D2D' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
                          {Number(it.valor) < 0 ? '−' : '+'} R$ {fmt(Math.abs(it.valor))}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 200, borderLeft: '1px solid rgba(61,35,20,0.08)', paddingLeft: 16 }}>
                        {temSugestao && (
                          <span style={{ display: 'inline-block', background: selo.bg, color: selo.cor, padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                            {selo.emoji} {selo.label} · {scoreParaPercent(it.sugestao_score)}%
                          </span>
                        )}
                        {temSugestao ? (
                          <>
                            <div style={{ fontSize: 13, color: '#3D2314', marginBottom: 2 }}>
                              {it.sugestao_contraparte ?? '(sem contraparte)'}
                            </div>
                            <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                              {it.sugestao_categoria ?? '—'} · {fmtDate(it.sugestao_data)} · R$ {fmt(it.sugestao_valor)}
                            </div>
                            <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginTop: 4 }}>
                              origem: {it.sugestao_lancamento_tabela}
                            </div>
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                            Sem sugestão automática. Conciliar manualmente.
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button onClick={() => setArquivando(it)} disabled={aplicando} style={secondaryBtn(aplicando)}>
                        ✕ Arquivar
                      </button>
                      {temSugestao && (
                        <>
                          <button onClick={() => rejeitar(it)} disabled={aplicando} style={secondaryBtn(aplicando)}>
                            Rejeitar
                          </button>
                          <button onClick={() => aplicarMatch(it)} disabled={aplicando} style={primaryBtnLoad(aplicando)}>
                            {aplicando ? 'Aplicando…' : 'Aplicar match'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        ) : (
          /* Aba CONCILIADOS */
          conciliados.length === 0 ? (
            <div style={emptyBox}>
              <div style={{ fontSize: 14, color: '#3D2314', fontWeight: 600, marginBottom: 6 }}>
                Nenhum movimento conciliado ainda
              </div>
              <div style={{ fontSize: 12, color: 'rgba(61,35,20,0.55)' }}>
                Concilie pendentes da aba anterior para popular aqui.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {conciliados.map((c) => {
                const selo = seloPrecisao(c.precisao)
                const valNeg = Number(c.valor) < 0 || c.natureza === 'debito'
                return (
                  <div key={c.movimento_id} style={{ background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.55)', marginBottom: 4 }}>
                          {fmtBR(c.data_transacao)} · {c.lote_nome ?? '—'}
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#3D2314', marginBottom: 6, wordBreak: 'break-word' }}>
                          {c.descricao ?? '(sem descrição)'}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 600, color: valNeg ? '#A32D2D' : '#3B6D11', fontVariantNumeric: 'tabular-nums' }}>
                          {valNeg ? '−' : '+'} R$ {fmt(Math.abs(Number(c.valor)))}
                        </div>
                      </div>

                      <div style={{ flex: 1, minWidth: 200, borderLeft: '1px solid rgba(61,35,20,0.08)', paddingLeft: 16 }}>
                        <span style={{ display: 'inline-block', background: selo.bg, color: selo.cor, padding: '2px 8px', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                          {selo.emoji} {selo.label} · {Math.round(Number(c.precisao ?? 0))}%
                        </span>
                        <div style={{ fontSize: 13, color: '#3D2314', marginBottom: 2 }}>
                          {c.contraparte ?? '(sem contraparte)'}
                        </div>
                        <div style={{ fontSize: 11, color: 'rgba(61,35,20,0.65)' }}>
                          {c.lancamento_tabela ?? '—'} · {fmtBR(c.data_lancamento)} · R$ {fmt(c.valor_lancamento)}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(61,35,20,0.45)', marginTop: 4 }}>
                          {iconeOrigem(c.match_origem)} · conciliado em {fmtBR(c.conciliado_em)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button onClick={() => void desvincularConciliado(c)} style={secondaryBtn(false)}>
                        Desvincular
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      <ArquivarMovimentoModal
        open={!!arquivando}
        onClose={() => setArquivando(null)}
        onSucesso={() => { setArquivando(null); void carregar() }}
        movimentoId={arquivando?.movimento_id ?? ''}
        descricao={arquivando ? `${arquivando.descricao ?? '(sem descrição)'} · R$ ${Math.abs(arquivando.valor).toFixed(2)}` : undefined}
      />
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  background: '#C8941A', color: '#3D2314', border: 'none',
  padding: '10px 18px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

function primaryBtnLoad(loading: boolean): React.CSSProperties {
  return {
    ...primaryBtn,
    background: loading ? 'rgba(200,148,26,0.5)' : '#C8941A',
    cursor: loading ? 'wait' : 'pointer',
  }
}

function secondaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: disabled ? 'rgba(61,35,20,0.3)' : '#3D2314',
    border: '0.5px solid rgba(61,35,20,0.2)',
    padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

const tabActive: React.CSSProperties = {
  background: '#3D2314', color: '#FAF7F2', border: 'none',
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const tabInactive: React.CSSProperties = {
  background: 'transparent', color: '#3D2314', border: '0.5px solid rgba(61,35,20,0.2)',
  padding: '8px 14px', borderRadius: 6, fontSize: 12, fontWeight: 400, cursor: 'pointer',
}

const backLink: React.CSSProperties = {
  background: 'transparent', border: 'none', color: 'rgba(61,35,20,0.55)',
  fontSize: 12, cursor: 'pointer', padding: 0, marginBottom: 16,
}

const infoBox: React.CSSProperties = {
  padding: 40, background: '#FAF7F2', minHeight: '100vh', color: '#3D2314', textAlign: 'center',
}

const emptyBox: React.CSSProperties = {
  background: '#FFFFFF', border: '0.5px solid rgba(61,35,20,0.12)', borderRadius: 8,
  padding: 48, textAlign: 'center', color: 'rgba(61,35,20,0.65)',
}
