// Gate (chamado #6698): obter não pode ler `v_apr.id` sem atribuir o record (erro "record is not assigned yet" com rascunho). Estático.
import { readFileSync } from 'node:fs'
const sql = readFileSync('supabase/migrations/20261104190030_revenda_perfil_fiscal_obter_rascunho_fix.sql', 'utf8')
const ok = /SELECT \* INTO v_apr FROM veic_perfil_fiscal WHERE false;/.test(sql) && sql.indexOf('WHERE false') < sql.indexOf("'aprovado', CASE WHEN v_apr.id IS NULL")
if (!ok) { console.error('✗ v_apr precisa ser atribuído antes do CASE'); process.exit(1) }
console.log('✓ v_apr atribuído antes de ser lido')
