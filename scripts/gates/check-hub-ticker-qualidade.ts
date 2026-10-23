// Gate (CEO 23/10, msg b76dd837 item A): TICKER DE QUALIDADE do Hub — nenhuma tela do Hub vira LIBERADO (e,
// pelo fn_pdca_hub_tick, 'pronto') sem os critérios 3 (cálculo correto contra caso conhecido) e 5 (financeiro e
// custos via GE integrado). "Mentir no indicador é proibido": os dois são fail-closed.
//
// Prova estática (sem rede/banco), na ÚLTIMA definição de fn_auditor_tela_completo nas migrations:
//   (1) lê erp_hub_tela_criterio para 'calculo_correto' e 'financeiro_via_ge' nas rotas /dashboard/projetos%;
//   (2) sem registro, 'falhou' ou vencido (> 7 dias) vira gap (só 'passou'/'nao_se_aplica' recentes contam);
//   (3) o veredito LIBERADO continua sendo "nenhum gap";
//   (4) devolve o ticker dos 5 critérios (criterios_ok/criterios_total);
// e a tabela tem RLS + REVOKE anon, e o writer exige caso conhecido (entrada/esperado/obtido) para cálculo passar.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join('supabase', 'migrations')
const arquivos = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
const ler = (f: string) => readFileSync(join(DIR, f), 'utf8')

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const reDef = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_auditor_tela_completo\s*\(/i
const comDef = arquivos.filter((f) => reDef.test(ler(f)))
ok(comDef.length > 0, 'fn_auditor_tela_completo definida em migration')
if (comDef.length > 0) {
  const sql = ler(comDef[comDef.length - 1])
  const corpo = sql.slice(sql.search(reDef))
  ok(/v_hub\s*:=\s*p_rota\s+LIKE\s+'\/dashboard\/projetos%'/i.test(corpo), 'critérios 3/5 valem nas rotas do Hub')
  ok(/criterio\s*=\s*'calculo_correto'/.test(corpo) && /criterio\s*=\s*'financeiro_via_ge'/.test(corpo),
    'lê os critérios calculo_correto e financeiro_via_ge de erp_hub_tela_criterio')
  for (const n of ['3', '5']) {
    ok(new RegExp(`v_ok${n}\\s*:=\\s*c${n}\\.rota\\s+IS\\s+NOT\\s+NULL\\s+AND\\s+c${n}\\.situacao\\s+IN\\s+\\('passou','nao_se_aplica'\\)\\s+AND\\s+c${n}\\.verificado_em\\s*>\\s*now\\(\\)\\s*-\\s*interval\\s+'7 days'`, 'i').test(corpo),
      `critério ${n}: só passa registrado, passou/não se aplica e recente (fail-closed)`)
    ok(new RegExp(`IF\\s+NOT\\s+v_ok${n}\\s+THEN\\s+v_gaps\\s*:=\\s*v_gaps\\s*\\|\\|`, 'i').test(corpo), `critério ${n} reprovado vira gap`)
  }
  ok(/v_verdict\s*:=\s*CASE\s+WHEN\s+array_length\(v_gaps,1\)\s+IS\s+NULL\s+THEN\s+'LIBERADO'/i.test(corpo), 'LIBERADO só sem nenhum gap')
  ok(/'ticker'/.test(corpo) && /'criterios_total',5/.test(corpo), 'devolve o ticker dos 5 critérios')
}

const mig = arquivos.filter((f) => /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.erp_hub_tela_criterio/i.test(ler(f)))
ok(mig.length === 1, 'erp_hub_tela_criterio criada em migration')
if (mig.length === 1) {
  const sql = ler(mig[0])
  ok(/ALTER\s+TABLE\s+public\.erp_hub_tela_criterio\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'erp_hub_tela_criterio com RLS')
  ok(/REVOKE\s+ALL\s+ON\s+public\.erp_hub_tela_criterio\s+FROM\s+PUBLIC,\s*anon/i.test(sql), 'erp_hub_tela_criterio: REVOKE anon')
  ok(/\?&\s*ARRAY\['entrada','esperado','obtido'\]/.test(sql), 'cálculo só passa com caso conhecido (entrada/esperado/obtido)')
  ok(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.fn_hub_tela_criterio_registrar\([^)]*\)\s+FROM\s+PUBLIC,\s*anon/i.test(sql), 'writer: REVOKE anon')
  ok(/auth\.uid\(\)\s+IS\s+NOT\s+NULL\s+AND\s+NOT\s+public\.is_admin\(\)/i.test(sql), 'writer: logado só admin')
}

if (falhas) process.exit(1)
