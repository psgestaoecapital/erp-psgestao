// Gate #4909: o retorno CNAB grava origem 'retorno_cnab' e a tela marca a remessa como retorno importado. Estático.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const mig = readdirSync('supabase/migrations').filter((f) => f.includes('retorno_cnab_origem_e_marca_remessa'))
ok(mig.length === 1, 'migration do #4909 existe')
const sql = readFileSync(`supabase/migrations/${mig[0]}`, 'utf8')
ok(/fn_pagar_valor_pago_guard[\s\S]*'retorno_cnab'[\s\S]*'trigger_guarda'/.test(sql), 'guarda deriva retorno_cnab da forma cnab')
ok(/fn_remessa_retorno_marcar[\s\S]*get_user_company_ids\(\)/.test(sql), 'marcar remessa tem guarda de empresa')
ok(/REVOKE ALL ON FUNCTION public\.fn_remessa_retorno_marcar[^;]*anon/.test(sql), 'marcar remessa sem EXECUTE para anon')
const pg = readFileSync('src/app/dashboard/financeiro/remessa-pagamento/page.tsx', 'utf8')
ok(pg.includes("rpc('fn_remessa_retorno_marcar'"), 'tela chama fn_remessa_retorno_marcar depois de confirmar')
if (falhas) process.exit(1)
