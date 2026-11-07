// Limite de WIP por Code (CEO/Eng. Chefe 17/10, tarefa c66b6ea4) — lógica pura, sem rede.
// Regra: no máximo 3 PRs abertas e não publicadas do MESMO Code, sendo no máximo 1 "em construção"
// (rascunho, ou com commit nas últimas 2 h sem estar pronta). As outras só podem estar esperando terceiros
// (revisor, fila de migration, teste da main). Excedeu: label `limite-wip`, a fila ignora a PR e o autor
// recebe a tarefa "termine ou feche uma antes". Quem fica é a mais antiga (ordem de abertura).
export const LIMITE_ABERTAS = 3
export const LIMITE_EM_CONSTRUCAO = 1
export const JANELA_CONSTRUCAO_MS = 2 * 60 * 60 * 1000
export const LABEL_LIMITE = 'limite-wip'

export interface PrWip {
  number: number
  draft: boolean
  labels: string[]
  created_at: string
  last_commit_at: string
  body: string | null
}

/** Code autor: linha `Code: <nome da rotina>` do corpo da PR (regra da aba Codes). */
export function codeDaPr(body: string | null | undefined): string | null {
  const m = /^\s*Code:\s*([a-z0-9][a-z0-9-]*)\s*$/im.exec(body ?? '')
  return m ? m[1].toLowerCase() : null
}

export function emConstrucao(pr: PrWip, agora: number): boolean {
  if (pr.draft) return true
  return agora - new Date(pr.last_commit_at).getTime() < JANELA_CONSTRUCAO_MS
}

export interface VereditoWip { number: number; excede: boolean; motivo: string }

/** Avalia as PRs abertas de UM Code. Admite pela ordem de abertura; o que passa do limite é marcado. */
export function avaliarWip(prsDoCode: PrWip[], agora: number): VereditoWip[] {
  const ordem = [...prsDoCode].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.number - b.number)
  let admitidas = 0
  let construindo = 0
  return ordem.map((pr) => {
    const cons = emConstrucao(pr, agora)
    if (admitidas >= LIMITE_ABERTAS) return { number: pr.number, excede: true, motivo: `mais de ${LIMITE_ABERTAS} PRs abertas do mesmo Code` }
    if (cons && construindo >= LIMITE_EM_CONSTRUCAO) return { number: pr.number, excede: true, motivo: `mais de ${LIMITE_EM_CONSTRUCAO} PR em construção do mesmo Code` }
    admitidas++
    if (cons) construindo++
    return { number: pr.number, excede: false, motivo: 'dentro do limite' }
  })
}

/** Agrupa todas as PRs abertas por Code (PR sem linha `Code:` fica fora: não dá para atribuir) e avalia cada grupo. */
export function avaliarTodas(prs: PrWip[], agora: number): Map<string, VereditoWip[]> {
  const porCode = new Map<string, PrWip[]>()
  for (const pr of prs) {
    const c = codeDaPr(pr.body)
    if (!c) continue
    porCode.set(c, [...(porCode.get(c) ?? []), pr])
  }
  return new Map([...porCode].map(([c, lista]) => [c, avaliarWip(lista, agora)]))
}

// CLI (workflow limite-wip.yml): stdin = JSON [PrWip...]; stdout = JSON [{number, code, excede, motivo}]
if (process.argv[1] && /merge\/wip-limite\.ts$/.test(process.argv[1])) {
  let txt = ''
  process.stdin.on('data', (d) => { txt += d })
  process.stdin.on('end', () => {
    const prs = JSON.parse(txt) as PrWip[]
    const saida: Array<VereditoWip & { code: string }> = []
    for (const [code, vs] of avaliarTodas(prs, Date.now())) for (const v of vs) saida.push({ code, ...v })
    process.stdout.write(JSON.stringify(saida))
  })
}
