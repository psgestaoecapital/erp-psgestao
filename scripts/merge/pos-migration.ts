// Gate (1): a última migration da main teve run VERDE do @pos-migration? Cancelado = re-roda via REST.
//   tsx scripts/merge/pos-migration.ts            (decide e, se for o caso, re-roda; sai 0 = liberado, 2 = aguardar/re-rodando, 1 = vermelho)
//   tsx scripts/merge/pos-migration.ts --so-ver   (só decide, não re-roda)
import { gh } from './gh'
import { decidirPosMigration, type Run } from './lib'

async function main() {
  const soVer = process.argv.includes('--so-ver')
  const ult = (await gh<any[]>('commits?sha=main&path=supabase/migrations&per_page=1')).data[0]
  if (!ult) { console.log('liberado: main sem migration'); return 0 }
  const desde = ult.commit.committer.date as string
  const commits = (await gh<any[]>(`commits?sha=main&since=${encodeURIComponent(desde)}&per_page=100`)).data.map((c) => c.sha as string)
  const wf = (await gh<any>('actions/workflows/aceitacao-pos-migration.yml/runs?branch=main&per_page=100')).data
  const runs: Run[] = (wf.workflow_runs as any[]).filter((r) => commits.includes(r.head_sha))
  const d = decidirPosMigration(runs)
  console.log(`última migration da main: ${ult.sha.slice(0, 7)} (${desde}) → ${d.acao}: ${d.motivo}`)
  if (d.acao === 'rerodar' && !soVer) {
    const r = await gh(`actions/runs/${d.runId}/rerun`, { method: 'POST' })
    console.log(`re-run do run ${d.runId}: HTTP ${r.status}`)
    return r.status < 300 ? 2 : 1
  }
  return d.acao === 'liberado' ? 0 : d.acao === 'vermelho' ? 1 : 2
}
main().then((c) => process.exit(c), (e) => { console.error(String(e.message ?? e)); process.exit(1) })
