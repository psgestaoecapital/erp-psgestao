// Gate (Eng. Chefe 24/10 · onda 2 de Viagens, autorizada na caixa 9c047749): a viagem fechada vai ao GE com centro de
// custo = obra, SÓ ADITIVO (tabela de vínculo + função nova; nada financeiro existente muda, nada de cliente se altera
// ou apaga), uma vez só, autoria do usuário logado, Σ dos títulos por obra = a fonte única do Resultado; a tela mostra o
// relatório por obra do fn_viagem_relatorio e o botão "Lançar no GE", com "?" (RD-95). Sem rede.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// acha a migration pelo sufixo: a fila pode renumerar a versão sem quebrar o gate
const arq = readdirSync('supabase/migrations').find(f => f.endsWith('_viagem_lancar_ge_obra.sql'))
if (!arq) throw new Error('migration *_viagem_lancar_ge_obra.sql não encontrada')
const mig = readFileSync(`supabase/migrations/${arq}`, 'utf8').replace(/--[^\n]*/g, '')
const i = mig.indexOf('CREATE OR REPLACE FUNCTION public.fn_viagem_lancar_ge(')
const fn = i < 0 ? '' : mig.slice(i, mig.indexOf('$function$;', i))

// só aditivo
ok(!/\b(UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE|DROP\s+(TABLE|FUNCTION|VIEW))/i.test(mig), 'migration só aditiva: sem UPDATE/DELETE/TRUNCATE/DROP de objeto')
ok((mig.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length === 1 && !/CREATE OR REPLACE VIEW/.test(mig), 'uma função nova; nenhuma view/função existente reescrita')
ok(!/ALTER TABLE public\.erp_pagar/.test(mig), 'erp_pagar não muda de estrutura')

// vínculo
ok(/CREATE TABLE IF NOT EXISTS public\.erp_viagem_ge_titulo/.test(mig) && /UNIQUE \(lancamento_id, obra_id, situacao\)/.test(mig), 'vínculo viagem × título com chave única por pedaço')
ok(mig.includes('ALTER TABLE public.erp_viagem_ge_titulo ENABLE ROW LEVEL SECURITY;') && mig.includes('REVOKE ALL ON public.erp_viagem_ge_titulo FROM PUBLIC, anon;'), 'vínculo com RLS e fechado a anon')
ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*erp_viagem_ge_titulo/.test(mig), 'vínculo gravado só pela função')

// função
ok(/SECURITY DEFINER/.test(fn) && /SET search_path TO 'public'/.test(fn), 'função com search_path fixo')
const iUid = fn.indexOf('IF v_uid IS NULL THEN RETURN'), iGuarda = fn.indexOf('PERFORM public.fn__guarda_empresa(v_v.company_id)'), iIns = fn.indexOf('INSERT INTO public.erp_pagar')
ok(iUid > 0 && iGuarda > iUid && iIns > iGuarda, 'autoria por auth.uid() e guarda de empresa antes de gravar')
ok(fn.includes('public.fn_viagem_pode_gravar(v_v.company_id)'), 'perfil de consulta não lança')
ok(fn.includes("v_v.status <> 'fechada'"), 'só viagem fechada')
ok(fn.includes('Viagem já lançada no GE'), 'não lança duas vezes')
ok(fn.includes('centro_custo_id IS NULL') && (fn.match(/r\.centro_custo_id/g) ?? []).length >= 4, 'todo título no centro de custo da obra (obra sem centro recusa)')
ok(fn.includes('round(l.valor * p.peso / p.peso_total, 2)') && fn.includes('CASE WHEN pd.ordem = 1 THEN l.valor - sum(pd.cota) OVER (PARTITION BY pd.id) ELSE 0 END'), 'cota pela mesma conta da v_viagem_custo_obra')
ok(fn.includes('ORDER BY o.peso DESC, o.obra_id'), 'mesmo desempate da fonte única')
ok(fn.includes('LEAST(v_v.adiantamento, v_pago_col)') && fn.includes("'reembolso_colaborador'") && fn.includes("'coberto_adiantamento'"), 'colaborador: pago até o adiantamento, o resto em aberto (sem caixa em dobro)')
ok(/'aberto', r\.forma_pagamento[\s\S]*r\.data \+ 30|r\.data \+ 30, 'aberto'/.test(fn), 'a prazo: em aberto, 30 dias')
ok(/FROM public\.v_viagem_custo_obra WHERE viagem_id = p_viagem_id/.test(fn) && fn.includes('RAISE EXCEPTION'), 'confere 1:1 com a fonte única do Resultado; divergência desfaz tudo')
ok((fn.match(/ref_externa_sistema/g) ?? []).length === 4, 'todo título marcado como origem viagem (rastro)')
ok(/REVOKE ALL ON FUNCTION public\.fn_viagem_lancar_ge\(uuid\) FROM PUBLIC, anon;/.test(mig), 'função fechada a anon')

// RD-95
const chaves = ['ge_lancar', 'ge_situacao', 'ge_a_devolver', 'rel_periodo', 'rel_obra', 'rel_viagens', 'rel_km']
for (const k of chaves) ok(mig.includes(`'projetos.viagem.${k}'`), `"?" projetos.viagem.${k} cadastrado`)

// tela
const page = readFileSync('src/app/dashboard/projetos/viagens/page.tsx', 'utf8')
const rel = readFileSync('src/app/dashboard/projetos/viagens/RelatorioViagens.tsx', 'utf8')
ok(page.includes("rpc('fn_viagem_lancar_ge'") && page.includes('chave="projetos.viagem.ge_lancar"'), 'tela: botão Lançar no GE com "?"')
ok(/fn_viagem_fechar[\s\S]{0,120}lancarGe\(id\)/.test(page), 'tela: fechar a viagem já lança no GE')
ok(page.includes('<RelatorioViagens'), 'tela: relatório por obra ligado na lista')
ok(rel.includes("rpc('fn_viagem_relatorio'") && !/\.reduce\(|\*\s*o\.|\/\s*v\.km/.test(rel), 'relatório só lê o fn_viagem_relatorio (a tela não calcula)')
for (const k of ['rel_periodo', 'rel_obra', 'rel_confere', 'rel_custo_obra', 'rel_custo_km', 'rel_total']) ok(rel.includes(`projetos.viagem.${k}`), `relatório: "?" ${k}`)

if (falhas) { console.error(`\n${falhas} falha(s) no gate do lançamento de viagem no GE`); process.exit(1) }
console.log('\ncheck-viagem-lancar-ge: ok')
