// Gate (Eng. Chefe 14/10): deploy-migrations tenta o `supabase link` de novo e avisa (issue) se falhar de vez.
import { readFileSync } from 'node:fs'
const s = readFileSync('.github/workflows/deploy-migrations.yml', 'utf8')
let falhas = 0
const ok = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FALHA'} ${m}`); if (!c) falhas++ }
ok(/for i in 1 2 3 4/.test(s) && /sleep/.test(s), 'supabase link tem retry com recuo')
ok(!/^\s*- run: supabase link/m.test(s), 'link não roda sem retry')
ok(/if: failure\(\)/.test(s) && /gh issue/.test(s), 'falha do deploy abre/atualiza issue de aviso')
ok(/issues: write/.test(s), 'permissão issues: write')
if (falhas) process.exit(1)
