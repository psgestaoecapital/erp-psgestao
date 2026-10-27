// Gate (#4917 item 2, jordana-code 27/10): o gatilho do outbox de pagar/receber sai antes de qualquer consulta quando a
// empresa não tem provider com ENVIO ativo (sem config, read_only ou paused), sem gravar linha 'cancelado'; quem envia
// continua passando por fn_outbox_enfileirar como antes. Sem rede, banco ou variável.
import { readdirSync, readFileSync } from 'node:fs'

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const ARQ = 'supabase/migrations/' + (readdirSync('supabase/migrations').find((f) => f.endsWith('_outbox_pular_sem_envio_4917.sql')) ?? '_outbox_pular_sem_envio_4917.sql')

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync(ARQ, 'utf8').replace(/--[^\n]*/g, '')
const iHelper = sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_outbox_envio_ativo')
const iTrg = sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_trg_outbox_pagar_receber')
ok(iHelper >= 0 && iTrg > iHelper, 'helper criado antes do gatilho')
const helper = sql.slice(iHelper, iTrg)
ok(/SECURITY DEFINER/.test(helper) && /SET search_path TO 'public', 'pg_temp'/.test(helper), 'helper SECURITY DEFINER com search_path fixo')
ok(/ativo = true/.test(helper) && /sync_mode NOT IN \('read_only','paused'\)/.test(helper), "helper: só ativo e fora de read_only/paused envia")
ok(/auth\.uid\(\) IS NOT NULL AND NOT public\.is_admin\(\) AND \(p_company_id IS NULL OR p_company_id NOT IN \(SELECT public\.get_user_company_ids\(\)\)\)/.test(helper) && /RAISE EXCEPTION 'Sem acesso a esta empresa'/.test(helper), 'helper recusa empresa que não é do usuário (mesma guarda de fn_outbox_enfileirar)')
ok(/REVOKE ALL ON FUNCTION public\.fn_outbox_envio_ativo\(uuid, text\) FROM PUBLIC, anon;/.test(sql), 'helper fechado para anon')

const trg = sql.slice(iTrg)
const iSai = trg.indexOf('IF NOT public.fn_outbox_envio_ativo(COALESCE(NEW.company_id, OLD.company_id), v_provider) THEN')
const iMapping = trg.indexOf('FROM erp_entity_mapping')
ok(iSai > 0 && iMapping > iSai, 'saída antecipada antes da consulta ao mapping')
ok(trg.indexOf('PERFORM fn_outbox_enfileirar(') > iSai, 'quem envia segue para fn_outbox_enfileirar')
ok(!/SECURITY DEFINER/.test(trg), 'gatilho continua SECURITY INVOKER')
ok(!/\b(DELETE FROM|TRUNCATE|DROP)\b/i.test(sql), 'sem DELETE/TRUNCATE/DROP')
ok(!/fn_outbox_enfileirar\s*\(\s*p_company_id uuid/.test(sql), 'fn_outbox_enfileirar não é reescrita')

if (falhas) { console.error(`\ncheck-outbox-sem-envio-4917: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-outbox-sem-envio-4917: ok')
