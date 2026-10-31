// Gate (chamado #587 · Frioeste · CEO 04/10 + #2119 · CEO 31/10): o almoço desconta da exposição (#587) e,
// quando TODAS as pausas realizadas são conformes e a única falta é uma pausa devida-por-exposição NÃO
// realizada (estimativa), o dia é CONFORME com a falta SINALIZADA à parte — não "aguardando confirmação"
// (#2119, supera a parte de #587 que mandava para pendente). Roda no build, sem rede. A prova no dado (casos
// do Leonel) está no spec e2e @pos-migration; aqui travamos a forma.
import { readFileSync, readdirSync } from 'node:fs'
import { rotuloPendente, explicaPendente } from '../../src/lib/ponto/motivoPendente'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// rótulos de pendência que seguem vivos (sem_registro_pausa e pausa sem hora de saída). O rótulo de
// 'pausas_faltantes' continua na lib para ler graciosamente linhas antigas até a reapuração (transição).
ok(rotuloPendente({ motivo: 'sem_registro_pausa' }) === 'Sem registro de pausa' && rotuloPendente({ sem_registro_pausa: true }) === 'Sem registro de pausa', 'tela: sem registro de pausa como antes')
ok(rotuloPendente({ motivo: 'pausa_sem_confirmacao' }) === 'Pausa sem hora de saída' && rotuloPendente({}) === 'Pausa sem hora de saída', 'tela: pausa sem hora de saída como antes')
ok(explicaPendente({ motivo: 'sem_registro_pausa' }) === null, 'sem_registro_pausa não ganha explicação de estimativa')

// (a) #587 segue valendo: o almoço desconta da exposição, só com o parâmetro da empresa (migration original).
const mig587 = readFileSync('supabase/migrations/20261005000000_nr36_almoco_pausas_faltantes.sql', 'utf8')
ok(/almoco_interrompe_exposicao/.test(mig587) && /COALESCE\(\(v_param->>''almoco_interrompe_exposicao''\)::boolean, false\)/.test(mig587), '(a) só com o parâmetro da empresa, sem default novo')
ok(/v_jornada_min - COALESCE\(v_pausas_min,0\) - v_almoco_min/.test(mig587), '(a) devido desconta a janela de almoço')
ok(/status = ''pendente''/.test(mig587) && /nr36_ciencia_mensal_historico/.test(mig587) && /versao := OLD\.versao \+ 1/.test(mig587), 'ciência: só a pendente é regenerada; versão anterior vai ao histórico')

// (b) #2119: na versão VIGENTE do núcleo, a falta estimada NÃO é mais pendente — vira conforme + sinal à parte.
// Resolve a migration por sufixo (não por versão fixa) — assim a renumeração automática da fila
// (quando a versão fica abaixo da main) NÃO exige editar este gate: ele acompanha o arquivo.
const migDir = 'supabase/migrations'
const mig2119Nome = readdirSync(migDir).find((f) => /_nr36_pausas_faltantes_conforme_sinal_2119\.sql$/.test(f))
ok(!!mig2119Nome, '#2119: migration encontrada em supabase/migrations')
const mig2119 = mig2119Nome ? readFileSync(`${migDir}/${mig2119Nome}`, 'utf8') : ''
ok(/CREATE OR REPLACE FUNCTION public\.fn_nr36_apurar_nucleo/.test(mig2119), '#2119 reescreve o núcleo da apuração')
ok(!/WHEN v_almoco_on AND v_realizado < v_devido THEN 'pendente_confirmacao'/.test(mig2119), '(b) a linha que mandava pausa faltante para pendente foi REMOVIDA')
ok(/WHEN v_insuf > 0 THEN 'desvio'/.test(mig2119) && /ELSE 'conforme' END/.test(mig2119), '(b) desvio só por pausa insuficiente; o resto (falta estimada) é conforme')
ok(/WHEN NOT COALESCE\(v_tem_pausa,false\) AND v_devido > 0 THEN 'pendente_confirmacao'/.test(mig2119), '(c) ZERO pausa num dia que exigia segue pendente (sem_registro_pausa)')
ok(/'nao_realizada_estimado',jsonb_build_object\('faltantes'/.test(mig2119), 'o sinal (falta estimada) continua gravado no detalhe — base da reconciliação')
ok(/v_devido > 0 THEN 'pendente_confirmacao'[\s\S]*ELSE 'conforme' END;[\s\S]*v_motivo := CASE WHEN v_status='pendente_confirmacao' THEN 'sem_registro_pausa' ELSE NULL END/.test(mig2119), '(c) motivo de pendência: só sem_registro_pausa; conforme não carrega motivo')
ok(!/\bDELETE FROM\b|\bTRUNCATE\b|\bDROP TABLE\b/.test(mig2119), 'a migration não apaga dado')
ok(/REVOKE ALL ON FUNCTION[^;]*anon/.test(mig2119) && /GRANT EXECUTE ON FUNCTION[^;]*service_role/.test(mig2119), 'função trancada (sem anon; service_role)')

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/rotuloPendente\(p\)/.test(tela) && /data-testid="pendente-explica"/.test(tela), 'Supervisão mostra o motivo e a explicação')

const spec = readFileSync('e2e/jornadas/aceitacao/nr36-587-almoco-pausas-faltantes.spec.ts', 'utf8')
ok(/@pos-migration/.test(spec) && /toBe\('conforme'\)/.test(spec) && /fn_nr36_reconciliacao/.test(spec) && /\[5, 3\]/.test(spec) && /ciência \$\{st\} não é alterada/.test(spec), 'spec @pos-migration: 16/09 conforme + sinal na reconciliação, 30/09, controle sem parâmetro e ciência')
ok(!/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(spec + mig587 + mig2119), 'higiene LGPD: nenhum CPF completo no teste nem nas migrations')

if (falhas) { console.error(`\n${falhas} falha(s) (#587 · #2119)`); process.exit(1) }
console.log('\nAlmoço + pausas faltantes conforme + sinal (#587 · #2119): ok')
