'use client'
// WEALTH · Recomendações (CVM 19). O consultor gera recomendações usando o IPS APROVADO como baliza
// (carteira atual × alocação-alvo → comprar/vender), e o André aprova cada uma. Backend:
// fn_wealth_recomendacao_gerar / _criar / _aprovar / _rejeitar / _listar. Drift do fn_wealth_validar_ips (fonte única).
// Botão Aprovar/Rejeitar só para fn_wealth_user_eh_aprovador_cvm19 (aprovador_atual). Identidade PS.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', GOLD = '#C8941A', BG = '#FAF7F2', LINE = 'rgba(61,35,20,0.12)', MUT = 'rgba(61,35,20,0.6)'
const fmtData = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')
const fmtBRL = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))
const rotulaClasse = (c: string | null) => (c ?? '—').replace(/_/g, ' ').replace('renda fixa', 'RF').replace(/\b\w/g, (m) => m.toUpperCase())

type Cli = { id: string; nome: string; perfil_risco: string | null }
type Desvio = { classe: string; alvo_pct: number; atual_pct: number; desvio_pp: number; banda_min: number; banda_max: number; status: string; sugestao: string }
type Aderencia = { success?: boolean; error?: string; ips_versao?: number; ips_perfil?: string; desvios?: Desvio[]; precisa_rebalancear?: boolean }
type Sugestao = { classe: string; acao: string; tipo: string; peso_alvo: number; peso_atual: number; drift_pp: number; valor_sugerido: number; justificativa: string }
type Gerar = { ok: boolean; sem_ips?: boolean; erro?: string; ips_id?: string; ips_versao?: number; total_carteira?: number; aderencia?: Aderencia; sugestoes?: Sugestao[]; precisa_rebalancear?: boolean }
type Rec = {
  id: string; ips_id: string | null; tipo: string; classe: string | null; acao: string; valor: number | null;
  peso_alvo: number | null; peso_atual: number | null; justificativa: string | null; status: string;
  criado_em: string; aprovado_em: string | null; obs_aprovacao: string | null
}
type Listar = { ok: boolean; recomendacoes: Rec[]; aderencia: Aderencia; aprovador_atual: boolean }

const STATUS_BADGE: Record<string, [string, string]> = {
  aprovada: ['#E6F0E6', '#2F5D2F'], aguarda_aprovacao: ['#FFF3D9', '#7A4A0F'],
  rejeitada: ['#EFE1E1', '#7A1F1F'], rascunho: ['#F3EBDD', '#7A4A0F'], executada: ['#E4EDF3', '#25506B'],
}

