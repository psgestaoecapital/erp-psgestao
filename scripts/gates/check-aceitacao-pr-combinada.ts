// Gate (CEO 14/10): a aceitação aplica as migrations da PR COMBINADAS com a main (PR de base antiga não pode dar
// "Remote migration versions not found in local" por faltar migration nova da main).
import { readFileSync } from 'node:fs'

const wf = readFileSync('.github/workflows/aceitacao-pr.yml', 'utf8')
const erros: string[] = []
if (!wf.includes('PR COMBINADA com a main')) erros.push('aceitacao-pr.yml: passo 3 sem a combinação main + migrations da PR')
if (!/cd "\$comb" && supabase db push/.test(wf)) erros.push('aceitacao-pr.yml: db push da PR deve rodar no diretório combinado ($comb)')
if (/3\) aplicando[\s\S]{0,1200}\n\s+if ! supabase db push --include-all --db-url "\$TEST_DATABASE_URL"/.test(wf))
  erros.push('aceitacao-pr.yml: db push direto do checkout da PR (base antiga → falso vermelho)')
if (erros.length) {
  console.error('check-aceitacao-pr-combinada: FALHOU\n - ' + erros.join('\n - '))
  process.exit(1)
}
console.log('check-aceitacao-pr-combinada: ok')
