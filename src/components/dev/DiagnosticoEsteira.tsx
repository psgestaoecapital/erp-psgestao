'use client'
// Aba Codes · bloco "Diagnóstico da Esteira" (Eng. Chefe 20/10): vagas, vazão, vazamento de reserva e fila numa leitura só
// (RPC fn_esteira_diagnostico), para um print dar o diagnóstico completo. Semáforo só de performance. Recarrega a cada 60 s.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import type { Semaforo } from '@/lib/dev/saudeEsteira'
import { formatarMin } from '@/lib/dev/saudeEsteira'
import { classificarLeak, classificarVaga, classificarVazao, META_PUB_HORA, nomeVaga, type Diagnostico } from '@/lib/dev/diagnosticoEsteira'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F', ROTA = '/dashboard/dev/codes'
const REPO_URL = 'https://github.com/psgestaoecapital/erp-psgestao'
const COR: Record<Semaforo, { bg: string; fg: string }> = {
  verde: { bg: '#DCFCE7', fg: '#166534' }, amarelo: { bg: '#FEF3C7', fg: '#92400E' }, vermelho: { bg: '#FEE2E2', fg: '#B91C1C' },
}

// Fila PR a PR (CEO 23/10): cada PR que espera ou ficou fora da rodada, com o motivo exato e o link —
// vem direto de erp_esteira_pr_estado (a fila escreve a cada rodada; RLS de leitura da equipe PS).
type PrFila = { pr_numero: number; via: string | null; estado: string; motivo: string | null; tem_migration: boolean; run_url: string | null; atualizado_em: string }
// "fora-da-rodada" = barrou nesta rodada (precisa de ação); "esperando" = na vez, aguardando a main/checks.
const ORDEM_ESTADO: Record<string, number> = { 'fora-da-rodada': 0, esperando: 1 }
function corEstado(estado: string): Semaforo { return estado === 'fora-da-rodada' ? 'vermelho' : 'amarelo' }

