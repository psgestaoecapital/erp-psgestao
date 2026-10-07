// Gate (Hub · catálogo de 11 papéis, CEO 06/10): vertical 'hub', mesmo modelo da #2057. Estático, sem rede.
// Regras: folha/custo-hora só em Sócio e RH (#2031); campo/encarregado sem valores; comercial não aprova o que monta;
// migration aditiva (sem DELETE/UPDATE/DROP) e RH entra na regra de salário da Mão de obra.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261007140005_hub_catalogo_papeis_projetos.sql', 'utf8').replace(/--[^\n]*/g, '')
const papeis = [...sql.matchAll(/\('(hub_[a-z_]+)','hub','/g)].map((m) => m[1])
ok(papeis.length === 11 && new Set(papeis).size === 11, `11 papéis distintos na vertical hub (${papeis.length})`)

const acessos = [...sql.matchAll(/\('(hub_[a-z_]+)','([a-z_]+)','(ver|filtrar|editar|aprovar)'\)/g)].map((m) => ({ p: m[1], s: m[2], n: m[3] }))
ok(acessos.every((a) => papeis.includes(a.p)), 'todo acesso aponta para um papel do catálogo')
const comFolha = [...new Set(acessos.filter((a) => a.s === 'hub_folha').map((a) => a.p))].sort()
ok(comFolha.join() === 'hub_rh,hub_socio', `folha/custo-hora só em Sócio e RH (#2031): ${comFolha.join(', ')}`)
for (const p of ['hub_encarregado', 'hub_equipe_campo', 'hub_terceiro', 'hub_cliente', 'hub_compras']) {
  ok(!acessos.some((a) => a.p === p && ['hub_resultado', 'hub_folha', 'ge_financeiro'].includes(a.s)), `${p} não vê resultado, folha nem financeiro`)
}
ok(!acessos.some((a) => a.p === 'hub_engenheiro' && ['hub_resultado', 'hub_folha', 'ge_financeiro'].includes(a.s)), 'engenheiro sem margem da empresa, folha nem GE')
ok(acessos.find((a) => a.p === 'hub_comercial' && a.s === 'hub_orcamentos')?.n === 'editar', 'comercial monta o orçamento mas não aprova (alçada)')
ok(acessos.find((a) => a.p === 'hub_comercial' && a.s === 'ge_financeiro')?.n === 'filtrar', 'comercial vê só a própria comissão')
ok(!acessos.some((a) => a.p === 'hub_rh' && ['ge_financeiro', 'hub_resultado'].includes(a.s)), 'RH sem financeiro geral nem margem das obras')
ok(!/\b(DELETE|DROP|TRUNCATE|UPDATE)\b/i.test(sql.replace(/FOR UPDATE/gi, '')), 'aditivo: sem DELETE/DROP/TRUNCATE/UPDATE')
ok((sql.match(/ON CONFLICT \(/g) || []).length === 2, 'inserts idempotentes (ON CONFLICT)')
const fn = sql.slice(sql.indexOf('FUNCTION public.fn__mao_obra_pode_ver_individual'))
ok(/'rh_industrial'/.test(fn) && /'hub_rh'/.test(fn), 'RH (rh_industrial, hub_rh) entra na regra de salário da Mão de obra')
ok(['owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total'].every((r) => fn.includes(`'${r}'`)), 'roles anteriores preservados')
ok(/SECURITY DEFINER/.test(fn) && /search_path TO 'public'/.test(fn), 'função mantém SECURITY DEFINER + search_path')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nhub-catalogo-papeis: OK')
