// Gate (chamado #6698 Alliance): o obter falhava com rascunho existente (sql_state 55000, record v_apr não atribuído).
// A 2ª correção (v2) não pode citar v_apr fora do ramo em que ele é atribuído. Estático, sem rede.
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_revenda_perfil_fiscal_obter_rascunho_v2.sql'))
ok(arq.length === 1, 'existe a migration v2 do obter com rascunho')
const sql = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8').replace(/--.*$/gm, '')
ok(sql.includes('v_apr_j jsonb') && sql.includes('v_apr_j := ('), 'o JSON do aprovado é montado em variável jsonb dentro do ramo')
ok(sql.includes("'aprovado', v_apr_j"), 'o RETURN usa v_apr_j, não o record')
const ret = sql.slice(sql.indexOf('RETURN jsonb_build_object(\'ok\', true'))
ok(!/v_apr\b(?!_)/.test(ret), 'o RETURN final não cita o record v_apr')
ok(sql.includes('REVOKE ALL ON FUNCTION public.fn_veic_perfil_fiscal_obter(uuid) FROM PUBLIC, anon'), 'REVOKE de anon mantido')

if (falhas) process.exit(1)
