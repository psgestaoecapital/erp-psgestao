// Gate (CEO 03/10 · Mão de obra compartilhada + correções do Eng. Chefe). Sem rede.
//  1) REGRA LGPD: fn_mao_obra_custo_hora_usuario só devolve o custo da hora DA PESSOA atrás de
//     fn__mao_obra_pode_ver_individual(empresa) e grava a entrega em erp_mao_obra_acesso_log; para os demais devolve a
//     MÉDIA DA FUNÇÃO (individual = false). O custo real só sai da função interna (sem EXECUTE para authenticated).
//  2) P&M: o apontamento tira o custo da hora da Mão de obra (gatilho definer); o cliente não lê mais custo_hora/custo_total
//     do apontamento (eram o custo de cada pessoa) — as telas leem TOTAIS por job (fn_pm_custo_jobs); agency_equipe.custo_hora
//     não é mais usado (e não é apagado).
//  3) Menu: um item "Mão de obra" por área (sem Restaurante), rota com ?area=, nos planos do módulo principal; tela
//     compartilhada em /dashboard/_compartilhado/mao-obra (pasta %5Fcompartilhado: "_pasta" é privada no App Router).
//  4) Funções-modelo por área; pessoa ↔ usuário; Oficina usa a Mão de obra com o quadro conferido, senão o cálculo atual.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { apontamentosDosTotais, calcularMargem } from '../../src/lib/pm/margem'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const ARQ = 'supabase/migrations/20261003130000_mao_obra_compartilhada.sql'
ok(existsSync(ARQ), `migration ${ARQ}`)
const bruto = existsSync(ARQ) ? readFileSync(ARQ, 'utf8') : ''
const mig = bruto.replace(/--[^\n]*/g, '')
const corpo = (fn: string) => {
  const i = mig.indexOf(`FUNCTION public.${fn}(`)
  if (i < 0) return ''
  const a = mig.indexOf('AS $function$', i)
  return mig.slice(i, mig.indexOf('$function$;', a + 13))
}

// ── 1) LGPD: individual só para quem vê salário + log; os demais, a média da função ──
const cu = corpo('fn_mao_obra_custo_hora_usuario')
ok(cu.length > 0, 'fn_mao_obra_custo_hora_usuario existe')
ok(/PERFORM public\.fn__guarda_empresa\(p_company_id\)/.test(cu), 'custo da hora do usuário: guarda da empresa')
const iPode = cu.indexOf('IF public.fn__mao_obra_pode_ver_individual(p_company_id)')
const iFimPode = cu.indexOf('END IF;\n  RETURN jsonb_build_object', iPode)
const ramoPode = iPode >= 0 && iFimPode > iPode ? cu.slice(iPode, iFimPode) : ''
const resto = iFimPode > 0 ? cu.slice(iFimPode) : cu
ok(ramoPode.length > 0, 'o custo individual fica atrás de fn__mao_obra_pode_ver_individual(empresa)')
ok(/INSERT INTO erp_mao_obra_acesso_log \(company_id, user_id, ficha_id, grupo_id, origem\)[\s\S]*'custo_hora_usuario'/.test(ramoPode) && /auth\.uid\(\)/.test(ramoPode),
  'cada entrega do custo individual grava o log de acesso (quem, quando, qual ficha)')
ok(/'individual', true/.test(ramoPode) && ramoPode.includes("v->'custo_hora_individual'"), 'quem vê salário recebe o individual (individual = true)')
ok(!resto.includes('custo_hora_individual') && !cu.slice(0, Math.max(iPode, 0)).includes('custo_hora_individual'), 'fora do ramo autorizado o valor individual não sai')
ok(/'individual', false, 'tipo', 'media_funcao',[\s\S]*v->'custo_hora_funcao'/.test(resto), 'os demais recebem a MÉDIA DA FUNÇÃO (individual = false)')
ok(/REVOKE ALL ON FUNCTION public\.fn__mao_obra_custo_pessoa\(uuid, uuid, date\) FROM PUBLIC, anon, authenticated;/.test(mig),
  'o custo real da pessoa (função interna) não é executável pelo cliente')
