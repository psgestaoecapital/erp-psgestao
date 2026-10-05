// Gate (chamado #587 · Frioeste · CEO 04/10): almoço desconta da exposição e pausa faltante é PENDENTE, não conforme.
// Roda no build, sem rede. A prova no dado (casos do Leonel) está no spec e2e @pos-migration; aqui travamos a forma.
import { readFileSync } from 'node:fs'
import { rotuloPendente, explicaPendente } from '../../src/lib/ponto/motivoPendente'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(rotuloPendente({ motivo: 'pausas_faltantes' }) === 'Pausas faltantes', 'tela: motivo pausas_faltantes em linguagem simples')
ok(rotuloPendente({ motivo: 'sem_registro_pausa' }) === 'Sem registro de pausa' && rotuloPendente({ sem_registro_pausa: true }) === 'Sem registro de pausa', 'tela: sem registro de pausa como antes')
ok(rotuloPendente({ motivo: 'pausa_sem_confirmacao' }) === 'Pausa sem hora de saída' && rotuloPendente({}) === 'Pausa sem hora de saída', 'tela: pausa sem hora de saída como antes')
ok(explicaPendente({ motivo: 'sem_registro_pausa' }) === null, 'só pausas_faltantes ganha explicação')
ok(explicaPendente({ motivo: 'pausas_faltantes', pausas_devidas: 4, pausas_realizadas: 3, almoco_min: 74 })?.startsWith('A jornada pedia 4 pausa(s) e há 3 registrada(s) (já descontados 74 min de almoço).') === true, 'explicação: devidas, realizadas e almoço')

const mig = readFileSync('supabase/migrations/20261005000000_nr36_almoco_pausas_faltantes.sql', 'utf8')
ok(/almoco_interrompe_exposicao/.test(mig) && /COALESCE\(\(v_param->>''almoco_interrompe_exposicao''\)::boolean, false\)/.test(mig), '(a) só com o parâmetro da empresa, sem default novo')
ok(/v_jornada_min - COALESCE\(v_pausas_min,0\) - v_almoco_min/.test(mig), '(a) devido desconta a janela de almoço')
ok(/WHEN v_almoco_on AND v_realizado < v_devido THEN ''pendente_confirmacao''/.test(mig) && /ELSE ''pausas_faltantes''/.test(mig), '(b) realizadas < devidas → pendente_confirmacao / pausas_faltantes')
ok(!/WHEN v_almoco_on AND v_realizado < v_devido THEN ''(conforme|desvio)''/.test(mig), '(b) nunca conforme (RD-51) nem desvio por estimativa (RD-38)')
ok(/CASE WHEN v_almoco_min > 0 THEN jsonb_build_object\(''almoco_min''/.test(mig), 'sem desconto, o detalhe não ganha chave nova (empresa sem parâmetro idêntica)')
ok(/status = ''pendente''/.test(mig) && /nr36_ciencia_mensal_historico/.test(mig) && /versao := OLD\.versao \+ 1/.test(mig), 'ciência: só a pendente é regenerada; versão anterior vai ao histórico')
ok(!/\bDELETE FROM\b|\bTRUNCATE\b|\bDROP TABLE\b/.test(mig), 'a migration não apaga dado')

const tela = readFileSync('src/app/dashboard/compliance/pausas-tecnicas/page.tsx', 'utf8')
ok(/rotuloPendente\(p\)/.test(tela) && /data-testid="pendente-explica"/.test(tela), 'Supervisão mostra o motivo e a explicação')

const spec = readFileSync('e2e/jornadas/aceitacao/nr36-587-almoco-pausas-faltantes.spec.ts', 'utf8')
ok(/@pos-migration/.test(spec) && /pendente_confirmacao/.test(spec) && /\[5, 3\]/.test(spec) && /ciência \$\{st\} não é alterada/.test(spec), 'spec @pos-migration: 16/09, 30/09, controle sem parâmetro e ciência')
ok(!/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(spec + mig), 'higiene LGPD: nenhum CPF completo no teste nem na migration')

if (falhas) { console.error(`\n${falhas} falha(s) (#587)`); process.exit(1) }
console.log('\nAlmoço + pausas faltantes (#587): ok')
