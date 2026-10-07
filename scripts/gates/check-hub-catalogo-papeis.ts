// Gate (Hub · catálogo de 10 papéis, decisão CEO 06/10): migration aditiva e idempotente; nenhum papel recebe
// folha/custo-hora (#2031); quem monta o orçamento não aprova; campo/encarregado sem valores. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261007120005_hub_catalogo_papeis_projetos.sql', 'utf8').replace(/--[^\n]*/g, '')
const papeis = [...sql.matchAll(/\('(hub_[a-z_]+)','hub','/g)].map(m => m[1])
const acessos = [...sql.matchAll(/\('(hub_[a-z_]+)','(hub_[a-z_]+)','(ver|filtrar|editar|aprovar)'\)/g)].map(m => ({ p: m[1], s: m[2], n: m[3] }))

ok(papeis.length === 10 && new Set(papeis).size === 10, 'catálogo com exatamente 10 papéis hub_*')
ok(acessos.every(a => papeis.includes(a.p)), 'todo acesso pertence a um papel do catálogo')
ok(!/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sql), 'aditivo: sem UPDATE/DELETE/DROP')
ok((sql.match(/ON CONFLICT \(slug\) DO NOTHING/g) ?? []).length === 1 && (sql.match(/ON CONFLICT \(papel_slug, subgrupo\) DO NOTHING/g) ?? []).length === 1, 'idempotente (ON CONFLICT DO NOTHING nos dois INSERT)')
ok(!acessos.some(a => /folha|custo_hora/.test(a.s)), 'nenhum papel recebe folha/custo-hora (só com direito próprio, #2031)')
ok(!acessos.some(a => a.p === 'hub_comercial' && a.s === 'hub_orcamentos' && a.n === 'aprovar'), 'comercial monta o orçamento mas não aprova (alçada)')
const dinheiro = ['hub_financeiro_obra', 'hub_orcamentos']
ok(!acessos.some(a => ['hub_encarregado', 'hub_equipe_campo', 'hub_terceiro', 'hub_cliente'].includes(a.p) && dinheiro.includes(a.s)), 'encarregado, equipe de campo, terceiro e cliente não veem valores')
ok(!acessos.some(a => a.p === 'hub_compras' && dinheiro.includes(a.s)), 'compras sem receita nem margem')
ok(acessos.filter(a => a.p === 'hub_comercial' && a.s === 'hub_financeiro_obra').every(a => a.n === 'filtrar'), 'comercial só a própria comissão (filtrar)')
ok(papeis.every(p => acessos.some(a => a.p === p)), 'todo papel tem ao menos um acesso')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
