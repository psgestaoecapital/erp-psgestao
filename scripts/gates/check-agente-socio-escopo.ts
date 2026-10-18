/**
 * Gate de build (CEO 05/10): escopo de agente de sócio (rodrigo-code) e OK do sócio.
 *   1) erp_agente_escopo fechada (RLS + REVOKE, sem policy); mapeia 'rodrigo-code' ↔ equipe 'code-rodrigo';
 *   2) funções de escopo/pedido/backfill só serviço; fn_agente_ok_socio só authenticated e só se auth.uid() = sócio do agente;
 *   3) fn_agente_chamado_responder: agente de sócio exige ok_socio aprovado, outro agente é barrado em chamado de sócio,
 *      e as garantias antigas (OK do CEO, hash, autor PS, rastro) continuam;
 *   4) rodrigo-code NÃO nasce ligado (o Eng. Chefe liga depois de conferir o cofre);
 *   5) AGENTS.md documenta a guarda para o gilberto-chamados.
 *   npm run gates -- agente-socio-escopo
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const raiz = join(__dirname, '../..')
const dir = join(raiz, 'supabase/migrations')
const arqs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const arq = arqs.find((f) => f.includes('agente_socio_escopo_ok'))
ok(!!arq, `migration encontrada (${arq ?? '—'})`)
const s = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')

ok(/ALTER TABLE public\.erp_agente_escopo ENABLE ROW LEVEL SECURITY/.test(s) && /REVOKE ALL ON TABLE public\.erp_agente_escopo FROM PUBLIC, anon, authenticated/.test(s) && !/CREATE POLICY/i.test(s), 'erp_agente_escopo fechada (RLS + REVOKE, sem policy)')
ok(/'rodrigo-code', e\.user_id, e\.agente/.test(s) && /nome_curto = 'Rodrigo'/.test(s), "mapeia 'rodrigo-code' ↔ erp_chamado_equipe 'code-rodrigo'")
for (const f of ['fn_agente_escopo_chamado(text, uuid)', 'fn_chamado_agente_dono(uuid)', 'fn_agente_pedir_ok_socio(uuid, text, text)', 'fn_agente_escopo_backfill(text)']) {
  ok(s.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`) && s.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`), `${f}: só serviço`)
}
const okSocio = s.slice(s.indexOf('FUNCTION public.fn_agente_ok_socio('), s.indexOf('FUNCTION public.fn_agente_ok_socio_pendente('))
ok(/auth\.uid\(\)/.test(okSocio) && /e\.socio_user_id = v_uid/.test(okSocio) && okSocio.includes("'so_o_socio_dono'"), 'OK do sócio só com auth.uid() = sócio do agente')
ok(s.includes('GRANT EXECUTE ON FUNCTION public.fn_agente_ok_socio(uuid, text) TO authenticated;') && /REVOKE ALL ON FUNCTION public\.fn_agente_ok_socio\(uuid, text\) FROM PUBLIC, anon;/.test(s), 'fn_agente_ok_socio: authenticated sim, anon não')
const resp = s.slice(s.indexOf('FUNCTION public.fn_agente_chamado_responder('))
ok(resp.includes("'sem_ok_do_socio'") && resp.includes("'chamado_de_agente_socio'") && resp.includes("'chamado_fora_do_escopo'"), 'responder: OK do sócio, guarda de outro agente e de escopo')
ok(/requer_ok_ceo OR m\.ok_ceo_em IS NULL/.test(resp) && resp.includes("'sem_ok_do_ceo'") && resp.includes('sha256(') && resp.includes('erp_agente_config'), 'responder: OK do CEO, hash e autor PS continuam para os demais agentes')
ok(!/INSERT INTO public\.erp_agente_rotina|rodrigo-code', true/.test(s), 'rodrigo-code não é ligado pela migration (aciona segue false)')
ok(!/fn_agente_mensagem_enviar|fn_agente_mensagem_ok_ceo|set_config|request\.jwt/.test(s), 'não envia mensagem do Eng. Chefe nem forja identidade')
const agents = readFileSync(join(raiz, 'AGENTS.md'), 'utf8')
ok(/erp_agente_escopo|fn_chamado_agente_dono/.test(agents) && /agente de sócio/i.test(agents), 'AGENTS.md documenta a guarda de chamado de agente de sócio')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
