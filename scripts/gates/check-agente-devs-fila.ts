/**
 * Gate de build (CEO 26/10 · dev trabalha a FILA, não é acordado por tarefa).
 * Lê a migration 20261027070000_agente_devs_trabalham_a_fila.sql e prova:
 *   1) o gatilho de INSERT NÃO aciona a rotina para tarefa dos Codes de desenvolvimento (lista completa);
 *   2) continua acionando para os demais (aviso/responder) e no OK do CEO;
 *   3) o acionamento segue pelo corpo único (fn__agente_acionar) e a função segue revogada de anon/authenticated.
 *   npm run gates -- agente-devs-fila
 */
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const sql = readFileSync('supabase/migrations/20261027070000_agente_devs_trabalham_a_fila.sql', 'utf8').replace(/--[^\n]*/g, '')

const devs = ['dev7claudeps', 'desenvolvedor_4_g', 'desenvolvedor_5_g', 'desenvolvedor_6_g',
  'code-desenvolvedor-3', 'gilberto-produto', 'gilberto-desenv', 'gilberto-automotivo', 'gilberto-industria']

ok(/NOT \(\s*NEW\.tipo = 'tarefa' AND NEW\.para IN \(/.test(sql), 'INSERT: tarefa para dev não aciona (NOT (tipo = tarefa AND para IN (...)))')
ok(devs.every(d => sql.includes(`'${d}'`)), `INSERT: lista de devs completa (${devs.length} Codes)`)
ok(/IF NOT NEW\.arquivada\s+AND NOT \(/.test(sql), 'INSERT: arquivada continua não acionando')
ok(/OLD\.ok_ceo_em IS NULL AND NEW\.ok_ceo_em IS NOT NULL AND NOT NEW\.arquivada/.test(sql) && /PERFORM public\.fn__agente_acionar\(NEW\.id\)/.test(sql),
  'UPDATE: OK do CEO continua acionando pelo corpo único (fn__agente_acionar)')
ok(/REVOKE ALL ON FUNCTION public\.fn_agente_mensagem_trg_acionar\(\) FROM PUBLIC, anon, authenticated;/.test(sql), 'gatilho revogado de PUBLIC/anon/authenticated')
ok(!/CREATE TABLE|ALTER TABLE|DROP TRIGGER|GRANT /.test(sql), 'só troca o corpo do gatilho (sem tabela, trigger ou grant novo)')

if (falhas > 0) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nOK: regra dos devs (fila, não tarefa) provada')
