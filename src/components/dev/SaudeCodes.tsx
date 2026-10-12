'use client'
// Aba Codes · card "Saúde dos Codes" (Eng. Chefe 11/10): lê a RPC fn_codes_saude() — um semáforo por Code ativo.
// Verde = trabalhando ou na fila · amarelo = ocioso · vermelho = TRAVADO. Recarrega a cada 60 s. "?" inline (sem migration: via rápida).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ordenarSaude, semaforoCode, type SaudeCode, type SemaforoCode } from '@/lib/dev/saudeCodes'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F'
const COR: Record<SemaforoCode, { bg: string; fg: string }> = {
  verde: { bg: '#DCFCE7', fg: '#166534' },
  amarelo: { bg: '#FEF3C7', fg: '#92400E' },
  vermelho: { bg: '#FEE2E2', fg: '#B91C1C' },
}

export default function SaudeCodes() {
  const [lista, setLista] = useState<SaudeCode[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_codes_saude')
    if (error) { setErro(error.message); return }
    setErro(null); setLista(ordenarSaude((data ?? []) as SaudeCode[]))
  }, [])

  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  return (
    <section data-testid="codes-saude-codes" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Saúde dos Codes</h3>
      <details style={{ fontSize: 12, color: TXM, marginBottom: 8 }}>
        <summary style={{ cursor: 'pointer' }} aria-label="O que significa a Saúde dos Codes">?</summary>
        Um cartão por Code ativo. Verde: trabalhando ou com tarefa na fila. Amarelo: ocioso, sem tarefa. Vermelho: TRAVADO — tem tarefa esperando e ninguém a está tratando. “Backlog antigo” são tarefas abertas há muito tempo.
      </details>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a saúde dos Codes: {erro}</div>}
      {!lista && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {lista && lista.length === 0 && <div style={{ fontSize: 12, color: TXM }}>Nenhum Code ativo no momento.</div>}
      {lista && lista.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {lista.map((c) => {
            const sem = semaforoCode(c), cor = COR[sem]
            return (
              <div key={c.code} data-testid={`saude-code-${c.code}`} data-semaforo={sem}
                style={{ background: cor.bg, color: cor.fg, border: `1px solid ${cor.fg}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, overflowWrap: 'anywhere' }}>{c.code}</div>
                <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2 }}>{c.status}</div>
                <div style={{ fontSize: 12 }}>
                  {c.lease_ativa ? 'sessão ativa' : 'sem sessão'} · {c.tarefas_recentes} tarefa(s) recente(s)
                  {c.mais_antiga_recente_min != null ? ` · a mais antiga há ${c.mais_antiga_recente_min} min` : ''}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>Backlog antigo: {c.backlog_antigo}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
