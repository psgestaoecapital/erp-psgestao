// Gate (Eng. Chefe 23/10, msg 6fd7cc9d item 2): o tick do PDCA do Hub (fn_pdca_hub_tick) e o agendamento
// 'pdca-hub-tick-hora' nasceram por hotfix no banco; agora vivem em migration (RD-52) e não podem sumir num
// rebuild do schema nem perder as travas.
//
// Prova estática (sem rede/banco): na ÚLTIMA definição de fn_pdca_hub_tick nas migrations,
//   (1) há guarda de quem chama (usuário logado só se for admin; cron/serviço sem auth.uid passam);
//   (2) a promoção a 'pronto' só acontece com veredito LIBERADO do fn_auditor_tela_completo (promoção honesta);
//   (3) o disparo do auditor passa por fn_auditor_disparar (que só fotografa a DEMO);
//   (4) anon não executa (REVOKE de PUBLIC/anon);
// e o job 'pdca-hub-tick-hora' é agendado em migration chamando a função.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join('supabase', 'migrations')
const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const reDef = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_pdca_hub_tick\s*\(/i
const comDef = arquivos.filter((f) => reDef.test(readFileSync(join(DIR, f), 'utf8')))
ok(comDef.length > 0, 'fn_pdca_hub_tick definida em migration no repo')

if (comDef.length > 0) {
  const sql = readFileSync(join(DIR, comDef[comDef.length - 1]), 'utf8')
  const corpo = sql.slice(sql.search(reDef))
  ok(/auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+public\.is_admin\(\)/i.test(corpo), 'fn_pdca_hub_tick: guarda (logado só admin)')
  ok(/fn_auditor_tela_completo\(/.test(corpo) && /v_vd\s*=\s*'LIBERADO'\s+THEN\s+UPDATE\s+system_screens\s+SET\s+estado_real\s*=\s*'pronto'/i.test(corpo),
    "fn_pdca_hub_tick: 'pronto' só com veredito LIBERADO do auditor")
  ok(/PERFORM\s+public\.fn_auditor_disparar\(/i.test(corpo), 'fn_pdca_hub_tick: dispara pelo fn_auditor_disparar (só DEMO)')
  // Rodízio (25/10): o disparo não pode ordenar só pela ultima_validacao_visual_em (o disparo nunca a atualiza → as
  // mesmas 6 rotas eram fotografadas toda hora e o resto do Hub nunca era reauditado). Tem de considerar o último print.
  ok(/greatest\(\s*s\.ultima_validacao_visual_em\s*,\s*u\.ultimo_print\s*\)/i.test(corpo) && /system_screens_insights\s+i\s+WHERE\s+i\.rota\s*=\s*s\.rota/i.test(corpo),
    'fn_pdca_hub_tick: rodízio do disparo pelo último print do auditor (sem rota faminta)')
  ok(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_pdca_hub_tick\([^)]*\)\s+FROM\s+PUBLIC,\s*anon/i.test(corpo), 'fn_pdca_hub_tick: REVOKE de PUBLIC/anon')
}

const reJob = /cron\.schedule\(\s*'pdca-hub-tick-hora'\s*,\s*'[^']+'\s*,\s*\$cron\$\s*SELECT\s+public\.fn_pdca_hub_tick\(\)/i
ok(arquivos.some((f) => reJob.test(readFileSync(join(DIR, f), 'utf8'))), "job 'pdca-hub-tick-hora' agendado em migration")

if (falhas) process.exit(1)
