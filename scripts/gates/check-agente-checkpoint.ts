// Gate de build (CEO 13/10) — tarefa longa RETOMÁVEL por checkpoint. Estático, sem rede/banco.
// Confere a migration 20261013120030: colunas novas aditivas; writer que renova a lease e conta como progresso;
// reader; a fn_agente_caixa re-criada devolve checkpoint/etapa com a ACL re-aplicada (nunca anon); funções de serviço
// (SECURITY DEFINER + search_path fixo + guarda do canal + REVOKE anon); migration aditiva (sem DROP/DELETE/TRUNCATE);
// e a doutrina documentada no AGENTS.md.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const mig = '20261013120030_agente_checkpoint_retomavel.sql'
const s = readFileSync(join(__dirname, '../../supabase/migrations', mig), 'utf8')

// Colunas novas, aditivas (IF NOT EXISTS) com o default do checkpoint
ok(/ADD COLUMN IF NOT EXISTS checkpoint jsonb NOT NULL DEFAULT '\{\}'::jsonb/.test(s), 'coluna checkpoint jsonb NOT NULL DEFAULT {}')
ok(/ADD COLUMN IF NOT EXISTS etapa text/.test(s), 'coluna etapa text')

// Writer: canal protegido, renova a lease, zera redisparos (progresso), não marca concluída (fica em_andamento)
const gravar = s.slice(s.indexOf('FUNCTION public.fn_agente_checkpoint_gravar'), s.indexOf('fn_agente_checkpoint_ler'))
ok(/SECURITY DEFINER\s+SET search_path TO 'public'/.test(gravar), 'checkpoint_gravar: SECURITY DEFINER + search_path fixo')
ok(/PERFORM public\.fn__agente_assert_servico\(\)/.test(gravar), 'checkpoint_gravar: passa pela guarda do canal protegido')
ok(/UPDATE erp_agente_sessao_lease SET renovada_em = now\(\) WHERE agente = p_agente/.test(gravar), 'checkpoint_gravar: RENOVA a lease (passo longo não morre no meio)')
ok(/redisparos\s*=\s*0/.test(gravar) && /alerta_teto_em\s*=\s*NULL/.test(gravar), 'checkpoint_gravar: checkpoint é progresso (zera redisparos e alerta_teto)')
ok(/status\s*=\s*'em_andamento'/.test(gravar) && !/status\s*=\s*'concluida'/.test(gravar), 'checkpoint_gravar: mantém em_andamento (nunca conclui sozinho)')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_checkpoint_gravar\([^)]*\) FROM PUBLIC, anon, authenticated/.test(s), 'checkpoint_gravar: REVOKE de PUBLIC/anon/authenticated')
ok(/--\s*ci-sem-guarda:\s*fn_agente_checkpoint_gravar\b/.test(s), 'checkpoint_gravar: escape de guarda documentado (escreve só na caixa, canal de serviço)')

// Reader: só leitura, canal protegido, REVOKE anon
const ler = s.slice(s.indexOf('FUNCTION public.fn_agente_checkpoint_ler'), s.indexOf('FUNCTION public.fn_agente_caixa'))
ok(/STABLE\s+SECURITY DEFINER\s+SET search_path TO 'public'/.test(ler), 'checkpoint_ler: STABLE SECURITY DEFINER + search_path fixo')
ok(/PERFORM public\.fn__agente_assert_servico\(\)/.test(ler), 'checkpoint_ler: guarda do canal protegido')
ok(!/\b(UPDATE|INSERT|DELETE)\b/.test(ler), 'checkpoint_ler: só leitura (não escreve)')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_checkpoint_ler\([^)]*\) FROM PUBLIC, anon, authenticated/.test(s), 'checkpoint_ler: REVOKE de PUBLIC/anon/authenticated')

// fn_agente_caixa re-criada: devolve checkpoint/etapa e RE-APLICA a ACL (nunca anon; service_role)
const caixa = s.slice(s.indexOf('FUNCTION public.fn_agente_caixa'))
ok(/'etapa', etapa/.test(caixa) && /'checkpoint', COALESCE\(checkpoint, '\{\}'::jsonb\)/.test(caixa), 'fn_agente_caixa: devolve etapa e checkpoint (retomada automática)')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_caixa\(text\) FROM PUBLIC, anon, authenticated/.test(s)
  && /GRANT EXECUTE ON FUNCTION public\.fn_agente_caixa\(text\) TO service_role/.test(s),
  'fn_agente_caixa: ACL re-aplicada (REVOKE anon + GRANT service_role) após o CREATE OR REPLACE')

// Não altera a função de guarda (RD-91) e é aditiva (checa só o SQL, sem os comentários — o docstring cita as palavras)
ok(!/CREATE OR REPLACE FUNCTION public\.fn__agente_assert_servico/.test(s), 'não altera a função de guarda do canal (RD-91)')
const semComentarios = s.replace(/--[^\n]*/g, '')
ok(!/\b(DROP|TRUNCATE)\b/i.test(semComentarios) && !/DELETE\s+FROM/i.test(semComentarios), 'migration aditiva (sem DROP/DELETE/TRUNCATE)')

// Doutrina no AGENTS.md
const ag = readFileSync(join(__dirname, '../../AGENTS.md'), 'utf8')
ok(/retom[áa]vel por checkpoint/i.test(ag) && /fn_agente_checkpoint_gravar/.test(ag) && /IDEMPOT/i.test(ag),
  'AGENTS.md: doutrina de tarefa longa retomável (checkpoint, retomar do proximo, idempotência)')

if (falhas) { console.error(`\n[check-agente-checkpoint] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-agente-checkpoint] checkpoint de tarefa longa retomável conferido.')
