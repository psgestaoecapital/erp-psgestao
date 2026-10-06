// Gate (3): patch-id do CONTEÚDO da PR (sem a base) e checagem da autorização.
//   tsx scripts/merge/patch-id.ts <base> <head>             → imprime o patch-id (o revisor cola no comentário)
//   tsx scripts/merge/patch-id.ts <base> <head> --pr N      → confere o comentário do revisor (exit 0 = autorizada)
import { execSync } from 'node:child_process'
import { gh } from './gh'
import { autorizada, type Comentario } from './lib'

export function patchId(base: string, head: string): string {
  const out = execSync(`git diff ${base}...${head} | git patch-id --stable`, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  const id = out.trim().split(/\s+/)[0]
  if (!/^[0-9a-f]{40}$/.test(id)) throw new Error('diff vazio ou patch-id inválido')
  return id
}
async function main() {
  const [base, head] = process.argv.slice(2)
  const id = patchId(base, head)
  const i = process.argv.indexOf('--pr')
  if (i < 0) { console.log(id); return 0 }
  const pr = Number(process.argv[i + 1])
  const autorizadores = (process.env.FILA_AUTORIZADORES ?? 'psgestaoecapital').split(',').map((s) => s.trim())
  const cs = (await gh<any[]>(`issues/${pr}/comments?per_page=100`)).data.map((c): Comentario => ({ login: c.user.login, body: c.body ?? '', created_at: c.created_at }))
  const r = autorizada(pr, id, cs, autorizadores)
  console.log(`#${pr} patch-id ${id.slice(0, 8)}: ${r.ok ? 'AUTORIZADA' : 'NÃO'} — ${r.motivo}`)
  return r.ok ? 0 : 1
}
if (process.argv[1]?.endsWith('patch-id.ts')) main().then((c) => process.exit(c), (e) => { console.error(String(e.message ?? e)); process.exit(1) })