export default function RecomendacoesPage() {
  const { companyIds } = useCompanyIds()
  const empresa = companyIds[0] ?? null

  const [clientes, setClientes] = useState<Cli[]>([])
  const [selId, setSelId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const [data, setData] = useState<Listar | null>(null)
  const [gerado, setGerado] = useState<Gerar | null>(null)
  const [motivo, setMotivo] = useState<Record<string, string>>({})

  const carregarClientes = useCallback(async () => {
    if (!empresa) { setClientes([]); setLoading(false); return }
    setLoading(true)
    const { data: cli } = await supabase.from('wealth_clients').select('id, nome, perfil_risco').eq('company_id', empresa).order('nome')
    setClientes((cli ?? []) as Cli[]); setLoading(false)
  }, [empresa])
  useEffect(() => { const t = setTimeout(() => { void carregarClientes() }, 0); return () => clearTimeout(t) }, [carregarClientes])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  const selCli = useMemo(() => clientes.find((c) => c.id === selId) ?? null, [clientes, selId])

  const carregar = useCallback(async (id: string) => {
    setGerado(null); setMotivo({})
    if (!id) { setData(null); return }
    const { data: d } = await supabase.rpc('fn_wealth_recomendacao_listar', { p_client_id: id })
    setData((d ?? null) as Listar | null)
  }, [])
  useEffect(() => { const t = setTimeout(() => { void carregar(selId) }, 0); return () => clearTimeout(t) }, [selId, carregar])

  async function gerar() {
    if (!selId) return
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_gerar', { p_client_id: selId })
    setBusy(false)
    const j = (d ?? null) as Gerar | null
    if (error) { setToast(`Erro: ${error.message}`); return }
    setGerado(j)
    if (j && !j.ok) setToast(j.erro ?? 'Não foi possível gerar.')
  }

  async function criar(s: Sugestao) {
    if (!selId) return
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_criar', {
      p_campos: {
        client_id: selId, classe: s.classe, acao: s.acao, tipo: s.tipo,
        valor: String(s.valor_sugerido), peso_alvo: String(s.peso_alvo), peso_atual: String(s.peso_atual),
        justificativa: s.justificativa,
      },
    })
    setBusy(false)
    const j = d as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Recomendação criada — aguarda aprovação do André.')
    await carregar(selId)
  }

  async function aprovar(id: string) {
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_aprovar', { p_id: id, p_obs: null })
    setBusy(false)
    const j = d as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Recomendação aprovada.'); await carregar(selId)
  }

  async function rejeitar(id: string) {
    const m = (motivo[id] ?? '').trim()
    if (!m) { setToast('Informe o motivo da rejeição.'); return }
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_rejeitar', { p_id: id, p_motivo: m })
    setBusy(false)
    const j = d as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Recomendação rejeitada.'); await carregar(selId)
  }

  if (!empresa) return <Shell><p style={{ color: MUT }}>Selecione uma empresa no topo.</p></Shell>

  const podeAprovar = data?.aprovador_atual === true
  const aderencia = data?.aderencia
  const desvios = (aderencia?.desvios ?? []).slice().sort((a, b) => Math.abs(b.desvio_pp) - Math.abs(a.desvio_pp))
  const recs = data?.recomendacoes ?? []
  const fila = recs.filter((r) => r.status === 'aguarda_aprovacao')

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-sm uppercase tracking-wider font-semibold" style={{ color: GOLD }}>Wealth · Compliance</p>
        <h1 className="text-3xl md:text-4xl" style={{ color: ESP, fontFamily: 'serif' }}>Recomendações</h1>
        <p className="mt-1" style={{ color: MUT }}>Carteira × IPS aprovado → o que comprar/vender · aprovação exclusiva do consultor CVM 19.</p>
      </header>

      {loading ? <p style={{ color: MUT }}>Carregando…</p> : (
        <>
          <label className="block mb-5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUT }}>Cliente</span>
            <select value={selId} onChange={(e) => setSelId(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-lg border p-2.5" style={{ borderColor: LINE, background: '#fff', color: ESP }}>
              <option value="">Selecione um cliente…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.perfil_risco ? ` · ${c.perfil_risco}` : ' · sem perfil'}</option>)}
            </select>
          </label>

          {selCli && data && (
            <div className="grid gap-4">
              {/* Aderência: carteira × IPS por classe */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Aderência ao IPS</h2>
                  {aderencia?.success
                    ? <span className="text-xs" style={{ color: MUT }}>IPS v{aderencia.ips_versao} · <span className="capitalize">{aderencia.ips_perfil}</span></span>
                    : <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: '#FFF3D9', color: '#7A4A0F' }}>sem IPS aprovado</span>}
                </div>

                {!aderencia?.success ? (
                  <p className="text-sm" style={{ color: MUT }}>{aderencia?.error ?? 'Aprove um IPS para o cliente para medir a aderência.'}</p>
                ) : desvios.length === 0 ? (
                  <p className="text-sm" style={{ color: MUT }}>Sem classes no IPS para comparar.</p>
                ) : (
                  <div className="grid gap-2.5">
                    {desvios.map((d) => {
                      const fora = d.status !== 'dentro_banda'
                      const max = Math.max(d.alvo_pct, d.atual_pct, 1)
                      return (
                        <div key={d.classe}>
                          <div className="flex items-center justify-between text-sm mb-1">
                            <span style={{ color: ESP, fontWeight: fora ? 700 : 400 }}>{rotulaClasse(d.classe)}</span>
                            <span style={{ color: fora ? '#7A4A0F' : MUT }}>
                              {d.atual_pct}% <span style={{ color: MUT }}>/ alvo {d.alvo_pct}%</span>
                              {fora && <span className="ml-1">({d.desvio_pp > 0 ? '+' : ''}{d.desvio_pp}pp)</span>}
                            </span>
                          </div>
                          {/* barras lado a lado: atual (cheia) sobre alvo (marca) */}
                          <div className="relative h-3 rounded-full" style={{ background: 'rgba(61,35,20,0.06)' }}>
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(d.atual_pct / max) * 100}%`, background: fora ? GOLD : 'rgba(61,35,20,0.35)' }} />
                            <div className="absolute inset-y-0" style={{ left: `calc(${(d.alvo_pct / max) * 100}% - 1px)`, width: 2, background: ESP }} title={`alvo ${d.alvo_pct}%`} />
                          </div>
                        </div>
                      )
                    })}
                    <p className="text-[11px] mt-1" style={{ color: MUT }}>Barra = atual · traço = alvo do IPS. Fora da banda em destaque.</p>
                  </div>
                )}
              </section>

              {/* Gerar sugestões */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Gerar recomendações</h2>
                  <button onClick={() => void gerar()} disabled={busy}
                    className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                    Gerar a partir do IPS
                  </button>
                </div>

                {gerado && !gerado.ok && (
                  <div className="rounded-lg border p-3 text-sm" style={{ borderColor: '#E7C9A0', background: '#FFF6E9', color: '#7A4A0F' }}>
                    {gerado.sem_ips ? '⚠ ' : ''}{gerado.erro}
                  </div>
                )}
                {gerado?.ok && (gerado.sugestoes?.length ?? 0) === 0 && (
                  <p className="text-sm" style={{ color: MUT }}>Carteira dentro das bandas do IPS — nada a rebalancear.</p>
                )}
                {gerado?.ok && (gerado.sugestoes?.length ?? 0) > 0 && (
                  <div className="grid gap-2">
                    <p className="text-xs" style={{ color: MUT }}>Carteira {fmtBRL(gerado.total_carteira)} · selecione as que quiser criar (vão para aprovação do André).</p>
                    {gerado.sugestoes!.map((s, i) => (
                      <div key={i} className="rounded-lg border p-3 flex items-start justify-between gap-3" style={{ borderColor: LINE }}>
                        <div className="text-sm">
                          <span className="inline-block rounded px-2 py-0.5 text-xs font-bold mr-2" style={{ background: s.acao === 'comprar' ? '#E6F0E6' : '#F3E7DA', color: s.acao === 'comprar' ? '#2F5D2F' : '#7A4A0F', textTransform: 'uppercase' }}>{s.acao}</span>
                          <span style={{ color: ESP, fontWeight: 600 }}>{rotulaClasse(s.classe)}</span>
                          <span className="ml-2" style={{ color: MUT }}>~{fmtBRL(s.valor_sugerido)}</span>
                          <div className="mt-1" style={{ color: MUT }}>{s.justificativa}</div>
                        </div>
                        <button onClick={() => void criar(s)} disabled={busy}
                          className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold border" style={{ borderColor: GOLD, color: ESP, background: '#FFF9EE', opacity: busy ? 0.6 : 1 }}>
                          Criar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Fila de aprovação */}
              {fila.length > 0 && (
                <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                  <h2 className="text-lg mb-1" style={{ color: ESP, fontFamily: 'serif' }}>Aguardando aprovação (CVM 19)</h2>
                  {!podeAprovar && <p className="text-xs mb-3" style={{ color: MUT }}>Somente o consultor habilitado CVM 19 (André) aprova. Você pode criar e revisar.</p>}
                  <div className="grid gap-2">
                    {fila.map((r) => (
                      <div key={r.id} className="rounded-lg border p-3" style={{ borderColor: LINE }}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="text-sm">
                            <span className="inline-block rounded px-2 py-0.5 text-xs font-bold mr-2" style={{ background: r.acao === 'comprar' ? '#E6F0E6' : '#F3E7DA', color: r.acao === 'comprar' ? '#2F5D2F' : '#7A4A0F', textTransform: 'uppercase' }}>{r.acao}</span>
                            <span style={{ color: ESP, fontWeight: 600 }}>{rotulaClasse(r.classe)}</span>
                            <span className="ml-2" style={{ color: MUT }}>{fmtBRL(r.valor)}</span>
                            {r.justificativa && <div className="mt-1" style={{ color: MUT }}>{r.justificativa}</div>}
                          </div>
                          {podeAprovar ? (
                            <div className="flex items-center gap-2 shrink-0">
                              <button onClick={() => void aprovar(r.id)} disabled={busy}
                                className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>Aprovar</button>
                              <button onClick={() => void rejeitar(r.id)} disabled={busy}
                                className="rounded-lg px-3 py-2 text-sm font-semibold border" style={{ borderColor: '#B84A4A', color: '#7A1F1F', background: '#fff', opacity: busy ? 0.6 : 1 }}>Rejeitar</button>
                            </div>
                          ) : (
                            <span className="text-xs shrink-0" style={{ color: MUT }}>aguarda André</span>
                          )}
                        </div>
                        {podeAprovar && (
                          <input value={motivo[r.id] ?? ''} onChange={(e) => setMotivo((m) => ({ ...m, [r.id]: e.target.value }))}
                            placeholder="Motivo (obrigatório para rejeitar)" className="mt-2 w-full rounded border p-2 text-sm" style={{ borderColor: LINE, color: ESP }} />
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Histórico de recomendações */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Recomendações</div>
                {recs.length === 0 ? <p className="text-sm" style={{ color: MUT }}>Nenhuma recomendação ainda.</p> : (
                  <ul className="divide-y" style={{ borderColor: LINE }}>
                    {recs.map((r) => {
                      const [bg, fg] = STATUS_BADGE[r.status] ?? ['#F3EBDD', '#7A4A0F']
                      return (
                        <li key={r.id} className="py-2.5 text-sm">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span style={{ color: ESP }}>
                              <span style={{ textTransform: 'uppercase', fontWeight: 700, color: r.acao === 'comprar' ? '#2F5D2F' : '#7A4A0F' }}>{r.acao}</span>
                              {' '}{rotulaClasse(r.classe)} <span style={{ color: MUT }}>· {fmtBRL(r.valor)}</span>
                            </span>
                            <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: bg, color: fg }}>{r.status.replace(/_/g, ' ')}</span>
                          </div>
                          <div className="mt-0.5 text-xs" style={{ color: MUT }}>
                            {fmtData(r.criado_em)}{r.ips_id ? ' · balizada por IPS' : ' · sem IPS'}
                            {r.status === 'rejeitada' && r.obs_aprovacao ? ` · motivo: ${r.obs_aprovacao}` : ''}
                            {r.status === 'aprovada' && r.aprovado_em ? ` · aprovada ${fmtData(r.aprovado_em)}` : ''}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
        </>
      )}

      {toast && <div style={toastStyle}>{toast}</div>}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ background: BG, minHeight: '100vh' }}><div className="container mx-auto p-4 md:p-6 max-w-4xl">{children}</div></div>
}

const toastStyle: CSSProperties = { position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: ESP, color: '#fff', padding: '10px 18px', borderRadius: 999, fontSize: 13, zIndex: 60 }
