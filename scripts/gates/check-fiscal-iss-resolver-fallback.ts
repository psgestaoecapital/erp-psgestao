// Gate (#9427 FC Pisos · PR-A): fn_fiscal_iss_resolver usa a tabela GLOBAL nacional
// (fiscal_iss_municipio_aliquota) como FALLBACK, com manual tendo prioridade, e a nacional
// SÓ entra quando status_validacao='validada' E aliquota preenchida. A carga inicial (worklist)
// dos municípios da FC Pisos entra como 'sem_fonte_oficial' SEM alíquota (RD-38: não inventar).
// Estático, sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// Resolve a migration pelo SUFIXO (a fila de merge pode renumerar o prefixo de 14 dígitos).
const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => f.endsWith('_fiscal_iss_resolver_global_fallback_seed_fcpisos_9427.sql')).sort().pop()
if (!arq) { console.error('✗ migration *_fiscal_iss_resolver_global_fallback_seed_fcpisos_9427.sql não encontrada'); process.exit(1) }
const sql = readFileSync(`${dir}/${arq}`, 'utf8')

ok(sql.includes('CREATE OR REPLACE FUNCTION public.fn_fiscal_iss_resolver'), 'resolver recriado')
ok(sql.includes('p_company_id IN (SELECT get_user_company_ids()) OR is_admin()'), 'guard de tenant mantido')
// manual continua sendo consultado primeiro (prioridade)
ok(/FROM fiscal_iss_municipio m\b/.test(sql), 'consulta o cadastro manual (fiscal_iss_municipio)')
ok(sql.includes('(m.company_id = p_company_id OR m.company_id IS NULL)'), 'precedência manual empresa > global')
// fallback nacional SÓ validada + alíquota preenchida
ok(/FROM fiscal_iss_municipio_aliquota a\b/.test(sql), 'fallback para a tabela nacional')
ok(sql.includes("a.status_validacao = 'validada'"), 'nacional só quando validada')
ok(sql.includes('a.aliquota IS NOT NULL'), 'nacional só com alíquota preenchida')
// granularidade 07.05 (pai) x 07.05.01/02 (subitem): casa exato E agrega subitens do pai de 2 níveis
ok(sql.includes('a.codigo_lc116 = v_lc'), 'casa o subitem exato quando informado')
ok(sql.includes("v_lc ~ '^[0-9]{2}"), 'detecta código "pai" de 2 níveis (ex.: 07.05)')
ok(sql.includes("a.codigo_lc116 LIKE v_lc || '.%'"), 'agrega os subitens do pai (07.05.%)')
ok(sql.includes('count(DISTINCT a.aliquota)'), 'conta alíquotas distintas entre os subitens')
ok(sql.includes("'nacional_agregado'"), 'alíquota única -> usa (origem nacional_agregado)')
ok(sql.includes("'subitem_necessario'"), 'alíquotas divergentes -> ok:false pedindo o subitem (não chuta)')
// o manual é retornado ANTES do fallback nacional (IF FOUND ... antes do SELECT da nacional)
ok(sql.indexOf('FROM fiscal_iss_municipio m') < sql.indexOf('FROM fiscal_iss_municipio_aliquota a'), 'manual é resolvido antes da nacional')
// relaxamento aditivo p/ representar "sem fonte" sem alíquota inventada
ok(/ALTER COLUMN aliquota DROP NOT NULL/.test(sql), 'aliquota aceita NULL (sem fonte)')
ok(/ALTER COLUMN fonte\s+DROP NOT NULL/.test(sql), 'fonte aceita NULL (sem fonte)')
// seed worklist: sem_fonte_oficial, SEM alíquota, idempotente (NOT EXISTS), 07.05.01 e 07.05.02
ok(sql.includes("'sem_fonte_oficial'"), 'seed marca status sem_fonte_oficial')
ok(/SELECT ibge, sub, NULL, NULL, NULL/.test(sql), 'seed NÃO grava alíquota (RD-38: não inventar)')
ok(sql.includes('WHERE NOT EXISTS'), 'seed idempotente (NOT EXISTS por município × subitem)')
ok(sql.includes("'07.05.01'") && sql.includes("'07.05.02'"), 'subitens 07.05.01 e 07.05.02')
// os 4 IBGE resolvidos dos municípios sem código no cadastro
for (const ibge of ['4111209', '4125209', '4206702', '3515202']) {
  ok(sql.includes(`'${ibge}'`), `IBGE resolvido ${ibge} presente no seed`)
}

if (falhas) process.exit(1)
console.log('check-fiscal-iss-resolver-fallback OK')
