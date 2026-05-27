'use client'

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

function fmt(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = s.split('T')[0]
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

function corPorScore(score: number | null): { fg: string; bg: string; tier: string } {
  const s = score ?? 0
  if (s >= 0.8) return { fg: '#3B6D11', bg: '#EAF3DE', tier: 'OURO' }
  if (s >= 0.5) return { fg: '#BA7517', bg: '#FAEEDA', tier: 'PRATA' }
  if (s > 0) return { fg: '#A32D2D', bg: '#FCEBEB', tier: 'BRONZE' }
  return { fg: 'rgba(61,35,20,0.55)', bg: 'rgba(61,35,20,0.08)', tier: 'SEM SUGESTÃO' }
}

export default function InboxPage() {
  const router = useRouter()
  const { companyIds, selInfo } = useCompanyIds()
  const empresaUnica = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : null

  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [soOuro, setSoOuro] = useState(false)
  const [aplicandoIds, setAplicandoIds] = useState<Set<string>>(new Set())
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

  useEffect(() => { void carregar() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [empresaUnica])

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

  async function aplicarTodosOuro() {
    const ouro = items.filter((i) => (i.sugestao_score ?? 0) >= 0.8 && i.sugestao_lancamento_id)
    if (ouro.length === 0) return
    if (!confirm(`Aplicar match em ${ouro.length} movimento(s) com score OURO (>= 0.8)?`)) return
    for (const it of ouro) await aplicarMatch(it)
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
          {qtdOuro > 0 && (
            <button onClick={aplicarTodosOuro} style={primaryBtn}>
              Aplicar todos OURO ({qtdOuro})
            </button>
          )}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13, color: '#3D2314', cursor: 'pointer' }}>
          <input type="checkbox" checked={soOuro} onChange={(e) => setSoOuro(e.target.checked)} />
          Mostrar só matches OURO
        </label>

        {erro && (
          <div style={{ background: '#FCEBEB', color: '#A32D2D', padding: '10px 14px', borderRadius: 6, marginBottom: 16, fontSize: 12 }}>
            {erro}
          </div>
        )}

        {loading ? (
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
              const tom = corPorScore(it.sugestao_score)
              const aplicando = aplicandoIds.has(it.movimento_id)
              const temSugestao = !!it.sugestao_lancamento_id
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
                      <span style={{ display: 'inline-block', background: tom.bg, color: tom.fg, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, letterSpacing: 0.3, marginBottom: 6 }}>
                        {tom.tier}{it.sugestao_score != null ? ` · score ${Number(it.sugestao_score).toFixed(2)}` : ''}
                      </span>
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
