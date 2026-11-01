// Gate (tarefa ed3c58bc, CEO 14/10): a tela da main não vai ao ar antes da migration do mesmo commit.
// Roda esperarMigration() contra uma API simulada (sem rede).
import { esperarMigration } from '../vercel-ignore.mjs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

async function cenario(arquivos: string[], runs: Array<{ status: string; conclusion?: string }>) {
  let t = 0, consultasRuns = 0
  const consulta = async (c: string) => {
    if (c.includes('/commits/')) return { files: arquivos.map((filename) => ({ filename })) }
    consultasRuns++
    const i = Math.min(consultasRuns - 1, runs.length - 1)
    return { workflow_runs: runs.length ? [runs[i]] : [] }
  }
  const r = await esperarMigration({ sha: 'abc', dono: 'o', repo: 'r', consulta, dorme: async (ms: number) => { t += ms }, agora: () => t })
  return { r, consultasRuns }
}

async function main() {
  const a = await cenario(['src/x.tsx'], [])
  ok(/sem migration/.test(a.r) && a.consultasRuns === 0, 'commit sem migration: não espera nem consulta o run')
  const b = await cenario(['supabase/migrations/20261015120030_x.sql'], [{ status: 'queued' }, { status: 'in_progress' }, { status: 'completed', conclusion: 'success' }])
  ok(/success/.test(b.r) && b.consultasRuns === 3, 'commit com migration: espera o deploy-migrations terminar')
  const c = await cenario(['supabase/migrations/20261015120030_x.sql'], [{ status: 'completed', conclusion: 'failure' }])
  ok(/failure/.test(c.r), 'deploy-migrations vermelho: libera o build (a main já fica vermelha/avisada pelo workflow)')
  const d = await cenario(['supabase/migrations/20261015120030_x.sql'], [])
  ok(/teto/.test(d.r), 'run nunca aparece: respeita o teto e builda (falha segura)')
  if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
}
main()
