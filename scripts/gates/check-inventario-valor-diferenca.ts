// Gate: calc_valor_diferenca não pode ler a coluna GENERATED `diferenca` (NULL em trigger BEFORE → valor sempre 0).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261013140000_inventario_valor_diferenca_trigger.sql', 'utf8').replace(/--[^\n]*/g, '')
const fn = sql.slice(sql.indexOf('AS $function$'), sql.indexOf('END; $function$'))
ok(!/NEW\.diferenca/.test(fn), 'trigger não lê NEW.diferenca (GENERATED)')
ok(/NEW\.quantidade_contada - NEW\.quantidade_sistema/.test(fn) && /NEW\.custo_unitario/.test(fn), 'calcula de contada − sistema × custo')
ok(/status IN \('em_andamento', 'fechado'\)/.test(sql) && !/erp_movimentacoes|movimentac/i.test(sql), 'backfill só de valor; não toca movimentações')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nValor da divergência do inventário: ok')
