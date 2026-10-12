// Gate (Eng. Chefe 12/10, passada completa de semente) — o banco de testes espelha os GRANTs/REVOKEs da produção. Sem rede.
// O teste nasce com "grant all" para anon e o dump não traz os direitos: sem este passo ~40 specs de segurança/LGPD
// @pos-migration ficam vermelhos na aceitacao-main por esquema (não por regressão). Garante que o passo existe, roda
// ANTES da semente demo, só lê catálogo da produção e repete as travas de origem/destino.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

const sh = ler('scripts/banco-testes/espelhar-grants.sh')
const sql = ler('scripts/banco-testes/espelhar-grants.sql')
const wf = ler('.github/workflows/montar-banco-testes.yml')

ok(/\*"\$PROD_REF"\*\) erro "TEST_DATABASE_URL aponta para a PRODUÇÃO/.test(sh), 'script: recusa a produção como destino')
ok(/\*"\$TEST_REF"\*\) erro "PROD_DATABASE_URL aponta para o banco de testes/.test(sh), 'script: recusa o banco de testes como origem')
ok(/SET statement_timeout='30s'/.test(sh), 'script: leitura da produção com statement_timeout curto')
ok(!/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(sql.replace(/--[^\n]*/g, '')), 'sql de origem: só SELECT no catálogo (nenhum comando de escrita)')
ok(/pg_class/.test(sql) && /pg_proc/.test(sql) && /pg_attribute/.test(sql) && /pg_namespace/.test(sql), 'sql de origem: schema, relações, colunas e funções')
ok(!/FROM public\./i.test(sql.replace(/--[^\n]*/g, '')), 'sql de origem: não lê tabela de dados do public')
ok(/aclexplode\(t\.attacl\)/.test(sql), 'sql de origem: direito por coluna (LGPD salário/custo) é espelhado')
ok(/proacl IS NULL/.test(sql), 'sql de origem: ACL nula de função = EXECUTE para PUBLIC (padrão do Postgres)')
ok(/EXCEPTION[\s\S]*undefined_function[\s\S]*WHEN OTHERS/.test(sh) && /falhas > 20/.test(sh), 'script: objeto ausente é contado e pulado; falha real passa de 20 derruba o job')
ok(/anon executa \$anon_teste funções no teste/.test(sh), 'script: confere (RD-38) o nº de funções do anon teste × produção')

const iGr = wf.indexOf('scripts/banco-testes/espelhar-grants.sh')
const iSem = wf.indexOf('scripts/banco-testes/semente-demo.sh')
const iCat = wf.indexOf('scripts/banco-testes/catalogos.sh')
ok(iGr > iCat && iCat > 0, 'workflow: o espelho roda depois dos catálogos (PROD_DATABASE_URL já está no GITHUB_ENV)')
ok(iGr > 0 && iGr < iSem, 'workflow: o espelho roda antes da semente demo')
ok(/PSQL=\/usr\/lib\/postgresql\/17\/bin\/psql/.test(wf.slice(iGr - 200, iGr + 50)), 'workflow: usa o cliente pg17 (produção é Postgres 17)')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam`); process.exit(1) }
console.log('\ncheck-banco-testes-grants: ok')
