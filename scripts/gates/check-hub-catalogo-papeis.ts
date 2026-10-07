// Gate · Hub — catálogo de 11 papéis (vertical hub) + RH na regra de salário da Mão de obra (CEO 06/10). Sem rede.
import { readFileSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const sql = readFileSync('supabase/migrations/20261007150005_hub_catalogo_papeis_e_rh.sql', 'utf8')
const sem = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
const papeis = [...sem.matchAll(/\('(hub_[a-z_]+)','hub'/g)].map(m => m[1])
ok(papeis.length === 11 && new Set(papeis).size === 11, '11 papéis hub distintos')
ok(!/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sem), 'aditivo: sem UPDATE/DELETE/DROP')
ok((sem.match(/ON CONFLICT/g) ?? []).length === 2, 'inserts idempotentes')
ok(!/'(folha|custo_hora)'/.test(sem), 'nenhum papel recebe folha/custo_hora (#2031)')
const acesso = [...sem.matchAll(/\('(hub_[a-z_]+)','([a-z_]+)','(ver|filtrar|editar|aprovar)'\)/g)].map(m => ({ p: m[1], s: m[2], n: m[3] }))
const de = (p: string) => acesso.filter(a => a.p === p)
ok(papeis.every(p => de(p).length > 0), 'todo papel tem acesso')
ok(!de('hub_comercial').some(a => a.n === 'aprovar'), 'comercial monta e não aprova')
for (const p of ['hub_encarregado', 'hub_equipe_campo', 'hub_terceiro', 'hub_cliente'])
  ok(!de(p).some(a => a.s === 'hub_financeiro' || a.s === 'ge_financeiro'), `${p} não vê valores`)
ok(de('hub_comercial').some(a => a.s === 'ge_financeiro' && a.n === 'filtrar'), 'comercial vê só a própria comissão')
ok(!de('hub_compras').some(a => a.s === 'hub_financeiro'), 'compras sem receita/margem')
ok(!de('hub_rh').some(a => a.s === 'hub_financeiro' || a.s === 'ge_financeiro'), 'RH sem financeiro geral nem margem')
ok(/'rh', 'rh_industrial'\)\)/.test(sem) && /'acesso_total'/.test(sem) && /SECURITY DEFINER/.test(sem) && /search_path TO 'public'/.test(sem), 'função de salário: RH incluído, lista antiga e SECURITY DEFINER preservados')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