ok(/CHECK \(origem IN \('lista', 'historico', 'custo_hora_usuario'\)\)/.test(mig), 'log de acesso aceita a origem custo_hora_usuario')

// ── 2) P&M ──
const trg = corpo('fn_trg_agency_timesheet_custo_mao_obra')
ok(/SECURITY DEFINER/.test(trg) && trg.includes('public.fn__mao_obra_custo_pessoa(NEW.company_id, NEW.user_id, NEW.data)') && /NEW\.custo_hora := v_h/.test(trg),
  'gatilho do apontamento tira o custo da hora da Mão de obra (definer, pela pessoa ligada ao usuário, na data)')
ok(/CASE WHEN \(v->>'conferido'\)::boolean THEN \(v->>'custo_hora_individual'\)::numeric END/.test(trg) && /COALESCE\(v_h, \(v->>'custo_hora_funcao'\)::numeric\)/.test(trg),
  'ficha conferida → custo real; senão → média da função')
ok(/CREATE OR REPLACE TRIGGER trg_agency_timesheet_custo_mao_obra BEFORE INSERT OR UPDATE OF user_id, data ON public\.agency_timesheet/.test(mig), 'gatilho ligado em agency_timesheet')
const grant = mig.match(/GRANT SELECT \(([^)]*)\) ON public\.agency_timesheet TO authenticated;/)
ok(/REVOKE SELECT ON public\.agency_timesheet FROM anon, authenticated;/.test(mig) && !!grant && !/custo_hora|custo_total/.test(grant?.[1] ?? 'custo'),
  'o cliente não lê custo_hora/custo_total do apontamento (custo da pessoa)')
const jobs = corpo('fn_pm_custo_jobs')
ok(/PERFORM public\.fn__guarda_empresa\(p_company_id\)/.test(jobs) && /GROUP BY job_id/.test(jobs) && !/'custo_hora'/.test(jobs), 'fn_pm_custo_jobs: só totais por job, com guarda da empresa')
ok(!/agency_equipe/i.test(mig.replace(/COMMENT ON[\s\S]*?;/g, '')) && !/DELETE\s+FROM|DROP\s+TABLE|DROP\s+COLUMN/i.test(mig), 'agency_equipe não é tocado; nada é apagado')
const margem = readFileSync('src/app/dashboard/pm/margem-job/page.tsx', 'utf8')
ok(margem.includes("supabase.rpc('fn_pm_custo_jobs'") && !margem.includes("from('agency_equipe')"), 'Margem por Job: totais do banco, sem agency_equipe')
const apont = readFileSync('src/app/dashboard/pm/apontamento-horas/page.tsx', 'utf8')
const insertApont = apont.match(/from\('agency_timesheet'\)\.insert\(\{[\s\S]*?\}\)/)?.[0] ?? ''
ok(!apont.includes("from('agency_equipe')") && insertApont.length > 0 && !/custo_hora/.test(insertApont) && !/select\([^)]*custo_total/.test(apont),
  'Apontamento: não lê agency_equipe, não manda custo_hora, não mostra custo por lançamento')
ok(apont.includes("fn_mao_obra_custo_hora_usuario"), 'Apontamento mostra o custo da hora do usuário pela regra LGPD')
ok(!/from\('agency_timesheet'\)\.select\('\*'\)/.test(readFileSync('src/app/dashboard/producao/page.tsx', 'utf8')), 'Produção não lê todas as colunas do apontamento')
const t = apontamentosDosTotais([{ job_id: 'j1', horas: 5, horas_sem_custo: 0, custo: 400 }, { job_id: 'j2', horas: 3, horas_sem_custo: 1, custo: 100 }])
const m1 = calcularMargem({ id: 'j1', valor_job: 1000, custo_estimado: null }, t)
const m2 = calcularMargem({ id: 'j2', valor_job: 1000, custo_estimado: null }, t)
ok(m1.situacao === 'ok' && m1.custo === 400 && m1.lucro === 600 && m2.situacao === 'sem_custo_hora' && m2.horasSemCusto === 1,
  'margem pelos totais do job = mesma regra (job com hora sem custo pede o cadastro)')

