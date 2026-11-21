// Gate do chamado #3961 — a conciliação deve gravar a CONTA DO EXTRATO no título a receber.
// O forward-fix #3866 cobriu match 1:1 e fatura agrupada; aqui garantimos o 3º caminho que marca
// erp_receber.conciliado = true: fn_conciliacao_ratear_avulso (rateio de movimento avulso).
// Padrão conservador do #3866: conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta) — só preenche
// quando está vazia, nunca sobrescreve. A migration é achada pelo sufixo (a fila pode renumerar a versão).
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_conciliacao_rateio_avulso_grava_conta_3961.sql'))
ok(!!arq, 'migration do #3961 existe')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

const fn = sql.split('CREATE OR REPLACE FUNCTION public.fn_conciliacao_ratear_avulso')[1]?.split('$function$;')[0] ?? ''
ok(fn.length > 0, 'migration reescreve fn_conciliacao_ratear_avulso')

// lê a conta do lote do movimento
ok(/SELECT conta_bancaria_id INTO v_conta FROM conciliacao_lote WHERE id = v_mov\.lote_id/.test(fn),
  'ratear_avulso: lê a conta bancária do lote do movimento')

// grava a conta no título, sem sobrescrever (COALESCE), junto da marca de conciliado
ok(/UPDATE erp_receber SET conciliado = true, movimento_banco_id = p_movimento_id,\s*conta_bancaria_id = COALESCE\(conta_bancaria_id, v_conta\)/.test(fn),
  'ratear_avulso: grava conta_bancaria_id = COALESCE(conta_bancaria_id, v_conta) no UPDATE do título')

// guarda de empresa preservada (sem afrouxar o acesso)
ok(/v_comp IN \(SELECT get_user_company_ids\(\)\) OR is_admin\(\)/.test(fn),
  'ratear_avulso: guarda de empresa mantida')

// validação de valor/soma intacta (não afrouxou a conciliação)
ok(/distribuicao_nao_fecha/.test(fn) && /valor_excede_saldo/.test(fn),
  'ratear_avulso: validações de soma e saldo mantidas')

// ACL explícita espelhando a viva (authenticated + service_role, sem anon)
ok(/REVOKE ALL ON FUNCTION public\.fn_conciliacao_ratear_avulso\(uuid, jsonb, uuid\) FROM PUBLIC, anon/.test(sql)
  && /GRANT EXECUTE ON FUNCTION public\.fn_conciliacao_ratear_avulso\(uuid, jsonb, uuid\) TO authenticated, service_role/.test(sql),
  'ACL explícita: REVOKE anon/PUBLIC + GRANT authenticated, service_role')

if (falhas) { console.error(`\n${falhas} verificação(ões) falharam — conciliação rateio avulso grava conta (#3961)`); process.exit(1) }
console.log('\ncheck-conciliacao-rateio-conta-3961: ok')
