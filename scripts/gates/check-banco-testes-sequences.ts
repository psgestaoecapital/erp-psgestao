// Gate (Eng. Chefe 14/10) — depois de copiar linhas COM id da produção para o banco de testes, as sequences precisam ser
// acertadas (setval = max), senão a próxima inserção colide ("duplicate key screen_route_features_pkey"). Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')
const SQL = 'scripts/banco-testes/acertar-sequences.sql'

const sql = ler(SQL).replace(/--[^\n]*/g, '')
ok(/setval\(/.test(sql) && /pg_sequences/.test(sql) && /max\(/.test(sql), 'sql: setval(seq, max(coluna)) só quando max >= last_value (nunca recua)')
ok(/relnamespace = 'public'::regnamespace/.test(sql), 'sql: só sequences do schema public')

const dir = 'scripts/banco-testes/'
const copiam = readdirSync(dir).filter((f) => f.endsWith('.sh') && /\\?copy\s+public\.[^\n]*FROM/i.test(ler(dir + f)))
ok(copiam.includes('catalogos.sh'), `scripts que carregam linhas: ${copiam.join(', ') || '—'}`)
for (const f of ['catalogos.sh', 'reconciliar-vaga.sh']) {
  ok(/acertar-sequences\.sql/.test(ler(dir + f)), `${f}: acerta as sequences no banco de testes`)
}
// qualquer script que carregue linhas com id explícito (\copy ... FROM / COPY ... FROM) precisa acertar a sequence depois
for (const f of copiam) {
  ok(/acertar-sequences\.sql/.test(ler(dir + f)), `${f}: copia linhas e acerta as sequences depois`)
}
const cat = ler(dir + 'catalogos.sh')
ok(cat.indexOf('acertar-sequences.sql') > cat.indexOf('carga.sql"'), 'catalogos.sh: acerto das sequences vem depois da carga')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam`); process.exit(1) }
console.log('\ncheck-banco-testes-sequences: ok')
