'use client'
// Painel Recomendações (CVM 19) para a ficha 360°. clienteId do contexto (sem dropdown).
// Mesmo backend: fn_wealth_recomendacao_gerar/_criar/_aprovar/_rejeitar/_listar (disponível pós-#1025).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ESP, GOLD, LINE, MUT, fmtBRL, fmtData, rotulaClasse, BarrasAderencia, type Desvio, Toast } from '../wealth-ui'

type Aderencia = { success?: boolean; error?: string; ips_versao?: number; ips_perfil?: string; desvios?: Desvio[]; precisa_rebalancear?: boolean }
type Sugestao = { classe: string; acao: string; tipo: string; peso_alvo: number; peso_atual: number; drift_pp: number; valor_sugerido: number; justificativa: string }
type Gerar = { ok: boolean; sem_ips?: boolean; erro?: string; ips_id?: string; total_carteira?: number; sugestoes?: Sugestao[] }
type Rec = { id: string; ips_id: string | null; classe: string | null; acao: string; valor: number | null; justificativa: string | null; status: string; criado_em: string; aprovado_em: string | null; obs_aprovacao: string | null }
type Listar = { ok: boolean; recomendacoes: Rec[]; aderencia: Aderencia; aprovador_atual: boolean }

const STATUS_BADGE: Record<string, [string, string]> = {
  aprovada: ['#E6F0E6', '#2F5D2F'], aguarda_aprovacao: ['#FFF3D9', '#7A4A0F'],
  rejeitada: ['#EFE1E1', '#7A1F1F'], rascunho: ['#F3EBDD', '#7A4A0F'], executada: ['#E4EDF3', '#25506B'],
}

