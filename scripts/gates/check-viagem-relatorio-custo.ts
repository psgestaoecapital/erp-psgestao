// Gate · Viagem — relatório de custo por viagem e por obra conferido 1:1 com o Resultado da obra (desenvolvedor_4_g).
// Sem rede: prova as regras puras com a viagem DEMO nº 1 (R$ 984,05 em 288 km) e o contrato da migration.
import { readFileSync } from 'node:fs'
import { custoPorKm, kmRodado, ratearViagem, AJUDA_RELATORIO_CUSTO, RPC_RELATORIO_CUSTO_VIAGEM } from '../../src/lib/viagem/relatorioCusto'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

// regras puras (mesmas da função)
const km = kmRodado(45210, 45498)
ok(km === 288, 'km rodado = final − inicial')
ok(kmRodado(100, null) === null && kmRodado(200, 100) === null, 'sem km final (ou final < inicial) não há km')
ok(custoPorKm(984.05, km) === 3.42, 'custo por km da viagem DEMO nº 1 = R$ 3,42')
ok(custoPorKm(500, null) === null && custoPorKm(500, 0) === null, 'sem km não há custo por km')
const rat = ratearViagem([{ obra_id: 'A', valor: 600 }, { obra_id: 'B', valor: 300 }, { obra_id: 'A', valor: 100 }], 280)
ok(rat.length === 2 && rat[0].obra_id === 'A' && rat[0].custo === 700 && rat[1].custo === 300, 'rateio: cada cupom na sua obra')
ok(rat[0].km_rateado === 196 && rat[1].km_rateado === 84, 'km rateado segue o dinheiro (70% × 280 = 196)')
ok(rat[0].participacao_pct === 70 && rat[1].participacao_pct === 30, 'participação soma 100%')
ok(ratearViagem([{ obra_id: 'A', valor: 10 }], null)[0].km_rateado === null, 'sem km, km rateado fica em branco')

// contrato da migration
const mig = readFileSync('supabase/migrations/20261025020052_viagem_relatorio_custo.sql', 'utf8')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_viagem_relatorio_custo('), mig.indexOf('$function$;'))
ok(fn.length > 0 && RPC_RELATORIO_CUSTO_VIAGEM === 'fn_viagem_relatorio_custo', 'função do contrato existe')
ok(/SECURITY INVOKER/.test(fn) && /STABLE/.test(fn) && !/SECURITY DEFINER/.test(fn), 'só leitura com a RLS de quem chama')
ok(/PERFORM public\.fn__guarda_empresa\(p_company_id\)/.test(fn), 'confere a empresa antes de ler')
ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(fn.replace(/--[^\n]*/g, '')), 'função não grava nada')
ok(/REVOKE ALL ON FUNCTION public\.fn_viagem_relatorio_custo\(uuid, uuid, date, date\) FROM PUBLIC, anon;/.test(mig), 'fechada a anon')
ok(/x\.excluido_em IS NULL AND x\.status <> 'cancelada'/.test(fn) && /l\.excluido_em IS NULL/.test(fn), 'lixeira e cancelada não entram')
ok(/FROM public\.v_obra_resultado/.test(fn) && /custo_viagens/.test(fn) && /'bate'/.test(fn) && /'diferenca'/.test(fn), 'conferência obra a obra com o Resultado da obra')
ok(!/DROP |TRUNCATE|DELETE FROM|ALTER TABLE/i.test(mig.replace(/--[^\n]*/g, '')), 'migration aditiva')
for (const chave of Object.values(AJUDA_RELATORIO_CUSTO)) ok(mig.includes(`'${chave}'`), `"?" no banco: ${chave}`)
ok(/ON CONFLICT \(chave\) DO NOTHING/.test(mig), 'ajuda não sobrescreve texto existente')

if (falhas) process.exit(1)
