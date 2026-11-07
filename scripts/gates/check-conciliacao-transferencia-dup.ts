// Chamado Proplay (e1bab4dc): desvincular transferência + não duplicar transferência ao conciliar o 2º lado.
import { readFileSync, readdirSync } from 'node:fs'
let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const f = readdirSync('supabase/migrations').find(n => n.includes('conciliacao_transferencia_duplicada_desvincular'))
const sql = f ? readFileSync('supabase/migrations/' + f, 'utf8') : ''
ok(!!f, 'migration existe')
ok(/IN \('pagar','receber','transferencia'\)/.test(sql), "desvincular aceita 'transferencia'")
ok(/DELETE FROM public\.erp_transferencia/.test(sql), 'desvincular remove a transferência')
ok(/reaproveitada/.test(sql) && /t\.valor = abs\(v_mov\.valor\)/.test(sql), 'transferir reaproveita transferência existente')
ok(/bkp_erp_transferencia_proplay_dup/.test(sql), 'backup antes da correção do dado')
if (falhas) process.exit(1)