export function RecomendacoesPanel({ clienteId, onChange }: { clienteId: string; onChange?: () => void }) {
  const [data, setData] = useState<Listar | null>(null)
  const [gerado, setGerado] = useState<Gerar | null>(null)
  const [motivo, setMotivo] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setGerado(null); setMotivo({})
    const { data: d } = await supabase.rpc('fn_wealth_recomendacao_listar', { p_client_id: clienteId })
    setData((d ?? null) as Listar | null)
  }, [clienteId])
  useEffect(() => { const t = setTimeout(() => { void carregar() }, 0); return () => clearTimeout(t) }, [carregar])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t) }, [toast])

  async function gerar() {
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_gerar', { p_client_id: clienteId })
    setBusy(false)
    const j = (d ?? null) as Gerar | null
    if (error) { setToast(`Erro: ${error.message}`); return }
    setGerado(j)
    if (j && !j.ok) setToast(j.erro ?? 'Não foi possível gerar.')
  }

  async function criar(s: Sugestao) {
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_criar', { p_campos: { client_id: clienteId, classe: s.classe, acao: s.acao, tipo: s.tipo, valor: String(s.valor_sugerido), peso_alvo: String(s.peso_alvo), peso_atual: String(s.peso_atual), justificativa: s.justificativa } })
    setBusy(false)
    const j = d as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Recomendação criada — aguarda aprovação do André.'); await carregar(); onChange?.()
  }

  async function aprovar(id: string) {
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_aprovar', { p_id: id, p_obs: null })
    setBusy(false)
    const j = d as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Recomendação aprovada.'); await carregar(); onChange?.()
  }

  async function rejeitar(id: string) {
    const m = (motivo[id] ?? '').trim()
    if (!m) { setToast('Informe o motivo da rejeição.'); return }
    setBusy(true)
    const { data: d, error } = await supabase.rpc('fn_wealth_recomendacao_rejeitar', { p_id: id, p_motivo: m })
    setBusy(false)
    const j = d as { ok?: boolean; erro?: string } | null
    if (error || !j?.ok) { setToast(`Erro: ${error?.message ?? j?.erro ?? 'falhou'}`); return }
    setToast('Recomendação rejeitada.'); await carregar(); onChange?.()
  }

  if (!data) return <p className="text-sm" style={{ color: MUT }}>Carregando…</p>

  const podeAprovar = data.aprovador_atual === true
  const aderencia = data.aderencia
  const desvios = aderencia?.desvios ?? []
  const recs = data.recomendacoes ?? []
  const fila = recs.filter((r) => r.status === 'aguarda_aprovacao')

  return (
    <div className="grid gap-4">
      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Aderência ao IPS</h3>
          {aderencia?.success ? <span className="text-xs" style={{ color: MUT }}>IPS v{aderencia.ips_versao} · <span className="capitalize">{aderencia.ips_perfil}</span></span> : <span className="inline-block rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: '#FFF3D9', color: '#7A4A0F' }}>sem IPS aprovado</span>}
        </div>
        {!aderencia?.success ? <p className="text-sm" style={{ color: MUT }}>{aderencia?.error ?? 'Aprove um IPS para medir a aderência.'}</p> : desvios.length === 0 ? <p className="text-sm" style={{ color: MUT }}>Sem classes no IPS para comparar.</p> : <BarrasAderencia desvios={desvios} />}
      </section>

      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-lg" style={{ color: ESP, fontFamily: 'serif' }}>Gerar recomendações</h3>
          <button onClick={() => void gerar()} disabled={busy} className="rounded-lg px-4 py-2.5 font-semibold" style={{ background: GOLD, color: '#fff', opacity: busy ? 0.6 : 1 }}>Gerar a partir do IPS</button>
        </div>
        {gerado && !gerado.ok && <div className="rounded-lg border p-3 text-sm" style={{ borderColor: '#E7C9A0', background: '#FFF6E9', color: '#7A4A0F' }}>{gerado.sem_ips ? '⚠ ' : ''}{gerado.erro}</div>}
        {gerado?.ok && (gerado.sugestoes?.length ?? 0) === 0 && <p className="text-sm" style={{ color: MUT }}>Carteira dentro das bandas do IPS — nada a rebalancear.</p>}
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
                <button onClick={() => void criar(s)} disabled={busy} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold border" style={{ borderColor: GOLD, color: ESP, background: '#FFF9EE', opacity: busy ? 0.6 : 1 }}>Criar</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {fila.length > 0 && (
        <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
          <h3 className="text-lg mb-1" style={{ color: ESP, fontFamily: 'serif' }}>Aguardando aprovação (CVM 19)</h3>
          {!podeAprovar && <p className="text-xs mb-3" style={{ color: MUT }}>Somente o consultor habilitado CVM 19 (André) aprova.</p>}
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
                      <button onClick={() => void aprovar(r.id)} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: ESP, color: '#fff', opacity: busy ? 0.6 : 1 }}>Aprovar</button>
                      <button onClick={() => void rejeitar(r.id)} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold border" style={{ borderColor: '#B84A4A', color: '#7A1F1F', background: '#fff', opacity: busy ? 0.6 : 1 }}>Rejeitar</button>
                    </div>
                  ) : <span className="text-xs shrink-0" style={{ color: MUT }}>aguarda André</span>}
                </div>
                {podeAprovar && <input value={motivo[r.id] ?? ''} onChange={(e) => setMotivo((m) => ({ ...m, [r.id]: e.target.value }))} placeholder="Motivo (obrigatório para rejeitar)" className="mt-2 w-full rounded border p-2 text-sm" style={{ borderColor: LINE, color: ESP }} />}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-xl border p-5" style={{ borderColor: LINE, background: '#fff' }}>
        <div className="text-xs uppercase tracking-wide font-semibold mb-2" style={{ color: MUT }}>Recomendações</div>
        {recs.length === 0 ? <p className="text-sm" style={{ color: MUT }}>Nenhuma recomendação ainda.</p> : (
          <ul className="divide-y" style={{ borderColor: LINE }}>
            {recs.map((r) => {
              const [bg, fg] = STATUS_BADGE[r.status] ?? ['#F3EBDD', '#7A4A0F']
              return (
                <li key={r.id} className="py-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span style={{ color: ESP }}><span style={{ textTransform: 'uppercase', fontWeight: 700, color: r.acao === 'comprar' ? '#2F5D2F' : '#7A4A0F' }}>{r.acao}</span> {rotulaClasse(r.classe)} <span style={{ color: MUT }}>· {fmtBRL(r.valor)}</span></span>
                    <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: bg, color: fg }}>{r.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="mt-0.5 text-xs" style={{ color: MUT }}>{fmtData(r.criado_em)}{r.ips_id ? ' · balizada por IPS' : ' · sem IPS'}{r.status === 'rejeitada' && r.obs_aprovacao ? ` · motivo: ${r.obs_aprovacao}` : ''}{r.status === 'aprovada' && r.aprovado_em ? ` · aprovada ${fmtData(r.aprovado_em)}` : ''}</div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <Toast msg={toast} />
    </div>
  )
}
