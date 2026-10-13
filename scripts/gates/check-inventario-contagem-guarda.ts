// Gate (CEO 01/10 · segurança, "corrija JÁ"): fn_inventario_registrar_contagem (SECURITY DEFINER) gravava a contagem
// em qualquer item de inventário pelo id. A migration 20261001120000 põe a guarda de empresa ANTES de gravar, barra
// inventário fechado e fecha a função ao anon. Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261001120000_inventario_contagem_guarda_empresa.sql', 'utf8').replace(/--[^\n]*/g, '')
const corpo = sql.slice(sql.indexOf('AS $function$'), sql.lastIndexOf('END $function$'))
const iGuarda = corpo.search(/v_company NOT IN \(SELECT public\.get_user_company_ids\(\)\)/)
const iFechado = corpo.search(/v_status = 'fechado'/)
const iUpdate = corpo.search(/UPDATE public\.erp_inventario_itens/)

ok(/SECURITY DEFINER/.test(sql) && /SET search_path TO 'public'/.test(sql), 'continua SECURITY DEFINER com search_path fixo')
ok(iGuarda > 0, 'guarda: o item tem de ser de empresa do usuário (get_user_company_ids)')
ok(/auth\.uid\(\) IS NOT NULL AND NOT public\.is_admin\(\)/.test(corpo), 'mesma regra das PR A2/A2b (sem usuário = serviço passa; is_admin passa)')
ok(/ERRCODE = '42501'/.test(corpo), 'nega com 42501 (permissão)')
ok(iFechado > 0 && /ERRCODE = '22023'/.test(corpo), 'inventário fechado não aceita contagem')
ok(iGuarda > 0 && iUpdate > iGuarda && iUpdate > iFechado, 'as guardas vêm ANTES de qualquer UPDATE')
ok(/contado_por = CASE WHEN auth\.uid\(\) IS NULL THEN p_usuario ELSE public\.fn_user_email_atual\(\) END/.test(corpo), 'quem contou vem da sessão, não do parâmetro')
ok(/REVOKE ALL ON FUNCTION public\.fn_inventario_registrar_contagem\(uuid, numeric, character varying\) FROM PUBLIC, anon/.test(sql), 'fechada ao anon')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_inventario_registrar_contagem\(uuid, numeric, character varying\) TO authenticated, service_role/.test(sql), 'logado e serviço seguem executando')

if (falhas) { console.error(`\n${falhas} falha(s) na guarda da contagem do inventário`); process.exit(1) }
console.log('\nGuarda da contagem do inventário: ok')
