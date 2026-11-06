// HB0 item 3: nenhum link do Hub aponta para "/dashboard" (cai na home da GE). Volta para o painel do Hub.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const raiz = 'src/app/dashboard/projetos'
const erros: string[] = []
const varrer = (dir: string) => {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { varrer(p); continue }
    if (!/\.tsx?$/.test(n)) continue
    const linhas = readFileSync(p, 'utf8').split('\n')
    linhas.forEach((l, i) => {
      if (/(href=|href:|push\(|replace\()\s*[{(]?\s*['"`]\/dashboard['"`]/.test(l)) {
        erros.push(`${p}:${i + 1}: link para /dashboard leva à GE — use /dashboard/projetos`)
      }
    })
  }
}
varrer(raiz)
if (erros.length) {
  console.error(erros.join('\n'))
  process.exit(1)
}
console.log('check-hub-sem-link-ge: ok')
