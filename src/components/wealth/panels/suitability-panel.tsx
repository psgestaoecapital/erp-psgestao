'use client'
// Painel Suitability (CVM 30) para a ficha 360°. Recebe clienteId do contexto (sem dropdown).
// Mesmo backend: fn_wealth_suitability_status/_questionario/_calcular.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ESP, GOLD, LINE, MUT, fmtData, Toast } from '../wealth-ui'

const PERFIS = ['conservador', 'moderado', 'arrojado', 'agressivo'] as const
type Perfil = (typeof PERFIS)[number]
const perfilIdx = (p: string | null) => PERFIS.indexOf((p ?? '') as Perfil)

type Opcao = { id: string; ordem: number; texto: string }
type Pergunta = { id: string; ordem: number; texto: string; categoria: string | null; opcoes: Opcao[] }
type Status = { ok?: boolean; tem_perfil?: boolean; perfil?: string; valido_ate?: string | null; vencido?: boolean; perfil_cadastro?: string | null }
type HistItem = { id: string; perfil_resultado: string | null; pontuacao_total: number | null; respondido_em: string; valido_ate: string | null }
type Resultado = { perfil: string; pontuacao_total: number; media: number; valido_ate: string }

export function SuitabilityPanel({ clienteId, empresa, onChange }: { clienteId: string; empresa: string; onChange?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [historico, setHistorico] = useState<HistItem[]>([])
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  const [wizardOn, setWizardOn] = useState(false)
  const [idx, setIdx] = useState(0)
  const [respostas, setRespostas] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setResultado(null); setWizardOn(false)
    const [{ data: st }, { data: hist }] = await Promise.all([
      supabase.rpc('fn_wealth_suitability_status', { p_client_id: clienteId }),
      supabase.from('wealth_suitability_resposta').select('id, perfil_resultado, pontuacao_total, respondido_em, valido_ate').eq('client_id', clienteId).order('respondido_em', { ascending: false }),
    ])
    setStatus((st ?? null) as Status | null)
    setHistorico((hist ?? []) as HistItem[])
  }, [clienteId])
  useEffect(() => { const t = setTimeout(() => { void carregar() }, 0); return () => clearTimeout(t) }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3000); return () => clearTimeout(t) }, [toast])

  async function iniciarWizard() {
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
    setBusy(true)
    const { data, error } = await supabase.rpc('fn_wealth_suitability_calcular', { p_client_id: clienteId, p_respostas: resp })
    setBusy(false)
    const j = data as ({ ok?: boolean; erro?: string } & Resultado) | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setResultado({ perfil: j.perfil, pontuacao_total: j.pontuacao_total, media: j.media, valido_ate: j.valido_ate })
    setWizardOn(false)
    setToast('Perfil calculado e registrado.')
    await carregar(); onChange?.()
  }

  const escalaPerfil = useMemo(() => status?.perfil ?? null, [status])

  if (wizardOn && perguntas.length > 0) {
    return (
      <section className="rounded-xl border p-6 max-w-2xl" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs uppercase tracking-wide font-semibold" style={{ color: GOLD }}>Pergunta {idx + 1} de {perguntas.length}</span>
          <button onClick={() => setWizardOn(false)} className="text-sm" style={{ color: MUT }}>Cancelar</button>
        </div>
        <div className="h-1 rounded-full mb-5" style={{ background: 'rgba(200,148,26,0.15)' }}>
          <div className="h-1 rounded-full" style={{ background: GOLD, width: `${((idx + 1) / perguntas.length) * 100}%`, transition: 'width .2s' }} />
        </div>
        <h3 className="text-lg mb-4" style={{ color: ESP, fontFamily: 'serif' }}>{perguntas[idx].texto}</h3>
        <div className="grid gap-2">
          {perguntas[idx].opcoes.map((o) => {
            const on = respostas[perguntas[idx].id] === o.id
            return (
              <button key={o.id} onClick={() => responder(perguntas[idx].id, o.id)} disabled={busy}
                className="text-left rounded-lg border p-3 transition" style={{ borderColor: on ? GOLD : LINE, background: on ? '#FFF9EE' : '#fff', color: ESP }}>
                {o.texto}
              </button>
            )
          })}
        </div>
        {idx > 0 && <button onClick={() => setIdx((i) => Math.max(0, i - 1))} className="mt-4 text-sm" style={{ color: MUT }}>← Voltar</button>}
        <Toast msg={toast} />
      </section>
    )
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: MUT }}>Perfil atual</div>
            {status?.tem_perfil ? (
              <>
                <div className="text-2xl mt-1" style={{ color: ESP, fontFamily: 'serif', textTransform: 'capitalize' }}>{status.perfil}</div>
                <div className="text-sm mt-1" style={{ color: status.vencido ? '#7A1F1F' : MUT }}>
                  Válido até {fmtData(status.valido_ate ?? null)}
                  {status.vencido && <span className="ml-2 inline-block rounded-full px-2 py-0.5 text-xs font-bold" style={{ background: '#F4D6D6', color: '#7A1F1F' }}>Vencido — refazer</span>}
                </div>
              </>
            ) : (
              <div className="text-sm mt-1" style={{ color: MUT }}>Sem suitability respondido{status?.perfil_cadastro ? ` (cadastro: ${status.perfil_cadastro})` : ''}.</div>
            )}
          </div>
          <button onClick={() => void iniciarWizard()} disabled={busy}
            className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>
            {status?.tem_perfil ? 'Refazer suitability' : 'Responder suitability'}
          </button>
        </div>
        <div className="mt-4 flex gap-1.5">
          {PERFIS.map((p, i) => {
            const on = perfilIdx(escalaPerfil) === i
            return (
              <div key={p} className="flex-1 text-center">
                <div className="h-2 rounded-full" style={{ background: on ? GOLD : 'rgba(200,148,26,0.18)' }} />
                <div className="text-[10px] mt-1 capitalize" style={{ color: on ? ESP : MUT, fontWeight: on ? 700 : 400 }}>{p}</div>
              </div>
            )
          })}
        </div>
      </section>

      {resultado && (
        <section className="rounded-xl border p-5" style={{ borderColor: GOLD, background: '#FFF9EE' }}>
          <div className="text-xs uppercase tracking-wide font-semibold" style={{ color: GOLD }}>Resultado</div>
          <div className="text-xl mt-1 capitalize" style={{ color: ESP, fontFamily: 'serif' }}>{resultado.perfil}</div>
          <div className="text-sm mt-1" style={{ color: MUT }}>Pontuação {resultado.pontuacao_total} · média {resultado.media} · válido até {fmtData(resultado.valido_ate)}</div>
        </section>
      )}

      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Histórico de perfis</div>
        {historico.length === 0 ? <p className="text-sm" style={{ color: MUT }}>Nenhum suitability registrado ainda.</p> : (
          <ul className="divide-y" style={{ borderColor: LINE }}>
            {historico.map((h, i) => (
              <li key={h.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                <span className="capitalize" style={{ color: ESP, fontWeight: i === 0 ? 700 : 400 }}>{i === 0 ? '● ' : '○ '}{h.perfil_resultado ?? '—'}</span>
                <span style={{ color: MUT }}>{fmtData(h.respondido_em)} · válido até {fmtData(h.valido_ate)} · {h.pontuacao_total ?? '—'} pts</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Toast msg={toast} />
    </div>
  )
}
