// Gate (30/09 · deploy-migrations vermelho no merge da #1949): com `version: latest`, o supabase/setup-cli pergunta à API
// do GitHub qual é a última versão; os runners dividem o limite de chamadas sem token e o passo caiu com "rate limit
// exceeded" antes de qualquer migration. Com versão fixa o download vai direto ao release, sem API. Roda no build, sem rede:
// todo workflow que usa supabase/setup-cli tem a versão fixa (x.y.z). Trocar de versão = editar os workflows juntos.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const DIR = '.github/workflows'
let usos = 0
for (const f of readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n))) {
  const linhas = readFileSync(join(DIR, f), 'utf8').split('\n')
  linhas.forEach((l, i) => {
    if (!/uses:\s*supabase\/setup-cli@/.test(l)) return
    usos++
    // o `with:` do passo vem logo abaixo; procura `version:` até o próximo passo
    let versao: string | null = null
    for (let j = i + 1; j < linhas.length && !/^\s*- /.test(linhas[j]); j++) {
      const m = linhas[j].match(/^\s*version:\s*['"]?([^'"\s]+)/)
      if (m) { versao = m[1]; break }
    }
    ok(!!versao && /^\d+\.\d+\.\d+$/.test(versao), `${f}:${i + 1} setup-cli com versão fixa (achou: ${versao ?? 'nenhuma'})`)
  })
}
ok(usos >= 3, `os workflows com supabase/setup-cli foram encontrados (${usos}: deploy-migrations, deploy-functions, repair)`)

if (falhas) { console.error(`\n${falhas} falha(s): supabase/setup-cli sem versão fixa`); process.exit(1) }
console.log('\nSupabase CLI com versão fixa: ok')
