// Gate · agency_equipe precisa de policy por empresa (RLS ligada sem policy = tela de Equipe vazia). Sem rede.
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const dir = 'supabase/migrations'
const sql = readdirSync(dir).filter(f => f.endsWith('.sql')).map(f => readFileSync(`${dir}/${f}`, 'utf8')).join('\n')
const policy = /CREATE POLICY\s+\w+\s+ON\s+public\.agency_equipe\s+FOR ALL\s+USING\s*\(([\s\S]*?)\)\s*WITH CHECK\s*\(([\s\S]*?)\);/i.exec(sql)

ok(!!policy, 'existe CREATE POLICY ... ON public.agency_equipe FOR ALL com USING e WITH CHECK')
ok(!!policy && /get_user_company_ids\(\)/.test(policy[1]) && /get_user_company_ids\(\)/.test(policy[2]), 'USING e WITH CHECK escopam por get_user_company_ids()')
ok(/ALTER TABLE public\.agency_equipe ENABLE ROW LEVEL SECURITY/i.test(sql), 'RLS segue ligada')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK')