// ── 3) menu, planos e tela compartilhada ──
const AREAS: [string, string, string][] = [['pm_mao_obra', 'pm', 'pm_jobs'], ['industrial_mao_obra', 'industrial', 'industrial'], ['oficina_mao_obra', 'oficina', 'oficina_os'],
  ['odonto_mao_obra', 'odonto', 'odonto_agenda'], ['agro_mao_obra', 'agro', 'agro_dashboard'], ['ge_mao_obra', 'gestao_empresarial', 'ge_painel_geral']]
for (const [id, area, principal] of AREAS) {
  ok(new RegExp(`\\('${id}', 'Mão de obra', '${area}', '[a-z_]+', 'HardHat', '/dashboard/_compartilhado/mao-obra\\?area=${area}'`).test(mig), `menu: ${id} → /dashboard/_compartilhado/mao-obra?area=${area}`)
  ok(mig.includes(`('${id}', '${principal}')`), `planos: ${id} nos planos de ${principal}`)
}
ok(!/restaurante/i.test(mig), 'sem Restaurante (área não existe)')
ok(/UPDATE public\.module_catalog SET ativo = true\s+WHERE id IN \('pm_mao_obra'/.test(mig) && (mig.match(/_mao_obra', 'Mão de obra', [^\n]*, \d+, false,/g) ?? []).length === 6,
  'itens entram inativos e são ativados depois dos planos (o gatilho de planos não espalha o item por planos de outras áreas)')
ok(!/'projetos_mao_obra'/.test(mig), 'item do Hub (projetos_mao_obra) intacto')
ok(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/_compartilhado\/mao-obra'/.test(mig), 'system_screens: uma linha para a tela compartilhada')
const rota = 'src/app/dashboard/%5Fcompartilhado/mao-obra/page.tsx'
ok(existsSync(rota) && readFileSync(rota, 'utf8').includes('<MaoObraTela area='), 'rota /dashboard/_compartilhado/mao-obra (pasta %5Fcompartilhado) renderiza a tela compartilhada')
ok(!existsSync('src/app/dashboard/_compartilhado') || readdirSync('src/app/dashboard/_compartilhado').length === 0, 'nenhuma tela em pasta privada _compartilhado (daria 404)')
ok(readFileSync('src/app/dashboard/projetos/mao-obra/page.tsx', 'utf8').includes('<MaoObraTela area="hub" />'), '/dashboard/projetos/mao-obra continua, com a mesma tela')
const tela = readFileSync('src/components/mao-obra/MaoObraTela.tsx', 'utf8')
ok(tela.includes('<AjudaRota rota={ROTA_AJUDA}>') && tela.includes('const ROTA_AJUDA = "/dashboard/projetos/mao-obra"'), 'na rota compartilhada o "?" lê os textos da Mão de obra')
for (const tid of ['mao-obra-area', 'mao-obra-painel-modelos', 'mao-obra-modelo-area', 'mao-obra-funcoes-modelo', 'pessoa-usuario', 'mao-obra-ligar-usuario', 'usuario-select', 'mao-obra-usuario']) {
  ok(tela.includes(`data-testid="${tid}"`), `tela: ${tid}`)
}
ok(tela.includes('"fn_mao_obra_funcoes_modelo", { p_company_id: companyId, p_area: areaUsada }'), 'tela pede as funções-modelo da área')

// ── 4) funções-modelo, pessoa ↔ usuário, Oficina ──
const MODELOS: Record<string, string[]> = {
  pm: ['Designer', 'Social media', 'Redator', 'Editor de vídeo', 'Atendimento', 'Tráfego'],
  industrial: ['Operador', 'Auxiliar de produção', 'Desossador', 'Magarefe', 'Manutenção'],
  oficina: ['Mecânico', 'Eletricista', 'Funileiro'],
  odonto: ['Dentista', 'Auxiliar de saúde bucal', 'Recepcionista'],
  agro: ['Operador de máquinas', 'Tratorista', 'Auxiliar rural'],
  ge: ['Auxiliar administrativo', 'Vendedor', 'Financeiro'],
  hub: ['Servente', 'Pedreiro', 'Gesseiro', 'Pintor', 'Mestre de obras', 'Engenheiro'],
}
const modelos = corpo('fn__mao_obra_modelos')
for (const [area, nomes] of Object.entries(MODELOS)) ok(nomes.every((n) => modelos.includes(`('${area}', `) && new RegExp(`\\('${area}', \\d+, '${n}'`).test(modelos)), `funções-modelo de ${area}: ${nomes.join(', ')}`)
ok(!/custo_hora_manual/.test(corpo('fn_mao_obra_funcoes_modelo')) && /'precisa_area', true/.test(corpo('fn_mao_obra_funcoes_modelo')), 'funções-modelo: sem custo inventado; várias áreas → a tela pergunta')
ok(/FUNCTION public\.fn_mao_obra_funcoes_modelo\(p_company_id uuid, p_area text\)/.test(mig) && /RETURN public\.fn_mao_obra_funcoes_modelo\(p_company_id, NULL::text\);/.test(mig) && !/DROP\s+FUNCTION/i.test(mig),
  'assinatura nova (empresa, área) sem DEFAULT; a antiga chama a nova (sem DROP, sem ambiguidade de sobrecarga)')
ok(/ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public\.users\(id\) ON DELETE SET NULL/.test(mig) && /ux_compliance_funcionarios_user ON public\.compliance_funcionarios \(company_id, user_id\) WHERE user_id IS NOT NULL/.test(mig),
  'compliance_funcionarios.user_id opcional, único por empresa')
ok(/NOT public\.fn__mao_obra_pode_ver_individual\(NEW\.company_id\)/.test(corpo('fn_trg_funcionario_usuario_guarda')), 'ligar pessoa ↔ usuário: só quem vê salário (também direto na tabela)')
const of = corpo('fn_oficina_custo_hora')
ok(of.includes('public.fn__mao_obra_quadro_custo(p_company_id)') && /ELSIF v_mo_ok AND v_mo_custo IS NOT NULL THEN\s+v_origem := 'mao_obra';/.test(of)
  && /v_origem := 'calculado';/.test(of) && /'aviso_origem'/.test(of), 'Oficina: Mão de obra com quadro conferido; senão o cálculo atual com aviso de origem')

// ── toda função SECURITY DEFINER: search_path + REVOKE separado ──
for (const m of mig.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?AS \$function\$/g)) {
  const cab = m[0]
  if (!/SECURITY DEFINER/.test(cab)) continue
  ok(/SET search_path TO 'public'/.test(cab), `${m[1]}: SET search_path TO 'public'`)
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${m[1]}\\([^)]*\\) FROM PUBLIC, anon`).test(mig), `${m[1]}: REVOKE ... FROM PUBLIC, anon`)
}

// ── aceitação depois da migration ──
const spec = 'e2e/jornadas/aceitacao/mao-obra-compartilhada.spec.ts'
ok(existsSync(spec) && /tag: '@pos-migration'/.test(readFileSync(spec, 'utf8')), 'teste de aceitação @pos-migration')

if (falhas) { console.error(`\ncheck-mao-obra-compartilhada: ${falhas} falha(s)`); process.exit(1) }
console.log('\nMão de obra compartilhada: ok')
