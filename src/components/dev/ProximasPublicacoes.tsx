'use client'
// Aba Codes · "Próximas publicações" (CEO 23/10): a lista VIVA, paralela a "Publicações do dia" — todas as
// PRs do pipeline, da MAIS PRÓXIMA de publicar à MAIS LONGE, cada uma com uma barra que enche da abertura (0%)
// até 100% (prestes a publicar). Ao publicar, a PR sai daqui e aparece em "Publicações do dia".
// Fonte: erp_esteira_pr_estado (a fila escreve a cada rodada; RLS de leitura da equipe PS). Recarrega a cada 30 s.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'

const ESP = '#3D2314', BRANCO = '#FFFFFF', BD = '#E7DED3', TXM = '#6B5D4F', TRK = '#EDE7DF'
const REPO_URL = 'https://github.com/psgestaoecapital/erp-psgestao', ROTA = '/dashboard/dev/codes'
type Sem = 'verde' | 'amarelo' | 'vermelho'
const COR: Record<Sem, string> = { verde: '#16A34A', amarelo: '#CA8A04', vermelho: '#DC2626' }

type PrEstado = { pr_numero: number; via: string | null; estado: string; motivo: string | null; tem_migration: boolean; run_url: string | null }

// Progresso rumo à publicação, lido do estado + motivo que a fila grava. 0% = recém-aberta; 100% = publicando.
// (checks_resumo ainda não é preenchido; o motivo é o sinal mais confiável hoje.)
function progresso(e: PrEstado): { pct: number; etapa: string; sem: Sem } {
  const m = (e.motivo ?? '').toLowerCase()
  if (/spec da própria pr|regress/.test(m)) return { pct: 24, etapa: 'teste da própria PR falhando — corrigir', sem: 'vermelho' }
  if (/check vermelho/.test(m)) return { pct: 28, etapa: 'check obrigatório vermelho — corrigir', sem: 'vermelho' }
  if (/vercel/.test(m)) return { pct: 32, etapa: 'preview da Vercel falhou', sem: 'vermelho' }
  if (/conflito|atualizar com a main/.test(m)) return { pct: 40, etapa: 'conflito com a main — rebase', sem: 'vermelho' }
  if (/autoriza|revisor/.test(m)) return { pct: 62, etapa: 'aguardando o revisor (MERGE AUTORIZADO)', sem: 'amarelo' }
  if (/@pos|aceita[çc][ãa]o[^a]*andamento|aguardando a main/.test(m)) return { pct: 93, etapa: 'quase — esperando o @pos da main', sem: 'amarelo' }
  if (/ritmo|rodada adiada/.test(m)) return { pct: 90, etapa: 'pronta — segurando o ritmo/hora', sem: 'amarelo' }
  if (/espera a main|atrás da anterior/.test(m)) return { pct: 84, etapa: 'na vez (migration, espera a main)', sem: 'amarelo' }
  if (/checks rodando|aguardando[^a]*check|preview/.test(m)) return { pct: 55, etapa: 'checks rodando', sem: 'amarelo' }
  if (e.estado === 'esperando') return { pct: 80, etapa: 'na fila, aguardando a vez', sem: 'amarelo' }
  return { pct: 46, etapa: e.motivo ?? 'em avaliação', sem: 'amarelo' }
}

export default function ProximasPublicacoes() {
  const [prs, setPrs] = useState<PrEstado[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const carregar = useCallback(async () => {
    // 'fora' = tem label nao-publicar (intencional) → não entra na fila de "próximas".
    const { data, error } = await supabase
      .from('erp_esteira_pr_estado')
      .select('pr_numero,via,estado,motivo,tem_migration,run_url')
      .in('estado', ['esperando', 'fora-da-rodada'])
      .limit(200)
    if (error) { setErro(error.message); return }
    setErro(null); setPrs((data ?? []) as PrEstado[])
  }, [])
  useEffect(() => {
    void carregar()
    const i = setInterval(() => void carregar(), 30_000)
    return () => clearInterval(i)
  }, [carregar])

  // Da MAIS PRÓXIMA (maior %) à MAIS LONGE; desempate pelo nº da PR.
  const lista = (prs ?? [])
    .map((e) => ({ e, p: progresso(e) }))
    .sort((a, b) => b.p.pct - a.p.pct || a.e.pr_numero - b.e.pr_numero)

  return (
    <section data-testid="codes-proximas-publicacoes" style={{ background: BRANCO, border: `1px solid ${BD}`, borderRadius: 12, padding: 14, marginBottom: 12, color: ESP }}>
      <h3 style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700 }}>
        Próximas publicações <AjudaCampo chave="dev.codes.proximas_publicacoes" rota={ROTA} />
      </h3>
      <div style={{ fontSize: 12, color: TXM, marginBottom: 10 }}>Toda PR na fila, da mais próxima de publicar à mais longe · a barra enche até publicar · ao publicar, vai para “Publicações do dia” · ao vivo</div>
      {erro && <div role="alert" style={{ fontSize: 12 }}>Não consegui ler a fila: {erro}</div>}
      {!prs && !erro && <div style={{ fontSize: 12, color: TXM }}>Carregando…</div>}
      {prs && lista.length === 0 && !erro && <div style={{ fontSize: 12, color: TXM }}>Nada na fila agora — tudo publicado. 🎉</div>}
      <div style={{ display: 'grid', gap: 8 }}>
        {lista.map(({ e, p }) => (
          <div key={e.pr_numero} data-testid={`proxima-pr-${e.pr_numero}`} style={{ display: 'grid', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <a href={`${REPO_URL}/pull/${e.pr_numero}`} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: ESP, whiteSpace: 'nowrap' }}>#{e.pr_numero}</a>
              {e.tem_migration && <span style={{ fontSize: 10, fontWeight: 700, background: '#EDE7DF', color: ESP, borderRadius: 999, padding: '0 6px' }}>migration</span>}
              {e.via && <span style={{ fontSize: 10, color: TXM }}>via {e.via}</span>}
              <span style={{ color: TXM, flex: 1, minWidth: 140 }}>{p.etapa}</span>
              <span style={{ fontWeight: 700, color: COR[p.sem], whiteSpace: 'nowrap' }}>{p.pct}%</span>
              {e.run_url && <a href={e.run_url} target="_blank" rel="noreferrer" style={{ color: TXM, whiteSpace: 'nowrap' }}>run ↗</a>}
            </div>
            <div style={{ height: 8, background: TRK, borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${p.pct}%`, height: '100%', background: COR[p.sem], borderRadius: 999, transition: 'width .6s ease' }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
