// Gate (CEO 01/10 · auditoria do Hub): o auditor por área (fn_auditor_matriz_*) não pode voltar a ficar "pending"
// para sempre. Run 23 (hub): o robô recebia a empresa só dentro da rota (?company_id=), não lia, respondia 403 e
// ninguém olhava a resposta; tela nova quebrava em "null value in column area of relation system_screens". Sem rede.
import { readFileSync } from 'node:fs'
import { empresaDoPedidoRobo } from '../../src/lib/gold/empresaDoPedidoRobo'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── robô: empresa do corpo, senão a da rota; lote com empresas diferentes → '' (fail-closed) ──
const GE = 'b0700000-0000-4000-a000-000000000004'
const AG = 'b0700000-0000-4000-a000-000000000002'
ok(empresaDoPedidoRobo(AG, [`/dashboard/x?company_id=${GE}`]) === AG, 'empresa do corpo tem prioridade')
ok(empresaDoPedidoRobo(undefined, [`/dashboard/projetos/catalogo?area=hub&company_id=${GE}`]) === GE, 'sem corpo: lê company_id da rota (o disparo do banco)')
ok(empresaDoPedidoRobo('', [`/dashboard/a?empresa_id=${GE}`, `/dashboard/b?company_id=${GE}`]) === GE, 'lote com a mesma empresa em todas as rotas')
ok(empresaDoPedidoRobo('', [`/dashboard/a?company_id=${GE}`, `/dashboard/b?company_id=${AG}`]) === '', 'lote com empresas diferentes → vazio (o robô recusa)')
ok(empresaDoPedidoRobo(null, ['/dashboard/a?area=hub']) === '', 'sem empresa em lugar nenhum → vazio')
ok(empresaDoPedidoRobo(null, ["/dashboard/a?company_id=1' OR 1=1"]) === '', 'company_id que não é uuid → vazio')

const rota = readFileSync('src/app/api/screen-watcher/playwright/route.ts', 'utf8')
ok(rota.includes('const empresaId = empresaDoPedidoRobo(body.empresa_id, rotas);'), 'a rota do robô usa a regra única')
ok(/if \(!\(await empresaPermitidaParaRobo\(supabase, empresaId\)\)\)/.test(rota), 'a trava "só demonstração" continua depois (RD-69/70)')

// ── banco ──
const mig = readFileSync('supabase/migrations/20261001230000_auditor_matriz_conserto.sql', 'utf8')
const sql = mig.replace(/--[^\n]*/g, '')
ok(!/x-watcher-secret/i.test(sql) && !/FUNCTION\s+public\.fn_auditor_disparar\s*\(/i.test(sql),
  'não reescreve fn_auditor_disparar nem carrega segredo')
ok(sql.includes("COALESCE(p_apenas_status, ARRAY['pronto','parcial'])"), 'filtro NULL = padrão (run 22 não casava nada)')
ok(sql.includes("'todos' = ANY(v_status)") && sql.includes("'sem_status' = ANY(v_status)"), "'todos' e 'sem_status' cobrem as telas sem selo")
ok(/c\.is_demo\) THEN\s+v_empresa := p_company_id;/.test(sql) && sql.includes('public.fn_demo_da_area(p_area_id)'),
  'empresa não-demo é trocada pela demo da área (LGPD) e fica na observação')
ok(/INSERT INTO system_screens \(id, rota, area, titulo/.test(sql) && sql.includes('COALESCE(v_area_tela, p_area_id)'),
  'tela nova é cadastrada com área antes do disparo')
ok(sql.includes("'hub_construcao'") && /INSERT INTO public\.demo_por_area/.test(sql), 'hub_construcao ganha a demo')
ok(sql.includes('FROM net._http_response h WHERE h.id = v_resultado.request_id_playwright') && sql.includes("v_http_status <> 200"),
  'consultar lê a resposta do robô: ≠ 200 vira erro com o motivo')
ok(sql.indexOf("interval '20 minutes'") > 0 && sql.indexOf("interval '20 minutes'") < sql.indexOf('fn_auditor_consultar(v_resultado.rota_base'),
  'timeout de 20 min conferido ANTES da consulta do insight')
ok(sql.includes("(v_consulta#>>'{analise,analisado_em}')::timestamptz <= (v_consulta->>'screenshot_em')::timestamptz")
  && sql.includes('fn_disparar_insight_auditor(p_rota := v_resultado.rota_base, p_limit := 1)'),
  'análise anterior à foto nova não vale; a IA é chamada de novo depois da foto')
ok(/cron\.schedule\('auditor-matriz-consultar-5min', '\*\/5 \* \* \* \*'/.test(sql), 'cron consulta a cada 5 min')
for (const fn of ['fn_auditor_matriz_disparar(text, uuid, text[], text[], text)', 'fn_auditor_matriz_consultar(bigint)', 'fn_auditor_matriz_consultar_pendentes()']) {
  ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
    && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`), `${fn}: só service_role`)
}
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30): runs velhos são fechados com motivo')

if (falhas) { console.error(`\ncheck-auditor-matriz-conserto: ${falhas} falha(s)`); process.exit(1) }
console.log('\nAuditor por área · conserto: ok')
