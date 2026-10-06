// Regras PURAS da esteira de merge (CEO 06/10, "destravar a esteira"). Sem rede: o que decide é testado pelo gate
// scripts/gates/check-merge-esteira.ts; as CLIs (pos-migration.ts, fila.ts, patch-id.ts) só buscam os dados e agem.

export type Run = { id: number; head_sha: string; status: string; conclusion: string | null; created_at: string }
export type AcaoPos = { acao: 'liberado' | 'aguardar' | 'rerodar' | 'vermelho'; runId?: number; motivo: string }

// (1) Run CANCELADO não é vermelho. `runs` = runs do aceitacao-pos-migration cujo commit é a última migration da
// main ou posterior (um verde num commit posterior cobre a migration: o teste roda o repo inteiro @pos-migration).
export function decidirPosMigration(runs: Run[]): AcaoPos {
  const ord = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (ord.some((r) => r.status === 'completed' && r.conclusion === 'success')) return { acao: 'liberado', motivo: 'há run verde desde a última migration' }
  if (ord.some((r) => r.status !== 'completed')) return { acao: 'aguardar', motivo: 'run em andamento' }
  const ultimo = ord[0]
  if (!ultimo) return { acao: 'aguardar', motivo: 'sem run ainda (deploy-migrations em andamento?)' }
  if (ultimo.conclusion === 'cancelled') return { acao: 'rerodar', runId: ultimo.id, motivo: 'último run foi CANCELADO e nenhum ficou verde' }
  return { acao: 'vermelho', runId: ultimo.id, motivo: `último run terminou ${ultimo.conclusion}` }
}

// (2) PR sem arquivo em supabase/migrations não espera a janela de produção (@pos-migration só bloqueia PR COM migration).
export function exigencias(arquivos: string[]) {
  const temMigration = arquivos.some((f) => /^supabase\/migrations\/[^/]+\.sql$/.test(f))
  return temMigration
    ? { temMigration, esperaPosMigration: true, requer: ['gates', 'vercel', 'aceitacao-completa', 'pos-migration-verde-na-main'] }
    : { temMigration, esperaPosMigration: false, requer: ['gates', 'vercel', 'aceitacao-da-area'] }
}

// Área da PR → trechos de nome de spec em e2e/jornadas/aceitacao (aceitação seletiva). Vazio = não deu para inferir
// (cai na aceitação completa — fail-closed).
export function areasDaPr(arquivos: string[]): string[] {
  const areas = new Set<string>()
  for (const f of arquivos) {
    const m = f.match(/^src\/(?:app|components|lib)\/(?:\([^)]*\)\/)?([a-z0-9-]+)/i) ?? f.match(/^e2e\/jornadas\/aceitacao\/([a-z0-9-]+)/i)
    if (m && !['api', 'ui', 'utils', 'supabase'].includes(m[1].toLowerCase())) areas.add(m[1].toLowerCase())
  }
  return [...areas].sort()
}

// (3) Autorização por CONTEÚDO: o comentário do revisor leva `patch-id: <hex>` (git diff base...head | git patch-id
// --stable). Atualizar com a main não muda o patch-id; mudar o código da PR muda → nova revisão.
export const reMarca = /MERGE AUTORIZADO\s*#(\d+)[\s\S]*?patch-id:\s*([0-9a-f]{40})/i
export type Comentario = { login: string; body: string; created_at: string }
export function autorizada(pr: number, patchIdAtual: string, comentarios: Comentario[], autorizadores: string[]): { ok: boolean; motivo: string } {
  const doRevisor = comentarios.filter((c) => autorizadores.includes(c.login))
  let ultima: string | null = null
  for (const c of [...doRevisor].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const m = c.body.match(reMarca)
    if (m && Number(m[1]) === pr) ultima = m[2].toLowerCase()
  }
  if (!ultima) return { ok: false, motivo: 'sem comentário "MERGE AUTORIZADO #N … patch-id: <hex>" de um autorizador' }
  if (ultima !== patchIdAtual.toLowerCase()) return { ok: false, motivo: `o código da PR mudou desde a autorização (patch-id ${patchIdAtual.slice(0, 8)} ≠ ${ultima.slice(0, 8)}): nova revisão` }
  return { ok: true, motivo: 'patch-id igual ao autorizado' }
}

// (4) Fila: ordem de chegada = momento em que a label `fila-merge` foi posta. A primeira PR da fila manda: se está
// só esperando check/main, as de trás esperam (um por vez); se não está autorizada ou está vermelha, sai da vez.
export type ItemFila = { numero: number; entrou: string; autorizada: boolean; verde: boolean; pendente: boolean; atrasada: boolean }
export type Passo = { numero: number; acao: 'mergear' | 'atualizar' | 'esperar' | 'pular'; motivo: string }
export function proximoPasso(fila: ItemFila[]): Passo | null {
  for (const it of [...fila].sort((a, b) => a.entrou.localeCompare(b.entrou))) {
    if (!it.autorizada) { continue }
    if (it.atrasada) return { numero: it.numero, acao: 'atualizar', motivo: 'atrás da main: atualizar e esperar os checks' }
    if (it.pendente) return { numero: it.numero, acao: 'esperar', motivo: 'checks em andamento' }
    if (!it.verde) { continue }
    return { numero: it.numero, acao: 'mergear', motivo: 'autorizada, atualizada e verde' }
  }
  return null
}
