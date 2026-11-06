// Gate (Eng. Chefe 24/10 · prioridade terça): custo de viagem por obra num lugar só. O rateio divide em centavos e a
// sobra vai para a obra de maior peso (Σ por obra = Σ dos cupons); viagem cancelada/excluída não entra; o Resultado da
// obra lê a MESMA view (1:1 com o relatório); gravação só por função com guarda; "?" nos campos novos. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261025080052_viagem_custo_rateio_obra.sql', 'utf8').replace(/--[^\n]*/g, '')
const corpoDe = (fn: string): string => {
  const i = mig.search(new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.` + fn + String.raw`\(`))
  if (i < 0) return ''
  const fim = mig.indexOf('$function$;', i)
  return mig.slice(i, fim < 0 ? undefined : fim)
}
const viewDe = (v: string): string => {
  const i = mig.indexOf(`CREATE OR REPLACE VIEW public.${v}`)
  return i < 0 ? '' : mig.slice(i, mig.indexOf(';', i))
}

// tabela de obras/pesos: empresa, RLS, fechada a anon, gravação só por função
const t = mig.slice(mig.indexOf('CREATE TABLE IF NOT EXISTS public.erp_viagem_obra ('), mig.indexOf(');', mig.indexOf('CREATE TABLE IF NOT EXISTS public.erp_viagem_obra (')))
ok(/company_id\s+uuid NOT NULL REFERENCES public\.companies\(id\)/.test(t), 'erp_viagem_obra: company_id')
ok(t.includes("criterio IN ('km', 'dias', 'percentual')") && t.includes('peso > 0'), 'critério km/dias/percentual e peso > 0')
ok(mig.includes('ALTER TABLE public.erp_viagem_obra ENABLE ROW LEVEL SECURITY;') && mig.includes('REVOKE ALL ON public.erp_viagem_obra FROM PUBLIC, anon;'), 'RLS ligada e fechada a anon')
ok(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*erp_viagem_obra/.test(mig), 'gravação só pelas funções')
ok(!/\bDELETE\b/.test(mig.replace(/ON DELETE (CASCADE|SET NULL)/g, '')), 'nada se apaga (exclusão lógica · RD-30)')
ok(/ADD COLUMN IF NOT EXISTS rateio boolean NOT NULL DEFAULT false/.test(mig), 'cupom compartilhado: coluna nova, padrão = como hoje')

// fonte única
const fonte = viewDe('v_viagem_custo_obra')
ok(/security_invoker = true/.test(fonte), 'v_viagem_custo_obra respeita a RLS de quem lê')
ok(fonte.includes("status <> 'cancelada'") && fonte.includes('excluido_em IS NULL'), 'viagem cancelada ou excluída não entra')
ok(fonte.includes('round(l.valor * p.peso / p.peso_total, 2)'), 'cota = valor × peso ÷ Σ pesos, em centavos')
ok(fonte.includes('CASE WHEN c.ordem = 1 THEN c.valor - sum(c.cota) OVER (PARTITION BY c.id) ELSE 0 END'), 'sobra dos centavos na obra de maior peso (Σ cotas = cupom)')
ok(fonte.includes('ORDER BY o.peso DESC, o.obra_id'), 'desempate determinístico da obra que recebe a sobra')
ok(fonte.includes('WHERE NOT l.rateio OR NOT EXISTS (SELECT 1 FROM p WHERE p.viagem_id = l.viagem_id)'), 'sem rateio (ou sem obras de rateio): cupom inteiro na obra dele')
ok(mig.includes('REVOKE ALL ON public.v_viagem_custo_obra FROM PUBLIC, anon;'), 'fonte fechada a anon')

// Resultado da obra lê a mesma fonte, mesmas colunas
const res = viewDe('v_obra_resultado')
ok(/security_invoker = true/.test(res), 'v_obra_resultado continua security_invoker')
ok(res.includes('SUM(custo_total) AS valor FROM public.v_viagem_custo_obra'), 'custo_viagens do Resultado = a fonte única (1:1)')
ok(!res.includes('FROM public.erp_viagem_lancamento'), 'Resultado não soma cupom por fora da fonte única')
const cols = ['obra_id', 'company_id', 'numero', 'nome', 'status', 'custo_previsto', 'receita_prevista', 'receita_servico', 'receita_material', 'custo_material', 'custo_viagens', 'margem_realizada']
const posicoes = cols.map((c) => res.search(new RegExp(String.raw`(AS ${c}\b|o\.${c},)`)))
ok(posicoes.every((p, i) => p > 0 && (i === 0 || p > posicoes[i - 1])), 'v_obra_resultado: mesmas colunas na mesma ordem (a v_obra_resultado_alocado depende dela)')

// funções de gravação: guarda antes de gravar, só viagem aberta, fechadas a anon
for (const [fn, alvo] of [['fn_viagem_rateio_salvar', 'v_v.company_id'], ['fn_viagem_lancamento_rateio', 'v_l.company_id']] as const) {
  const c = corpoDe(fn)
  const iG = c.indexOf(`PERFORM public.fn__guarda_empresa(${alvo})`)
  const iW = c.search(/\b(INSERT INTO|UPDATE public\.erp_viagem)/)
  ok(/SECURITY DEFINER/.test(c) && iG > 0 && iW > iG, `${fn}: confere a empresa antes de gravar`)
  ok(/status <> 'aberta'/.test(c), `${fn}: viagem fechada não se altera`)
  ok(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.` + fn + String.raw`\([^)]*\) FROM PUBLIC, anon;`).test(mig), `${fn}: fechada a anon`)
}
const rs = corpoDe('fn_viagem_rateio_salvar')
ok(rs.includes('o.company_id = v_v.company_id'), 'rateio só para obra da mesma empresa')
ok(rs.includes("v_soma IS DISTINCT FROM 100"), 'percentual tem de somar 100')
ok(rs.includes('obra: repetida na lista'), 'obra repetida recusada')
ok(rs.includes('SET excluido_em = now()'), 'regravar o rateio = substitui o conjunto (exclusão lógica)')

// relatório
const rel = corpoDe('fn_viagem_relatorio')
ok(/SECURITY INVOKER/.test(rel), 'relatório roda com a RLS de quem chama')
ok(rel.includes('public.v_viagem_custo_obra') && rel.includes('public.v_obra_resultado'), 'relatório lê a fonte única e confere com o Resultado')
ok(rel.includes("'confere', po.custo_todas_viagens = po.custo_no_resultado"), 'conferência 1:1 por obra')
ok(rel.includes('round(pv.total / pv.km, 2)') && rel.includes('round(pv.km / pv.litros, 2)') && rel.includes('round(pv.adiantamento - pv.pago_colaborador, 2)'),
  'custo/km, consumo e saldo = as contas do fn_viagem_resumo')
ok(/REVOKE ALL ON FUNCTION public\.fn_viagem_relatorio\([^)]*\) FROM PUBLIC, anon;/.test(mig), 'relatório fechado a anon')

// RD-95: "?" dos campos novos
for (const k of ['lanc_rateio', 'rateio_criterio', 'rateio_obra', 'rateio_peso', 'rel_total', 'rel_custo_km', 'rel_custo_obra', 'rel_confere']) {
  ok(mig.includes(`'projetos.viagem.${k}'`), `"?" projetos.viagem.${k}`)
}

if (falhas) { console.error(`\n${falhas} falha(s) no gate de custo de viagem por obra`); process.exit(1) }
console.log('\ncheck-viagem-custo-obra: ok')
