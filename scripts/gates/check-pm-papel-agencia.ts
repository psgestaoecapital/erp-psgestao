// Gate: "Papel na agência" (P&M) — a migration não pode tirar acesso nem aplicar nada sozinha.
import { readFileSync } from 'node:fs'

const falhas: string[] = []
const ok = (c: boolean, m: string) => { if (!c) falhas.push(m) }
const mig = readFileSync('supabase/migrations/20261007153005_pm_papel_agencia_aplicar.sql', 'utf8')
const sem = mig.replace(/--.*$/gm, '')
ok(/fn_nr36_pode_subir[\s\S]*vertical = 'pm'/.test(sem), 'guarda do NR-36 preserva quem recebe papel da agência')
ok(!/\bDELETE\b|\bTRUNCATE\b|DROP\s+(TABLE|POLICY)/i.test(sem), 'sem DELETE/TRUNCATE/DROP')
ok(!/INSERT INTO public\.user_scope[\s\S]*VALUES \('[0-9a-f-]{36}'/.test(sem) && !/email\s*=\s*'/.test(sem), 'nada aplicado a ninguém na migration')
for (const f of ['listar', 'simular', 'definir']) {
  ok(sem.includes(`fn_pm_papel_agencia_${f}`), `função ${f}`)
}
ok((sem.match(/fn_acessos_pode_gerir/g) ?? []).length >= 3, 'as 3 funções exigem fn_acessos_pode_gerir')
ok(/REVOKE ALL ON FUNCTION public\.fn_pm_papel_agencia_definir[\s\S]*FROM PUBLIC, anon/.test(sem), 'REVOKE de anon')
ok(/vertical = 'pm'/.test(sem) && /outra área/.test(sem), 'não sobrescreve papel de outra vertical')
const tela = readFileSync('src/app/dashboard/pm/equipe/papel/page.tsx', 'utf8')
ok(tela.includes('fn_pm_papel_agencia_simular') && tela.includes('papel-antes-depois'), 'tela mostra antes/depois antes de gravar')
if (falhas.length) { console.error('✗ check-pm-papel-agencia:\n - ' + falhas.join('\n - ')); process.exit(1) }
console.log('✓ check-pm-papel-agencia')
