// Gate · Catálogo de papéis do Hub (CEO 06/10 + RH 07/10) — estático, sem rede.
// 11 papéis vertical 'hub', idempotente, nenhum papel com folha/custo-hora, comercial não aprova orçamento, RH no direito de salário.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const sql = readFileSync('supabase/migrations/20261007150005_hub_catalogo_papeis_rh.sql', 'utf8')
const papeis = [...sql.matchAll(/\('(hub_[a-z_]+)','hub','/g)].map(m => m[1])
ok(papeis.length === 11 && new Set(papeis).size === 11, '11 papéis distintos na vertical hub')
ok(/ON CONFLICT \(slug\) DO NOTHING/.test(sql) && /ON CONFLICT \(papel_slug, subgrupo\) DO NOTHING/.test(sql), 'inserts idempotentes')
ok(!/\b(DELETE|DROP|TRUNCATE)\b/i.test(sql) && !/\bUPDATE\b\s+public\./i.test(sql), 'aditivo: sem DELETE/DROP/UPDATE de dado')
ok(!/'(folha|custo_hora)'/.test(sql.replace(/^--.*$/gm, '')), 'nenhum papel recebe folha/custo-hora no catálogo (#2031)')
ok(!/\('hub_comercial','hub_orcamentos','aprovar'\)/.test(sql), 'comercial monta orçamento e não aprova')
ok(/'acesso_total', 'rh_industrial', 'hub_rh'\)\)/.test(sql) && /SECURITY DEFINER/.test(sql) && /SET search_path TO 'public'/.test(sql), 'RH entra na regra de salário preservando SECURITY DEFINER e search_path')
ok(/hub_rh','hub_mao_obra'/.test(sql) && !/hub_rh','hub_financeiro'/.test(sql), 'RH vê Mão de obra e não o financeiro das obras')
ok(/20261007150005/.test('20261007150005') && /^2026\d{8}05_/.test('20261007150005_'), 'faixa de migration 05')
if (falhas) process.exit(1)
