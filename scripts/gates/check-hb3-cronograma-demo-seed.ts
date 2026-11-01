// Gate (HB3 fatia 4 · DEMO irrigada do cronograma). Sem rede. A função de seed só age na empresa demo do Hub,
// não tem GRANT a usuário, apaga só dentro da empresa demo e cria tarefas com dependências.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261022110030_hb3_cronograma_demo_seed.sql', 'utf8')
ok(mig.includes("'b0700000-0000-4000-a000-000000000006'"), 'seed fixo na empresa demo do Hub')
ok(/is_demo IS TRUE/.test(mig), 'só age se a empresa é demo')
ok(/REVOKE ALL ON FUNCTION public\.fn_gold_hub_cronograma_seed_reparar\(uuid\) FROM PUBLIC, anon, authenticated/.test(mig), 'sem GRANT a usuário')
ok(!/GRANT EXECUTE/.test(mig), 'nenhum GRANT')
const dels = [...mig.matchAll(/DELETE FROM [\s\S]*?;/g)].map((m) => m[0])
ok(dels.length === 2 && dels.every((d) => /WHERE company_id = c/.test(d)), 'todo DELETE é escopado por company_id da demo')
ok(/INSERT INTO projetos_obra_tarefa_dependencia/.test(mig), 'cria dependências')
ok(/DEMO-OB-002/.test(mig), 'uma obra com dependência violada para a ligação vermelha')

if (falhas) { console.error(`\n${falhas} falha(s) no seed do cronograma`); process.exit(1) }
console.log('\nSeed do cronograma da DEMO: ok')
