// Gate (CEO 06/10): catálogo de 11 papéis do Hub (vertical 'hub') — estático, sem rede.
//  · 11 papéis hub_*; nenhum recebe folha/custo_hora (#2031); comercial não aprova o que monta;
//  · migration aditiva (sem UPDATE/DELETE); RH reconhecido em fn__mao_obra_pode_ver_individual com a lista original preservada.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const f = readdirSync('supabase/migrations').find(n => n.endsWith('_hub_catalogo_papeis_obras.sql'))
ok(!!f, 'migration do catálogo do Hub existe')
const sql = readFileSync(`supabase/migrations/${f}`, 'utf8')
const corpo = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
ok(/^\d{8}\d{2}\d{2}05_/.test(f!), 'versão com SEGUNDOS = 05 (faixa gilberto-produto)')
const slugs = [...corpo.matchAll(/\('(hub_[a-z_]+)','hub','/g)].map(m => m[1])
ok(new Set(slugs).size === 11, `11 papéis da vertical hub (achou ${new Set(slugs).size})`)
ok(!/'(folha|custo_hora)'/.test(corpo), 'nenhum papel recebe folha/custo_hora (#2031)')
ok(!/\('hub_comercial','hub_orcamentos','aprovar'\)/.test(corpo), 'comercial monta orçamento e não aprova (alçada)')
ok(!/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(corpo), 'migration aditiva (sem UPDATE/DELETE/DROP)')
ok(/ON CONFLICT \(slug\) DO NOTHING/.test(corpo) && /ON CONFLICT \(papel_slug, subgrupo\) DO NOTHING/.test(corpo), 'idempotente')
for (const r of ['owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total', 'rh', 'rh_industrial'])
  ok(corpo.includes(`'${r}'`), `fn__mao_obra_pode_ver_individual inclui '${r}'`)
if (falhas) process.exit(1)
