// Gate HB2 — contrato de preços do cliente: seed DEMO completo (faixas, regimes, códigos), aviso de de-para na tela
// e cálculo conferido em caso conhecido (faixa 500–1.000 do uretano × regime sábado +50%).
import { readFileSync, readdirSync } from 'node:fs'
import { precoUnitario } from '../../src/lib/hub/tabelaPreco'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_hb2_contrato_precos_demo.sql'))!
const sql = readFileSync(`supabase/migrations/${arq}`, 'utf8')
ok(/^\d{8}\d{4}35_/.test(arq), 'migration na faixa 35')
ok(/IF EXISTS \(SELECT 1 FROM public\.erp_tabela_preco_cliente/.test(sql), 'seed idempotente')
ok(!/\b(UPDATE|DELETE)\b/i.test(sql.replace(/--.*$/gm, '')), 'sem UPDATE/DELETE')
ok(['noturno', 'sabado', 'domingo_feriado'].every(r => sql.includes(`'${r}'`)), '4 regimes (normal + 3 adicionais)')
const tela = readFileSync('src/app/dashboard/projetos/tabelas-preco/page.tsx', 'utf8')
ok(/tp-depara-aviso/.test(tela) && /hub\.tabela_preco\.depara/.test(tela) && /hub\.tabela_preco\.depara/.test(sql), 'aviso de de-para com "?" e chave no banco')
const f = [{ faixa_de: 500, faixa_ate: 1000, preco_base: 118 * 0.9 }]
ok(precoUnitario(f, 700, { condicao: 'sabado', percentual: 50 }) === 159.3, 'uretano 700 m² sábado = 118×0,90×1,5 = R$ 159,30')
if (falhas) { console.error(`${falhas} falha(s)`); process.exit(1) }
