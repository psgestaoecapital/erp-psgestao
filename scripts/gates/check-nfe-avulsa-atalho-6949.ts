/**
 * Gate (#3861 complemento): atalho 6.949 na NF-e avulsa e renome do 5.949 ("Garantia" → "Outras saídas ou Simples remessa").
 * Estático: lê a migration que cadastra o atalho novo, o CFOP 6.949 no catálogo e o novo nome.
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const mig = readFileSync('supabase/migrations/20261031020020_fiscal_nfe_avulsa_atalho_6949.sql', 'utf8')
ok(/SET nome = 'Outras saídas ou Simples remessa'/.test(mig) && /cfop_dentro = '5949'/.test(mig), '5.949 renomeado de "Garantia"')
ok(/INSERT INTO public\.erp_fiscal_remessa_tipos[\s\S]*fora do estado[\s\S]*'6949', '6949'/.test(mig), 'atalho 6.949 (fora do estado) cadastrado')
ok(/INSERT INTO public\.erp_fiscal_cfop_saida[\s\S]*\('6949'/.test(mig), '6.949 no catálogo de CFOP (a busca acha os dois)')
ok(!/DELETE|DROP|TRUNCATE/i.test(mig), 'migration aditiva (sem DELETE/DROP/TRUNCATE)')

if (falhas) { console.error(`\n[check-nfe-avulsa-atalho-6949] ${falhas} falha(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-nfe-avulsa-atalho-6949] atalho 6.949 conferido.')
