'use client'
// WEALTH · Suitability (CVM 30). Questionário de perfil de risco versionado por cliente, com validade.
// Backend: fn_wealth_suitability_questionario / _calcular / _status. Perfil grava em wealth_clients.perfil_risco
// + wealth_suitability_resposta (histórico). Identidade PS (Espresso/dourado); semáforo só do perfil.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '@/lib/supabase'
import { useCompanyIds } from '@/lib/useCompanyIds'

const ESP = '#3D2314', GOLD = '#C8941A', BG = '#FAF7F2', LINE = 'rgba(61,35,20,0.12)', MUT = 'rgba(61,35,20,0.6)'
const PERFIS = ['conservador', 'moderado', 'arrojado', 'agressivo'] as const
type Perfil = (typeof PERFIS)[number]
const perfilIdx = (p: string | null) => PERFIS.indexOf((p ?? '') as Perfil)
const fmtData = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')

type Cli = { id: string; nome: string; perfil_risco: string | null }
type Opcao = { id: string; ordem: number; texto: string }
type Pergunta = { id: string; ordem: number; texto: string; categoria: string | null; opcoes: Opcao[] }
type Status = { ok?: boolean; tem_perfil?: boolean; perfil?: string; valido_ate?: string | null; vencido?: boolean; perfil_cadastro?: string | null }
type HistItem = { id: string; perfil_resultado: string | null; pontuacao_total: number | null; respondido_em: string; valido_ate: string | null }
type Resultado = { perfil: string; pontuacao_total: number; media: number; valido_ate: string }

