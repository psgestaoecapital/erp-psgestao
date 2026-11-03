// Gate (chamado #6698 Alliance): com rascunho, fn_veic_perfil_fiscal_obter não pode referenciar v_apr sem atribuí-lo (55000).
import { readFileSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const sql = readFileSync('supabase/migrations/20261104190030_revenda_perfil_fiscal_obter_rascunho_fix.sql', 'utf8')
const i = sql.indexOf('v_vig := fn_veic_perfil_fiscal_vigente')
ok(/SELECT \* INTO v_apr FROM veic_perfil_fiscal WHERE false;/.test(sql.slice(0, i)), 'v_apr é inicializado antes de qualquer uso')
ok(sql.includes("'aprovado', CASE WHEN v_apr.id IS NULL"), 'mantém o bloco aprovado')
ok(/REVOKE ALL ON FUNCTION public\.fn_veic_perfil_fiscal_obter\(uuid\) FROM PUBLIC, anon/.test(sql), 'REVOKE de anon')
if (falhas) process.exit(1)
