// Gate (auditor 24/10 · gap "Indicadores da viagem"): custo de viagem por m² executado, por km e por dia de equipe, %
// do custo previsto com alerta e histórico por rota — tudo lido da MESMA fonte do Resultado da obra
// (v_viagem_custo_obra / v_obra_resultado), numa função só de leitura e nova; a tela só chama a função. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_viagem_indicadores.sql'))
if (!arq) throw new Error('migration *_viagem_indicadores.sql não encontrada')
const mig = readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '')
const fn = mig.slice(mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_viagem_indicadores('), mig.indexOf('$function$;'))

ok(fn.length > 0 && /STABLE\s+SECURITY INVOKER\s+SET search_path TO 'public'/.test(fn), 'fn_viagem_indicadores: só leitura, com a RLS de quem lê e search_path fixo')
ok(/REVOKE ALL ON FUNCTION public\.fn_viagem_indicadores\(uuid, uuid, numeric\) FROM PUBLIC, anon;/.test(mig), 'fechada a anon')
ok(!/\b(INSERT|UPDATE|DELETE)\b/.test(fn), 'a função não grava nada')
ok(!/CREATE OR REPLACE (VIEW|FUNCTION public\.(?!fn_viagem_indicadores\())/.test(mig) && !/ALTER TABLE/.test(mig), 'só aditivo: nenhuma view/função/tabela existente muda')
ok(/FROM public\.v_viagem_custo_obra c/.test(fn) && /public\.v_obra_resultado r/.test(fn), 'custo sai da fonte única e confere com o Resultado')
ok(!/erp_viagem_lancamento/.test(fn), 'não soma cupom por fora da fonte única')
ok(fn.includes("'confere', i.custo_viagens = i.custo_no_resultado"), 'confere 1:1 por obra')
ok(fn.includes("lower(btrim(COALESCE(i.unidade, ''))) IN ('m2', 'm²')") && fn.includes('sum(i.quantidade_medida)'), 'm² executado = Σ medido dos itens em m²')
ok(fn.includes('round(ob.custo_viagens / m2.m2_executado, 2)'), 'custo por m² = custo de viagem ÷ m² executado')
ok(fn.includes('co.custo_total / co.custo_viagem') && fn.includes('sum(p.km * p.fator)') && fn.includes('sum(p.dias * p.fator)'), 'km e dias atribuídos à obra na mesma proporção do custo')
ok(fn.includes('(v.periodo_fim - v.periodo_inicio + 1) AS dias'), 'dias de equipe contam a saída e a volta')
ok(fn.includes('round(ob.custo_viagens * 100 / r.custo_previsto, 2)') && fn.includes('i.pct_orcado > COALESCE(p_limite_pct, 5)'), '% do custo previsto e alerta acima do limite (padrão 5%)')
ok(fn.includes("vg.status = 'fechada'") && fn.includes('GROUP BY vg.origem, vg.destino'), 'histórico por rota só com viagem fechada')
ok(fn.includes("v.status <> 'cancelada'") && fn.includes('v.excluido_em IS NULL'), 'viagem cancelada ou excluída não entra')

const chaves = ['ind_limite', 'ind_custo_m2', 'ind_custo_km', 'ind_custo_dia', 'ind_pct_orcado', 'ind_rota']
ok(chaves.every((c) => mig.includes(`'projetos.viagem.${c}'`)), '"?" (RD-95) dos indicadores no banco')

const tela = readFileSync('src/app/dashboard/projetos/viagens/IndicadoresViagem.tsx', 'utf8')
ok(/rpc\('fn_viagem_indicadores'/.test(tela) && !/\.(insert|update|delete|from)\(/.test(tela), 'tela só chama a função (não calcula nem grava)')
ok(chaves.every((c) => tela.includes(`chave="projetos.viagem.${c}"`)), 'tela: "?" em todo indicador')
ok(/overflow-x-auto/.test(tela), 'tela: tabela rola no celular')
ok(/<IndicadoresViagem empresa=\{empresa\} \/>/.test(readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')), 'indicadores ligados na tela de Viagens')
if (falhas) process.exit(1)