export default function SuitabilityPage() {
  const { selInfo, companyIds } = useCompanyIds()
  const empresa = selInfo.tipo === 'empresa' && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null)

  const [clientes, setClientes] = useState<Cli[]>([])
  const [selId, setSelId] = useState<string>('')
  const [status, setStatus] = useState<Status | null>(null)
  const [historico, setHistorico] = useState<HistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)

  // wizard
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  const [wizardOn, setWizardOn] = useState(false)
  const [idx, setIdx] = useState(0)
  const [respostas, setRespostas] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const carregarClientes = useCallback(async () => {
    if (!empresa) { setClientes([]); setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.from('wealth_clients').select('id, nome, perfil_risco').eq('company_id', empresa).order('nome')
    setClientes((data ?? []) as Cli[]); setLoading(false)
  }, [empresa])
  useEffect(() => { const t = setTimeout(() => { void carregarClientes() }, 0); return () => clearTimeout(t) }, [carregarClientes])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  const carregarCliente = useCallback(async (id: string) => {
    setResultado(null); setWizardOn(false)
    if (!id) { setStatus(null); setHistorico([]); return }
    const [{ data: st }, { data: hist }] = await Promise.all([
      supabase.rpc('fn_wealth_suitability_status', { p_client_id: id }),
      supabase.from('wealth_suitability_resposta').select('id, perfil_resultado, pontuacao_total, respondido_em, valido_ate').eq('client_id', id).order('respondido_em', { ascending: false }),
    ])
    setStatus((st ?? null) as Status | null)
    setHistorico((hist ?? []) as HistItem[])
  }, [])
  useEffect(() => { const t = setTimeout(() => { void carregarCliente(selId) }, 0); return () => clearTimeout(t) }, [selId, carregarCliente])

  const selCli = useMemo(() => clientes.find((c) => c.id === selId) ?? null, [clientes, selId])

  async function iniciarWizard() {
    if (!empresa) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_suitability_questionario', { p_company_id: empresa })
    setBusy(false)
    const j = data as { ok?: boolean; perguntas?: Pergunta[] } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? 'falhou'}`); return }
    setPerguntas((j.perguntas ?? []).slice().sort((a, b) => a.ordem - b.ordem))
    setRespostas({}); setIdx(0); setResultado(null); setWizardOn(true)
  }

  function responder(perguntaId: string, opcaoId: string) {
    const next = { ...respostas, [perguntaId]: opcaoId }
    setRespostas(next)
    if (idx < perguntas.length - 1) { setTimeout(() => setIdx((i) => i + 1), 150); return }
    void finalizar(next)
  }

  async function finalizar(resp: Record<string, string>) {
    if (!selId) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_suitability_calcular', { p_client_id: selId, p_respostas: resp })
    setBusy(false)
    const j = data as { ok?: boolean; erro?: string } & Resultado | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setResultado({ perfil: j.perfil, pontuacao_total: j.pontuacao_total, media: j.media, valido_ate: j.valido_ate })
    setWizardOn(false)
    setToast('Perfil calculado e registrado.')
    await carregarClientes(); await carregarCliente(selId)
  }

  if (!empresa) return <Shell><p style={{ color: MUT }}>Selecione uma empresa no topo.</p></Shell>

  return (
    <Shell>
      <header className="mb-6">
        <p className="text-sm uppercase tracking-wider font-semibold" style={{ color: GOLD }}>Wealth · Compliance</p>
        <h1 className="text-3xl md:text-4xl" style={{ color: ESP, fontFamily: 'serif' }}>Suitability</h1>
        <p className="mt-1" style={{ color: MUT }}>Perfil de risco do cliente (CVM 30) · versionado, com validade.</p>
      </header>

      {loading ? <p style={{ color: MUT }}>Carregando…</p> : (
        <>
          <label className="block mb-5">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: MUT }}>Cliente</span>
            <select value={selId} onChange={(e) => setSelId(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-lg border p-2.5"
              style={{ borderColor: LINE, background: '#fff', color: ESP }}>
              <option value="">Selecione um cliente…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.perfil_risco ? ` · ${c.perfil_risco}` : ''}</option>)}
            </select>
          </label>

          {selCli && !wizardOn && (
            <div className="grid gap-4">
              {/* Status atual */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: MUT }}>Perfil atual</div>
                    {status?.tem_perfil ? (
                      <>
                        <div className="text-2xl mt-1" style={{ color: ESP, fontFamily: 'serif', textTransform: 'capitalize' }}>{status.perfil}</div>
                        <div className="text-sm mt-1" style={{ color: status.vencido ? '#7A1F1F' : MUT }}>
                          Válido até {fmtData(status.valido_ate ?? null)}
                          {status.vencido && <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#F4D6D6', color: '#7A1F1F' }}>Perfil vencido — refazer</span>}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm mt-1" style={{ color: MUT }}>Sem suitability respondido{status?.perfil_cadastro ? ` (cadastro: ${status.perfil_cadastro})` : ''}.</div>
                    )}
                  </div>
                  <button onClick={() => void iniciarWizard()} disabled={busy}
                    className="rounded-lg px-4 py-2.5 font-semibold"
                    style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
                    {status?.tem_perfil ? 'Refazer suitability' : 'Responder suitability'}
                  </button>
                </div>

                {/* Escala do perfil (semáforo — só do perfil, sem verde/vermelho decorativo) */}
                <div className="mt-4 flex gap-1.5">
                  {PERFIS.map((p, i) => {
                    const on = perfilIdx(status?.perfil ?? selCli.perfil_risco) === i
                    return (
                      <div key={p} className="flex-1 text-center">
                        <div className="h-2 rounded-full" style={{ background: on ? GOLD : 'rgba(200,148,26,0.18)' }} />
                        <div className="text-[10px] mt-1 capitalize" style={{ color: on ? ESP : MUT, fontWeight: on ? 700 : 400 }}>{p}</div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {/* Resultado recém-calculado */}
              {resultado && (
                <section className="rounded-xl border p-5" style={{ borderColor: GOLD, background: '#FFF9EE' }}>
                  <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: GOLD }}>Resultado</div>
                  <div className="text-xl mt-1 capitalize" style={{ color: ESP, fontFamily: 'serif' }}>{resultado.perfil}</div>
                  <div className="text-sm mt-1" style={{ color: MUT }}>Pontuação {resultado.pontuacao_total} · média {resultado.media} · válido até {fmtData(resultado.valido_ate)}</div>
                </section>
              )}

              {/* Histórico (CVM 30 exige rastro) */}
              <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
                <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Histórico de perfis</div>
                {historico.length === 0 ? <p className="text-sm" style={{ color: MUT }}>Nenhum suitability registrado ainda.</p> : (
                  <ul className="divide-y" style={{ borderColor: LINE }}>
                    {historico.map((h, i) => (
                      <li key={h.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <span className="capitalize" style={{ color: ESP, fontWeight: i === 0 ? 700 : 400 }}>
                          {i === 0 ? '● ' : '○ '}{h.perfil_resultado ?? '—'}
                        </span>
                        <span style={{ color: MUT }}>{fmtData(h.respondido_em)} · válido até {fmtData(h.valido_ate)} · {h.pontuacao_total ?? '—'} pts</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {/* Wizard: uma pergunta por vez */}
          {selCli && wizardOn && perguntas.length > 0 && (
            <section className="rounded-xl border p-6 max-w-2xl" style={{ borderColor: LINE, background: '#fff' }}>
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs uppercase tracking-wide font-semibold" style={{ color: GOLD }}>Pergunta {idx + 1} de {perguntas.length}</span>
                <button onClick={() => setWizardOn(false)} className="text-sm" style={{ color: MUT }}>Cancelar</button>
              </div>
              <div className="h-1 rounded-full mb-5" style={{ background: 'rgba(200,148,26,0.15)' }}>
                <div className="h-1 rounded-full" style={{ background: GOLD, width: `${((idx + 1) / perguntas.length) * 100}%`, transition: 'width .2s' }} />
              </div>
              <h2 className="text-lg mb-4" style={{ color: ESP, fontFamily: 'serif' }}>{perguntas[idx].texto}</h2>
              <div className="grid gap-2">
                {perguntas[idx].opcoes.map((o) => {
                  const on = respostas[perguntas[idx].id] === o.id
                  return (
                    <button key={o.id} onClick={() => responder(perguntas[idx].id, o.id)} disabled={busy}
                      className="text-left rounded-lg border p-3 transition"
                      style={{ borderColor: on ? GOLD : LINE, background: on ? '#FFF9EE' : '#fff', color: ESP }}>
                      {o.texto}
                    </button>
                  )
                })}
              </div>
              {idx > 0 && <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="mt-4 text-sm" style={{ color: MUT }}>← Voltar</button>}
            </section>
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
