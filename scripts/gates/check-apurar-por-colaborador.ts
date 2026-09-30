/**
 * Gate de build (Frioeste · decisões do CEO 29/09): reapurar UM colaborador não pode reapurar a data inteira de todos
 * (a reapuração geral fica para o fechamento de outubro). Confere a migration e que a releitura da Conferência usa o cpf.
 *   tsx scripts/check-apurar-por-colaborador.ts
 */
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const mig = readdirSync('supabase/migrations').find(f => f.includes('nr36_apurar_por_colaborador'))
const sql = mig ? readFileSync(`supabase/migrations/${mig}`, 'utf8') : ''
ok(!!mig, 'migration de apuração por colaborador presente')
ok(sql.includes('p_cpf text DEFAULT NULL::text'), 'fn_nr36_apurar ganha p_cpf opcional (as chamadas de 3 argumentos seguem valendo)')
ok(sql.includes('AND (p_cpf IS NULL OR c.cpf = p_cpf)'), 'com p_cpf, só aquele colaborador é apurado')
ok(sql.includes("'fn_nr36_apurar(p_company_id, p_data, p_data, p_cpf)'"), 'a releitura da Conferência reapura só o colaborador relido')
ok(/REVOKE ALL ON FUNCTION public\.fn_nr36_apurar\(uuid, date, date, text\) FROM PUBLIC, anon/.test(sql), 'permissões da nova assinatura (sem anon)')
// a tela chama com 3 argumentos nomeados — continua resolvendo pela assinatura nova com default
const pagina = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/rpc\('fn_nr36_apurar', \{ p_company_id: companyId, p_dt_ini: ini, p_dt_fim: fim \}\)/.test(pagina), 'o botão Reapurar da tela segue reapurando o período inteiro (sem p_cpf)')

if (falhas) { console.error(`\n[check-apurar-por-colaborador] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-apurar-por-colaborador] apuração por colaborador conferida.')
