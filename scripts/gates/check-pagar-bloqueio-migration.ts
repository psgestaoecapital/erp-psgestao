/**
 * Gate (#1672): a migration do bloqueio de pagamento é aditiva e segura (RLS, REVOKE anon, guarda Master, histórico,
 * trava na remessa e na baixa; sem reescrever função existente).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const dir = join(process.cwd(), 'supabase', 'migrations')
const arq = readdirSync(dir).find((f) => f.endsWith('_pagar_bloqueio_pagamento.sql'))
ok(!!arq, 'migration pagar_bloqueio_pagamento existe')
const sql = arq ? readFileSync(join(dir, arq), 'utf8') : ''

ok(/ADD COLUMN IF NOT EXISTS bloqueado boolean NOT NULL DEFAULT false/.test(sql), 'coluna bloqueado (aditiva)')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /get_user_company_ids/.test(sql), 'histórico com RLS por empresa')
ok(/REVOKE ALL ON public\.erp_pagar_bloqueio_historico FROM anon/.test(sql), 'histórico sem acesso anon')
ok(/fn_pagar_usuario_master\(v_p\.company_id\)/.test(sql) && /'socio'.*'acesso_total'.*'admin'.*'adm'/.test(sql) && /CLIENT_OWNER/.test(sql), 'guarda de papel Master na função')
ok(/length\(v_motivo\) < 3/.test(sql), 'motivo obrigatório nas duas ações')
ok(/INSERT INTO public\.erp_pagar_bloqueio_historico/.test(sql), 'grava histórico (quem e quando)')
ok(/TRIGGER trg_remessa_item_bloqueado BEFORE INSERT ON public\.erp_remessa_pagamento_item/.test(sql), 'remessa recusa título bloqueado')
ok(/TRIGGER trg_pagar_bloqueado_baixa BEFORE UPDATE ON public\.erp_pagar/.test(sql), 'baixa recusa título bloqueado')
ok(!/CREATE OR REPLACE FUNCTION public\.(fn_pagar_baixar_pagamento|fn_remessa_marcar_incluidos)/.test(sql), 'não reescreve função existente')
ok(!/\b(DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i.test(sql), 'sem DELETE/TRUNCATE/DROP de dado')

if (falhas) { console.error(`\n[check-pagar-bloqueio-migration] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-pagar-bloqueio-migration] migration do bloqueio conferida.')
