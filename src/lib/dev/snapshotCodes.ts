// Aba Codes · gráficos do histórico (fatia 2): regras PURAS sobre erp_dev_codes_snapshot (um retrato a cada 15 min).
export type Snapshot = {
  capturado_em: string
  main_estado: 'verde' | 'vermelho' | 'desconhecido' | null
  deploy_estado: 'verde' | 'vermelho' | 'desconhecido' | null
  sessoes_abertas: Record<string, number> | null
  mensagens_por_status: Record<string, Record<string, number>> | null
}

const JANELA_MIN = 15

/** Minutos com sessão aberta por Code (cada retrato com o Code ativo = 15 min), do maior para o menor. */
export function sessoesPorCode(snaps: Snapshot[]): { code: string; minutos: number }[] {
  const acc: Record<string, number> = {}
  for (const s of snaps) for (const [code, n] of Object.entries(s.sessoes_abertas ?? {})) if (n > 0) acc[code] = (acc[code] ?? 0) + JANELA_MIN
  return Object.entries(acc).map(([code, minutos]) => ({ code, minutos })).sort((a, b) => b.minutos - a.minutos)
}

/** Linha do tempo verde/vermelho: 1 = verde, 0 = vermelho, null = sem leitura (desconhecido). */
export function linhaDoTempo(snaps: Snapshot[], campo: 'main_estado' | 'deploy_estado'): { t: number; valor: 0 | 1 | null }[] {
  return [...snaps].sort((a, b) => a.capturado_em.localeCompare(b.capturado_em)).map((s) => ({
    t: new Date(s.capturado_em).getTime(),
    valor: s[campo] === 'verde' ? 1 : s[campo] === 'vermelho' ? 0 : null,
  }))
}

/** Mensagens abertas (em_andamento + pendente) por Code no retrato mais recente. */
export function mensagensAbertas(snaps: Snapshot[]): { code: string; abertas: number }[] {
  const ult = [...snaps].sort((a, b) => b.capturado_em.localeCompare(a.capturado_em))[0]
  if (!ult?.mensagens_por_status) return []
  return Object.entries(ult.mensagens_por_status)
    .map(([code, st]) => ({ code, abertas: (st.em_andamento ?? 0) + (st.pendente ?? 0) + (st.nova ?? 0) }))
    .filter((x) => x.abertas > 0).sort((a, b) => b.abertas - a.abertas)
}
