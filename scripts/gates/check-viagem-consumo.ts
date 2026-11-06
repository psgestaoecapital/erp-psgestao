// Gate (auditor 24/10 · gap "Abastecimento na viagem"): consumo do veículo pelo método do tanque cheio (km/l), combustível
// por km, preço médio do litro e custo da viagem por km — numa função nova, só de leitura, com o custo vindo da mesma
// fonte do Resultado da obra (v_viagem_custo_obra); a tela só chama a função. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_viagem_consumo_veiculo.sql'))
if (!arq) throw new Error('migration *_viagem_consumo_veiculo.sql não encontrada')
const mig = readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_viagem_consumo('), mig.indexOf('$function$;'))

ok(fn.length > 0 && /STABLE\s+SECURITY INVOKER\s+SET search_path TO 'public'/.test(fn), 'fn_viagem_consumo: só leitura, com a RLS de quem lê e search_path fixo')
ok(/REVOKE ALL ON FUNCTION public\.fn_viagem_consumo\(uuid, text\) FROM PUBLIC, anon;/.test(mig), 'fechada a anon')
ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(fn), 'a função não grava nada')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(?!fn_viagem_consumo\())/.test(mig) && !/ALTER TABLE/.test(mig), 'só aditivo: nenhuma view/função/tabela existente muda')
ok(fn.includes("l.tipo = 'abastecimento'") && fn.includes('l.excluido_em IS NULL') && fn.includes("v.status <> 'cancelada'"), 'só abastecimento vivo de viagem não cancelada')
ok(fn.includes('ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING') && fn.includes('PARTITION BY f.placa ORDER BY f.hodometro'), 'trecho = do tanque cheio até o próximo, por placa, na ordem do hodômetro')
ok(fn.includes('s.hod_fim - a.hod_ini AS km') && fn.includes('WHERE s.fechado AND s.hod_fim > a.hod_ini'), 'km do trecho = hodômetro que fecha − que abre; trecho aberto fica fora')
ok(fn.includes('round(m.km / m.litros, 2) END AS km_l') && fn.includes('round(m.valor / m.km, 2) END AS combustivel_km'), 'km/l médio = Σ km ÷ Σ litros dos trechos; combustível por km')
ok(fn.includes('FROM public.v_viagem_custo_obra') && fn.includes('round(v.custo_com_km / v.km, 2) END AS custo_km'), 'custo da viagem por km sai da fonte única do Resultado')
ok(fn.includes('t.km / t.litros < 0.8 * p.km_l'), 'alerta: trecho 20% abaixo do km/l médio do veículo')
ok(fn.includes('f.hodometro IS NOT NULL') && fn.includes('AS sem_hodometro'), 'abastecimento sem hodômetro fica fora do km/l e é contado')

const chaves = ['cons_km_l', 'cons_combustivel_km', 'cons_custo_km', 'cons_preco_litro', 'cons_trecho', 'cons_tanque_cheio']
ok(chaves.every((c) => mig.includes(`'projetos.viagem.${c}'`)), '"?" (RD-95) do consumo no banco')

const tela = readFileSync('src/app/dashboard/projetos/viagens/ConsumoVeiculo.tsx', 'utf8')
ok(/rpc\('fn_viagem_consumo'/.test(tela) && !/\.(insert|update|delete|from)\(/.test(tela), 'tela só chama a função (não calcula nem grava)')
ok(chaves.filter((c) => c !== 'cons_tanque_cheio').every((c) => tela.includes(`chave="projetos.viagem.${c}"`)), 'tela: "?" em todo indicador')
ok(/overflow-x-auto/.test(tela), 'tela: tabela rola no celular')
const page = readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')
ok(/<ConsumoVeiculo key=\{lancs\.length\} empresa=\{empresa\} placa=\{aberta\.placa\} \/>/.test(page), 'consumo ligado na viagem aberta (recarrega a cada lançamento)')
ok(page.includes('tanque_cheio: e.target.checked') && page.includes('chave="projetos.viagem.cons_tanque_cheio"'), 'formulário de abastecimento grava "tanque cheio", com "?"')
if (falhas) process.exit(1)
