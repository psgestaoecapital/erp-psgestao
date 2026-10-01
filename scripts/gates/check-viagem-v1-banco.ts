// Gate (CEO 01/10 · tela de viagem da FC, fase V1 — banco): um registro de viagem só (administrativo, celular e
// planilha), lançamentos com a obra de cada um, e o resumo/prestação de contas com as MESMAS contas da planilha
// (src/lib/viagem/modeloPlanilha.ts). Tudo por empresa, gravação só pelas funções com guarda, exclusão lógica. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261001210000_viagem_v1_banco.sql', 'utf8').replace(/--[^\n]*/g, '')
const corpoDe = (fn: string): string => {
  const i = mig.search(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.` + fn + String.raw`\(`))
  if (i < 0) return ''
  const fim = mig.indexOf('$function$;', i)
  return mig.slice(i, fim < 0 ? undefined : fim)
}
const tabela = (t: string): string => { const i = mig.indexOf(`CREATE TABLE IF NOT EXISTS public.${t} (`); return i < 0 ? '' : mig.slice(i, mig.indexOf(');', i)) }

// tabelas: empresa, RLS, nada para anon, gravação só por função (sem GRANT de INSERT/UPDATE/DELETE)
for (const t of ['erp_viagem_config', 'erp_viagem', 'erp_viagem_lancamento']) {
  ok(/company_id\s+uuid (NOT NULL|PRIMARY KEY) REFERENCES public\.companies\(id\)/.test(tabela(t)), `${t}: company_id`)
  ok(mig.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`), `${t}: RLS ligada`)
}
ok(/REVOKE ALL ON public\.erp_viagem_config, public\.erp_viagem, public\.erp_viagem_lancamento FROM PUBLIC, anon;/.test(mig), 'fechado a quem não está logado')
ok(/GRANT SELECT ON public\.erp_viagem_config, public\.erp_viagem, public\.erp_viagem_lancamento TO authenticated;/.test(mig)
  && !/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*erp_viagem/.test(mig), 'leitura pela empresa; gravação só pelas funções')
ok(!/\bDELETE\b/.test(mig.replace(/ON DELETE (CASCADE|SET NULL)/g, '')), 'nada se apaga (exclusão lógica · RD-30)')

// a viagem
const v = tabela('erp_viagem')
ok(/obra_id\s+uuid NOT NULL REFERENCES public\.projetos_obras/.test(v), 'viagem tem obra (centro de custo = obra)')
ok(/UNIQUE \(company_id, numero\)/.test(v), 'número da viagem único por empresa')
ok(v.includes("origem_registro IN ('administrativo', 'campo', 'planilha')"), 'um registro só para administrativo, celular e planilha')
ok(v.includes('CHECK (periodo_fim >= periodo_inicio)') && v.includes('km_final >= km_inicial'), 'período e km coerentes')
const l = tabela('erp_viagem_lancamento')
ok(/obra_id\s+uuid NOT NULL REFERENCES public\.projetos_obras/.test(l), 'cada lançamento com a sua obra (rateio entre obras)')
ok(l.includes("forma_pagamento IN ('dinheiro', 'cartao_empresa', 'cartao_proprio', 'pix', 'a_prazo')"), 'formas de pagamento = as da planilha')
ok(l.includes('valor > 0') && l.includes("tipo <> 'abastecimento' OR (litros > 0 AND hodometro IS NOT NULL)"), 'valor > 0; abastecimento com litros e hodômetro')
ok(/pagar_id\s+uuid/.test(l), 'lugar do título gerado no fechamento (V2), para não duplicar')

// funções: guarda de empresa antes de gravar; regras iguais às da planilha
for (const [fn, alvo] of [['fn_viagem_salvar', 'p_company_id'], ['fn_viagem_lancamento_salvar', 'v_v.company_id'], ['fn_viagem_lancamento_excluir', 'v_l.company_id'], ['fn_viagem_config_salvar', 'p_company_id']] as const) {
  const c = corpoDe(fn)
  const iG = c.indexOf(`PERFORM public.fn__guarda_empresa(${alvo})`)
  const iW = c.search(/\b(INSERT INTO|UPDATE public\.erp_viagem)/)
  ok(/SECURITY DEFINER/.test(c) && iG > 0 && (iW < 0 || iG < iW), `${fn}: confere a empresa antes de gravar`)
  ok(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.` + fn + String.raw`\([^)]*\) FROM PUBLIC, anon;`).test(mig), `${fn}: fechada a anon`)
}
const lanc = corpoDe('fn_viagem_lancamento_salvar')
ok(lanc.includes("v_v.status <> 'aberta'"), 'viagem fechada não recebe lançamento')
ok(lanc.includes('v_data < v_v.periodo_inicio OR v_data > v_v.periodo_fim'), 'data dentro do período (como na planilha)')
ok(lanc.includes('FROM public.erp_plano_contas c WHERE c.company_id = v_v.company_id AND c.codigo = v_cat'), 'categoria = código gerencial da empresa')
ok(lanc.includes('v_hod < v_v.km_inicial') && lanc.includes('v_hod > v_v.km_final'), 'hodômetro dentro do km da viagem')
ok(lanc.includes("COALESCE(v_cfg.cat_combustivel, '2.06')"), 'combustível cai na categoria configurada (padrão 2.06)')
ok(!/v_erros := v_erros \|\|/.test(lanc) && (lanc.match(/array_append\(v_erros,/g) ?? []).length >= 8, 'erros juntados com array_append (o || quebrava a lista)')
ok(corpoDe('fn_viagem_lancamento_excluir').includes('SET excluido_em = now()'), 'excluir lançamento = exclusão lógica')
ok(corpoDe('fn_viagem_config_salvar').includes('fn_acessos_pode_gerir(p_company_id)'), 'configuração da viagem só o gestor altera')

// resumo = as contas da planilha
const res = corpoDe('fn_viagem_resumo')
ok(/SECURITY INVOKER/.test(res), 'resumo roda com a RLS de quem chama')
ok(res.includes("FILTER (WHERE forma_pagamento = 'a_prazo')") && res.includes("'a_vista', round(t.total - t.a_prazo, 2)"), 'a prazo e à vista como na planilha')
ok(res.includes("round((SELECT adiantamento FROM v) - t.pago_colaborador, 2)"), 'saldo = adiantamento − pago pelo colaborador')
ok(res.includes("'colaborador devolve à empresa'") && res.includes("'empresa reembolsa o colaborador'"), 'texto do saldo como na planilha')
ok(res.includes('round(k.km / t.litros, 2)') && res.includes('round(t.total / k.km, 2)'), 'média km/l e custo/km como na planilha')
const planilha = readFileSync('src/lib/viagem/modeloPlanilha.ts', 'utf8')
ok(planilha.includes('saldo: r2(cabecalho.adiantamento_recebido - pago_colaborador)') && planilha.includes("filter((x) => x.forma_pagamento === 'a_prazo')"),
  'a planilha usa a mesma regra (contrato único)')

if (falhas) { console.error(`\ncheck-viagem-v1-banco: ${falhas} falha(s)`); process.exit(1) }
console.log('\nViagem V1 · banco: ok')
