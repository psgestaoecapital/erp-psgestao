// Gate · job do GitHub do painel Codes: função só service_role, workflow a cada 15 min, só leitura.
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261014180005_dev_codes_snapshot_github.sql', 'utf8')
const wf = readFileSync('.github/workflows/codes-snapshot-github.yml', 'utf8')
const falhas: string[] = []
const exige = (ok: boolean, m: string) => { if (!ok) falhas.push(m) }
exige(/REVOKE ALL ON FUNCTION public\.fn_dev_codes_snapshot_github\(text, text, numeric\) FROM PUBLIC, anon, authenticated/.test(sql), 'REVOKE da função')
exige(/GRANT EXECUTE ON FUNCTION public\.fn_dev_codes_snapshot_github\(text, text, numeric\) TO service_role/.test(sql), 'GRANT só service_role')
exige(!/CREATE TABLE/i.test(sql), 'sem tabela nova')
exige(/\*\/15 \* \* \* \*/.test(wf), 'agenda a cada 15 min')
exige(/contents: read/.test(wf) && !/contents: write/.test(wf), 'workflow só leitura')
if (falhas.length) { console.error('check-codes-snapshot-github FALHOU:', falhas.join('; ')); process.exit(1) }
console.log('check-codes-snapshot-github ok')
