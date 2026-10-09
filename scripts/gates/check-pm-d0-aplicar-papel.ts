// Gate: P&M D0 — aplicar papel da agência (migration só cria funções, com guarda; tela usa as RPCs; resumo antes/depois).
import { readFileSync } from 'node:fs'
import { resumirPrevia } from '../../src/lib/pm/papelAgencia'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (!c) falhas.push(m) }
const mig = readFileSync('supabase/migrations/20261007170005_pm_d0_aplicar_papel_agencia.sql', 'utf8')
ok(mig.includes('fn_acessos_pode_gerir'), 'guarda de gestão de acessos')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_papel_agencia_aplicar[^;]*anon/.test(mig), 'REVOKE anon na aplicar')
ok(!/\bDELETE\b|\bTRUNCATE\b/i.test(mig.replace(/--.*$/gm, '')), 'sem DELETE/TRUNCATE')
ok(/vertical = 'pm'/.test(mig), 'só papéis da vertical pm')
ok(!/INSERT INTO user_scope[^;]*dominios[^;]*DO UPDATE SET[^;]*dominios/s.test(mig), 'upsert não reescreve dominios')
const pg = readFileSync('src/app/dashboard/pm/equipe/page.tsx', 'utf8')
ok(pg.includes('fn_pm_papel_agencia_previa') && pg.includes('fn_pm_papel_agencia_aplicar'), 'tela usa previa e aplicar')
const l = resumirPrevia({ ok: true, antes: { papel_gestao: 'CLIENT_MANAGER', decidido: null }, depois: { papel_slug: 'pm_socio', teto: 'aprovar', acessos_do_papel: { pm_producao: 'aprovar' } }, cria_no_raiz: true })
ok(l.length === 4 && l[0].includes('CLIENT_MANAGER') && l[1].includes('nenhum → pm_socio'), 'resumo antes/depois')
ok(resumirPrevia({ ok: false, erro: 'x' })[0] === 'x', 'resumo de erro')
if (falhas.length) { console.error('✗ check-pm-d0-aplicar-papel:\n - ' + falhas.join('\n - ')); process.exit(1) }
console.log('✓ check-pm-d0-aplicar-papel')
