// Gate (chamado #6698): obter com rascunho existente falhava (55000, record v_apr não atribuído). Estático, sem rede.
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_revenda_perfil_fiscal_obter_record_init.sql'))
ok(arq.length === 1, 'existe a migration que inicializa os records')
const sql = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8').replace(/--.*$/gm, '')
const ini = sql.indexOf('SELECT * INTO v_apr FROM veic_perfil_fiscal WHERE false')
const cond = sql.indexOf('IF FOUND THEN')
ok(ini > 0 && ini < cond, 'v_apr é atribuído (vazio) antes de qualquer IF')
ok(/SELECT \* INTO v_edit FROM veic_perfil_fiscal WHERE false/.test(sql), 'v_edit também é inicializado')
ok(sql.includes('SECURITY DEFINER') && sql.includes("SET search_path TO 'public'"), 'mantém SECURITY DEFINER com search_path')
if (falhas) process.exit(1)
