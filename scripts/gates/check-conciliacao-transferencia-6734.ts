// Gate do chamado #6734 — conciliação de transferência entre contas:
// reaproveita a transferência do outro lado (sem duplicar saldo) e "Desvincular" aceita transferência.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_conciliacao_transferencia_sem_duplicar_desvincular.sql'))
ok(!!arq, 'migration do #6734 existe')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

const tr = sql.split('CREATE OR REPLACE FUNCTION public.fn_conciliacao_transferir')[1]?.split('$function$;')[0] ?? ''
ok(/v_reaproveitada := true/.test(tr) && /t\.movimento_id <> p_movimento_id/.test(tr), 'transferir: liga o 2º lado à transferência existente')
ok(/t\.conta_origem_id = v_origem AND t\.conta_destino_id = v_destino/.test(tr) && /t\.valor = abs\(v_mov\.valor\) AND t\.data = v_mov\.data_transacao/.test(tr),
  'transferir: só reaproveita com mesma origem, destino, valor e data')
ok(/get_user_company_ids\(\)/.test(tr), 'transferir: guarda de empresa mantida')

const de = sql.split('CREATE OR REPLACE FUNCTION public.fn_conciliacao_desvincular(')[1]?.split('$function$;')[0] ?? ''
ok(/IN \('pagar','receber','transferencia'\)/.test(de), 'desvincular: aceita transferencia')
ok(/DELETE FROM public\.erp_transferencia WHERE id = p_lancamento_id AND company_id = v_transf\.company_id/.test(de), 'desvincular: remove a transferência só da empresa')
ok(/company_id IN \(SELECT get_user_company_ids\(\)\)/.test(de), 'desvincular: guarda de empresa mantida')
ok(/REVOKE EXECUTE ON FUNCTION public\.fn_conciliacao_transferir\(uuid, uuid, text\) FROM anon/.test(sql)
  && /REVOKE EXECUTE ON FUNCTION public\.fn_conciliacao_desvincular\(uuid, text\) FROM anon/.test(sql), 'anon sem EXECUTE')
ok(/bkp_6734_transferencia/.test(sql) && /84414529-715f-4a2b-8bca-a260525bfeae/.test(sql), 'dado: backup + só a duplicada da Proplay')
ok(!/UPDATE public\.erp_(pagar|receber)/.test(sql.split('-- 3) Dado')[1] ?? 'x'), 'dado: não mexe em título')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK — gate #6734')