function Card({ id, titulo, ajuda, sem, children }: { id: string; titulo: string; ajuda: string; sem?: Semaforo; children: ReactNode }) {
  const c = sem ? COR[sem] : { bg: BRANCO, fg: ESP }
  return (
    <div data-testid={`diag-${id}`} data-semaforo={sem ?? ''} style={{ background: c.bg, color: c.fg, border: `1px solid ${sem ? c.fg : BD}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>{titulo} <AjudaCampo chave={ajuda} rota={ROTA} /></div>
      {children}
    </div>
  )
}

export default function DiagnosticoEsteira() {
  const [d, setD] = useState<Diagnostico | null>(null)
  const [fila, setFila] = useState<PrFila[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_esteira_diagnostico')
    if (error) { setErro(error.message); return }
    setErro(null); setD(data as Diagnostico)
    const { data: prs } = await supabase
      .from('erp_esteira_pr_estado')
      .select('pr_numero,via,estado,motivo,tem_migration,run_url,atualizado_em')
      .in('estado', ['esperando', 'fora-da-rodada'])
      .order('atualizado_em', { ascending: false })
      .limit(80)
    const lista = ((prs ?? []) as PrFila[]).slice().sort((a, b) =>
      (ORDEM_ESTADO[a.estado] ?? 9) - (ORDEM_ESTADO[b.estado] ?? 9) || a.pr_numero - b.pr_numero)
    setFila(lista)
  }, [])
  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 60_000)
    return () => clearInterval(i)
  }, [carregar])

  const agora = new Date()
  const vz = d ? classificarVazao(d.vazao, agora) : null
  return (
    <section data-testid="codes-diagnostico-esteira" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>Diagnóstico da Esteira <span style={{ fontWeight: 400, fontSize: 12, color: TXM }}>· ao vivo, últimas 24 h</span></h3>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler o diagnóstico: {erro}</div>}
      {!d && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {d && vz && (
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {d.vagas.map((v) => {
              const presa = d.presas.filter((p) => p.vaga === v.vaga).reduce((m, p) => Math.max(m, p.min), 0)
              const k = classificarVaga(v, presa)
              return (
                <Card key={v.vaga} id={`vaga-${v.vaga}`} titulo={nomeVaga(v.vaga)} sem={k.sem} ajuda="diag.vagas">
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{k.texto}</div>
                  <div style={{ fontSize: 12 }}>{v.ciclos_24h} ciclos em 24 h · {v.ciclos_curtos_24h} abortados · {v.abertas} aberta(s)</div>
                  {k.causa && <div style={{ fontSize: 12, marginTop: 2 }}>Causa: {k.causa}</div>}
                </Card>
              )
            })}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card id="vazao" titulo="Vazão" sem={vz.sem} ajuda="diag.vazao">
              <div style={{ fontSize: 20, fontWeight: 700 }}>{d.vazao.pub_1h} / {META_PUB_HORA} por hora</div>
              <div style={{ fontSize: 12 }}>{d.vazao.pub_24h} em 24 h · pronta→publicada: {d.vazao.mediana_pronta_pub_min === null ? 'sem dado' : formatarMin(d.vazao.mediana_pronta_pub_min)}</div>
              <div style={{ fontSize: 12 }}>{vz.haMin === null ? 'Nenhuma publicação registrada' : `Última publicação há ${formatarMin(vz.haMin)} sem publicar`}</div>
            </Card>
            <Card id="leak" titulo="Vazamento de reserva" sem={classificarLeak(d)} ajuda="diag.leak">
              <div style={{ fontSize: 20, fontWeight: 700 }}>{d.presas.length} presa(s) · {d.duplicadas.length} duplicada(s)</div>
              {d.presas.slice(0, 5).map((p) => <div key={`${p.pr_numero}-${p.vaga}`} style={{ fontSize: 12 }}>#{p.pr_numero} na vaga {p.vaga} há {formatarMin(p.min)}</div>)}
              {d.duplicadas.slice(0, 5).map((p) => <div key={`d${p.pr_numero}`} style={{ fontSize: 12 }}>#{p.pr_numero} reservada {p.qtd}× (vagas {p.vagas.join(', ')})</div>)}
            </Card>
          </div>
          <Card id="fila" titulo="Fila" ajuda="diag.fila">
            <div style={{ fontSize: 20, fontWeight: 700 }}>{d.fila.esperando} esperando · {d.fila.fora_da_rodada} fora da rodada · {d.fila.fora} fora</div>
            {d.motivos.map((m) => <div key={m.motivo} style={{ fontSize: 12 }}>{m.n}× {m.motivo}</div>)}
            {fila.length > 0 && (
              <div data-testid="fila-por-pr" style={{ marginTop: 10, borderTop: `1px solid ${BD}`, paddingTop: 8, display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: TXM }}>PR a PR · ao vivo</div>
                {fila.map((p) => {
                  const cor = COR[corEstado(p.estado)]
                  return (
                    <div key={p.pr_numero} data-testid={`fila-pr-${p.pr_numero}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
                      <a href={`${REPO_URL}/pull/${p.pr_numero}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: ESP, whiteSpace: 'nowrap' }}>#{p.pr_numero}</a>
                      <span style={{ fontSize: 10, fontWeight: 700, background: cor.bg, color: cor.fg, border: `1px solid ${cor.fg}`, borderRadius: 999, padding: '0 6px', whiteSpace: 'nowrap' }}>{p.estado === 'fora-da-rodada' ? 'fora da rodada' : 'esperando'}</span>
                      {p.tem_migration && <span style={{ fontSize: 10, fontWeight: 700, background: '#EDE7DF', color: ESP, borderRadius: 999, padding: '0 6px', whiteSpace: 'nowrap' }}>migration</span>}
                      {p.via && <span style={{ fontSize: 10, color: TXM, whiteSpace: 'nowrap' }}>via {p.via}</span>}
                      <span style={{ color: TXM, flex: 1, minWidth: 180 }}>{p.motivo ?? 'sem motivo registrado'}</span>
                      {p.run_url && <a href={p.run_url} target="_blank" rel="noreferrer" style={{ color: TXM, whiteSpace: 'nowrap' }}>run ↗</a>}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </section>
  )
}
