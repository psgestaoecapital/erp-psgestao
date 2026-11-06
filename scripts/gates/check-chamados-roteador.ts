// Gate (roteador de chamados · CEO 28/10): afirma, sobre a migration, as regras que o revisor exige provar.
// Estático, sem rede. (a) sensível nunca roteado · (b) usuário logado recusado · (c) p_limite respeitado ·
// (d) interno e chamado de agente de sócio ficam fora · idempotência · devolução soft · LGPD · só service_role.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_chamados_roteador_dev_mais_vazio.sql'))
ok(!!arq, 'migration do roteador existe')
const sql = readFileSync('supabase/migrations/' + arq, 'utf8')
const rot = sql.slice(sql.indexOf('FUNCTION public.fn_chamados_rotear'), sql.indexOf('REVOKE ALL ON FUNCTION public.fn_chamados_rotear'))
const vazio = sql.slice(sql.indexOf('FUNCTION public.fn_dev_mais_vazio'), sql.indexOf('REVOKE ALL ON FUNCTION public.fn_dev_mais_vazio'))

ok(/IF c\.sensivel THEN[\s\S]{0,80}CONTINUE;[\s\S]{0,80}END IF;[\s\S]{0,60}EXIT WHEN v_rot >= p_limite;[\s\S]{0,300}fn_agente_mensagem_enviar/.test(rot), '(a) chamado sensível é contado e pulado ANTES de qualquer envio')
for (const area of ['fiscal', 'financeiro', 'permiss', 'rls', 'lgpd', 'nr-36', 'nr36', 'salário', 'wealth', 'cvm'])
  ok(sql.includes(`('${area}'`), `(a) padrão sensível "${area}" semeado`)
ok(/ILIKE '%' \|\| r\.padrao \|\| '%'/.test(rot) && /r\.ativo/.test(rot), '(a) padrão casa por título, descrição, área e categoria')
ok(/IF auth\.uid\(\) IS NOT NULL THEN\s+RAISE EXCEPTION[\s\S]{0,120}42501/.test(rot), '(b) usuário logado é recusado (42501)')
ok(/EXIT WHEN v_rot >= p_limite/.test(rot), '(c) p_limite é respeitado (conta só os roteados)')
ok(/coalesce\(s\.interno, false\) = false/.test(rot), '(d) chamado interno fica fora')
ok(/fn_chamado_agente_dono\(s\.id\) IS NULL/.test(rot), '(d) chamado de agente de sócio fica fora')
ok(/NOT EXISTS \(SELECT 1 FROM public\.erp_agente_mensagem t[\s\S]{0,300}'recebida', 'em_andamento'\)/.test(rot), 'idempotente: chamado com tarefa aberta não é reroteado')
ok(/s\.agente NOT IN \(SELECT p\.agente FROM public\.erp_agente_papel p WHERE p\.papel = 'dev_hub' AND NOT p\.pausado\)/.test(rot), 'chamado já atendido por dev vivo não é reatribuído')
ok(/AND NOT p\.pausado/.test(vazio) && /< 10/.test(vazio), 'dev pausado não recebe; teto de 10 tarefas de chamado por dev')
ok(/ORDER BY \(SELECT count\(\*\)[\s\S]{0,400}\) ASC/.test(vazio), 'escolhe o dev com MENOS tarefas abertas')
ok(/interval '2 hours'/.test(vazio), 'dev sem atividade nas últimas 2 h não recebe')
ok(/fn_agente_mensagem_arquivar/.test(rot) && !/DELETE/.test(rot) && /soft|SOFT/.test(sql), 'devolução é soft: arquivada, nunca apagada')
ok(/UPDATE public\.sugestoes SET agente = NULL, em_atendimento_desde = NULL/.test(rot) && !/SET[^;]*status\s*=/.test(rot.replace(/m\.status|x\.status/g, '')), 'o chamado continua aberto (status não é tocado)')
ok(/interval '24 hours'/.test(rot), 'devolução só de tarefa com mais de 24 h')
ok(!/'Título: '|'Descrição: '/.test(rot), 'LGPD: título/descrição do cliente não vão para a fila de agentes')
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && !/CREATE POLICY/.test(sql), 'tabela de regras: RLS ligada, sem policy')
ok(/REVOKE ALL ON TABLE public\.erp_chamado_regra_sensivel FROM PUBLIC, anon, authenticated/.test(sql), 'tabela de regras sem acesso de anon/authenticated')
ok(/GRANT EXECUTE ON FUNCTION public\.fn_chamados_rotear\(integer\) TO service_role/.test(sql) && /GRANT EXECUTE ON FUNCTION public\.fn_dev_mais_vazio\(\) TO service_role/.test(sql), 'EXECUTE só service_role nas duas funções')
ok(!/TO (anon|authenticated)/.test(sql.replace(/FROM PUBLIC, anon, authenticated/g, '')), 'nenhuma concessão a anon/authenticated')

if (falhas) { console.error(`\n${falhas} falha(s) no roteador de chamados`); process.exit(1) }
console.log('\nRoteador de chamados: ok')
