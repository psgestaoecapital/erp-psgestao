// Gate (sessao-manual 27/10) — o roteamento do PDCA é balanceado (dev vivo + menor fila), sem nome de dev cravado.
// Prova, por texto, na migration que define fn_pdca_dono_hub e fn_pdca_hub_tick:
//   (1) o dono sai de fn_pdca_dono_hub (não de um CASE com nomes);
//   (2) o dono só vem de papel 'dev_hub', não pausado, VIVO por atividade real recente: entrega em erp_dev_entrega,
//       tarefa recebida/iniciada/concluída, ou lease renovado (não encerrado). A pausa vence qualquer atividade;
//   (3) sem dev vivo, o tick não cria tarefa (conta sem_dev_vivo);
//   (4) a dedupe checa qualquer dev_hub, para uma troca de dono entre ticks não duplicar;
//   (5) o corpo do fn_pdca_hub_tick não tem nome de Code cravado (os nomes só aparecem na semente da tabela de papel).
import { readdirSync, readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const dir = 'supabase/migrations'
const arq = readdirSync(dir).filter((f) => /_pdca_roteamento_balanceado\.sql$/.test(f)).sort().pop()
ok(!!arq, 'migration _pdca_roteamento_balanceado.sql existe')
const sql = arq ? readFileSync(`${dir}/${arq}`, 'utf8') : ''

const trecho = (nome: string) => {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${nome}`)
  if (i < 0) return ''
  const fim = sql.indexOf('$function$;', i)
  return fim < 0 ? '' : sql.slice(i, fim)
}
const dono = trecho('fn_pdca_dono_hub')
const tick = trecho('fn_pdca_hub_tick')

ok(dono.length > 0, 'fn_pdca_dono_hub definida')
ok(/p\.papel = 'dev_hub'/.test(dono), '(2) dono só entre papel dev_hub')
ok(/NOT p\.pausado/.test(dono), '(2) pausado fica fora')
ok(/erp_dev_entrega e[\s\S]*e\.ocorrido_em > now\(\) - interval '2 hours'/.test(dono), '(2a) vivo por entrega recente em erp_dev_entrega')
ok(/greatest\(m\.recebida_em, m\.iniciada_em, m\.concluida_em\) > now\(\) - interval '2 hours'/.test(dono), '(2b) vivo por tarefa recebida/iniciada/concluída recente')
ok(/l\.renovada_em > now\(\) - interval '2 hours'[\s\S]*l\.renovada_em >= l\.iniciada_em/.test(dono), '(2c) vivo por lease renovado recente e não encerrado')
ok(/ORDER BY \(SELECT count\(\*\)[\s\S]*ASC,/.test(dono), '(1) escolhe o de menor fila (contagem de nova ascendente)')
ok(/v_owner := public\.fn_pdca_dono_hub\(\);/.test(tick), '(1) o tick pega o dono de fn_pdca_dono_hub')
ok(/IF v_owner IS NULL THEN[\s\S]*v_sem := v_sem \+ 1;/.test(tick), '(3) sem dev vivo: não cria, conta sem_dev_vivo')
ok(/m\.para IN \(SELECT agente FROM erp_agente_papel WHERE papel = 'dev_hub'\)/.test(tick), '(4) dedupe checa qualquer dev_hub')

const nomesCravados = ['desenvolvedor_4_g', 'dev7claudeps', 'aud8claudeps', 'gilberto-desenv', 'code-desenvolvedor-3']
const corpo = dono + tick
ok(nomesCravados.every((n) => !corpo.includes(`'${n}'`)), '(5) nenhum nome de Code cravado nas funções (só na semente da tabela)')

console.log(falhas === 0 ? '\nRoteamento do PDCA balanceado: ok' : `\n${falhas} falha(s)`)
process.exit(falhas === 0 ? 0 : 1)
