// Gate (Hub · Mão de obra, SPEC E1+E2 rev.15 seção 5 · CEO aprovou a lista do banco 01/10): funções + equipe (pessoa ou
// perfil padrão) com custo real; encargos por empresa (com desoneração/CPRB) "provisórios" até o contador confirmar;
// custo da função = média do grupo só com fichas conferidas; salário individual só para gestor/financeiro (LGPD). Sem rede.
import { readFileSync } from 'node:fs'
import { calcularCustoMaoObra, encargosFolhaPct, fatorFolhaReoneracao } from '../../src/lib/hub/custoMaoObra'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── a conta (a mesma do banco) ──
const padrao = { prov_13_pct: 8.33, prov_ferias_pct: 11.11, prov_rescisao_pct: 4 }
const exSpec = calcularCustoMaoObra({ vinculo: 'clt', forma_pagamento: 'mensal', salario: 2800, beneficio_vt: 300, beneficio_alimentacao: 500, horas_produtivas_mes: 176 },
  { ...padrao, encargos_folha_pct: 36.8 })
ok(exSpec.custo_mensal === 5487.03 && exSpec.custo_hora === 31.18, `exemplo da SPEC: R$ 2.800 (Lucro Real 36,8%, benefícios R$ 800) → R$ 5.487,03/mês · R$ 31,18/h (deu ${exSpec.custo_mensal} · ${exSpec.custo_hora})`)
ok(encargosFolhaPct({ inss_patronal_pct: 20, desoneracao_fator_folha: 1, rat_pct: 3, fap: 1, terceiros_pct: 5.8, fgts_pct: 8 }) === 36.8, 'presumido/real: 20 + 3 + 5,8 + 8 = 36,8%')
ok(encargosFolhaPct({ inss_patronal_pct: 20, desoneracao_fator_folha: 1, rat_pct: 3, fap: 1, terceiros_pct: 0, fgts_pct: 8 }) === 31, 'Simples sem anexo (Anexo IV assumido): 31%')
ok(encargosFolhaPct({ inss_patronal_pct: 20, desoneracao_fator_folha: 0.5, rat_pct: 3, fap: 1, terceiros_pct: 5.8, fgts_pct: 8 }) === 26.8, 'desoneração 2026: metade do INSS patronal volta à folha (26,8%)')
ok(fatorFolhaReoneracao(2025) === 0.25 && fatorFolhaReoneracao(2026) === 0.5 && fatorFolhaReoneracao(2027) === 0.75 && fatorFolhaReoneracao(2028) === 1, 'reoneração gradual (Lei 14.973/2024): 25% · 50% · 75% · 100%')
const pjHora = calcularCustoMaoObra({ vinculo: 'pj', forma_pagamento: 'hora', valor_unidade: 40, horas_produtivas_mes: 176 }, { ...padrao, encargos_folha_pct: 36.8 })
ok(pjHora.custo_hora === 40 && pjHora.encargos === 0, 'PJ por hora: custo é o valor/hora, sem encargos de folha')
const pjM2 = calcularCustoMaoObra({ vinculo: 'pj', forma_pagamento: 'm2', valor_unidade: 18 }, { ...padrao, encargos_folha_pct: 36.8 })
ok(pjM2.custo_m2 === 18 && pjM2.custo_hora === null, 'PJ por m²: só custo do m² (não inventa hora)')
const diar = calcularCustoMaoObra({ vinculo: 'diarista', forma_pagamento: 'diaria', valor_unidade: 150, dias_mes: 20, horas_produtivas_mes: 160 }, { ...padrao, encargos_folha_pct: 36.8 })
ok(diar.custo_mensal === 3000 && diar.custo_hora === 18.75, 'diarista: diária × dias ÷ horas')

// ── o banco ──
const mig = readFileSync('supabase/migrations/20261002100000_hub_mao_obra.sql', 'utf8')
const sql = mig.replace(/--[^\n]*/g, '')
const corpo = (fn: string) => { const i = sql.indexOf(`FUNCTION public.${fn}(`); return sql.slice(i, sql.indexOf('$function$;', i)) }
ok(!/DELETE\s+FROM/i.test(sql), 'nada é apagado (RD-30): excluir = desligar/inativar com vigência')
ok(/role IN \('owner', 'socio', 'diretor', 'gerente', 'financeiro', 'admin', 'adm', 'acesso_total'\)/.test(sql), 'LGPD: salário individual só para owner/sócio/diretor/gerente/financeiro/admin da empresa que emprega')
ok(/CREATE POLICY mao_obra_custo_select[\s\S]{0,200}fn__mao_obra_pode_ver_individual/.test(sql), 'LGPD também na tabela (RLS): quem não pode não lê a ficha nem por consulta direta')
ok(/REVOKE INSERT, UPDATE, DELETE ON public\.erp_funcao_mao_obra, public\.erp_encargos_empresa, public\.erp_mao_obra_custo, public\.erp_mao_obra_acesso_log FROM authenticated/.test(sql), 'escrita só pelas funções (com guarda)')
// CEO 01/10: adm/acesso_total veem salário só no papel DA empresa que emprega, e toda abertura fica no log
ok(/uc\.user_id = auth\.uid\(\) AND uc\.company_id = p_company_id/.test(sql), 'papel vale só na PRÓPRIA empresa que emprega (papel em outra empresa não vale)')
ok(/REVOKE SELECT ON public\.erp_mao_obra_custo FROM authenticated/.test(sql) && !/GRANT SELECT ON[^;]*erp_mao_obra_custo[^;]*TO authenticated/.test(sql), 'ficha (salário) não é lida direto da tabela: só pelas funções que gravam o log')
ok(/CREATE TABLE IF NOT EXISTS public\.erp_mao_obra_acesso_log[\s\S]{0,400}user_id uuid NOT NULL[\s\S]{0,200}ficha_id uuid NOT NULL[\s\S]{0,300}em timestamptz NOT NULL DEFAULT now\(\)/.test(sql), 'log de abertura: quem, qual ficha, quando')
const listar = corpo('fn_mao_obra_listar')
ok(/'ficha', CASE WHEN v_pode/.test(listar) && /'custo', CASE WHEN v_pode/.test(listar), 'a lista esconde ficha e custo individual de quem não pode (vê só a média da função)')
ok(/IF v_pode AND auth\.uid\(\) IS NOT NULL THEN\s+INSERT INTO erp_mao_obra_acesso_log[\s\S]{0,200}'lista'/.test(listar) && /VOLATILE/.test(listar), 'a lista grava no log cada ficha com salário mostrada')
ok(/INSERT INTO erp_mao_obra_acesso_log[\s\S]{0,200}'historico'/.test(corpo('fn_mao_obra_ficha_historico')) && /VOLATILE/.test(corpo('fn_mao_obra_ficha_historico')), 'o histórico (reajustes) também grava no log')
const media = corpo('fn_funcao_custo_hora')
ok(/IF NOT r\.conferido THEN v_pend := v_pend \+ 1; CONTINUE; END IF;/.test(media), 'não conferido NÃO entra no custo da função')
ok(media.includes('c2.group_id = c1.group_id') && media.includes('r.horas_produtivas_mes * r.quantidade_pessoas'), 'média do GRUPO, ponderada por horas × pessoas')
ok(corpo('fn__mao_obra_funcao_chave').includes("regexp_replace(COALESCE(r.cbo, ''), '\\D', '', 'g')") && corpo('fn__mao_obra_funcao_chave').includes('unaccent'), 'função casa no grupo pelo CBO (se houver) ou pelo nome sem acento; "unir" junta parecidas')
const enc = corpo('fn_mao_obra_encargos_vigentes')
ok(/'provisorio', e\.confirmado_em IS NULL/.test(enc) && /'fonte', 'padrao_regime', 'provisorio', true/.test(enc), 'encargos "provisórios" até o contador confirmar')
ok(enc.includes('e.inss_patronal_pct * e.desoneracao_fator_folha'), 'desoneração: só a parte da folha do INSS patronal entra no custo')
const calc = corpo('fn_mao_obra_custo_calcular')
for (const d of ["'prov_13_pct')::numeric, 8.33", "'prov_ferias_pct')::numeric, 11.11", "'prov_rescisao_pct')::numeric, 4", "'encargos_folha_pct')::numeric, 36.8", "'dias_mes')::numeric, 22", "'horas_produtivas_mes')::numeric, 176"]) {
  ok(calc.includes(d), `banco e tela com o mesmo padrão: ${d.split("'")[1]}`)
}
for (const fn of ['fn_mao_obra_funcao_salvar', 'fn_mao_obra_funcao_unir', 'fn_mao_obra_encargos_salvar', 'fn_mao_obra_ficha_salvar', 'fn_mao_obra_ficha_reajustar', 'fn_mao_obra_ficha_conferir', 'fn_mao_obra_ficha_encerrar']) {
  const c = corpo(fn)
  ok(c.includes('PERFORM public.fn__guarda_empresa(') && c.includes('PERFORM public.fn__mao_obra_exige_gestor('), `${fn}: guarda da empresa + só gestor/financeiro`)
}
ok(/n\.conferido := false/.test(corpo('fn_mao_obra_ficha_reajustar')) && /UPDATE erp_mao_obra_custo SET vigencia_fim = v_vig - 1/.test(corpo('fn_mao_obra_ficha_reajustar')), 'reajuste = nova vigência com histórico, volta a "não conferido"')
ok(/UPDATE compliance_funcionarios SET data_demissao = v_data, ativo = false/.test(corpo('fn_mao_obra_ficha_encerrar')), 'desligar pessoa grava a demissão no cadastro compartilhado (o mesmo do SST)')
const aplicar = corpo('fn_mao_obra_migrar_aplicar')
ok(aplicar.includes('NOT public.is_admin()') && sql.includes('REVOKE ALL ON FUNCTION public.fn_mao_obra_migrar_aplicar(uuid, boolean) FROM PUBLIC, anon, authenticated;'), 'migração das funções antigas só com o OK do CEO (admin PS / service_role)')
ok(/IF p_criar_perfil THEN/.test(aplicar) && aplicar.includes('conferir antes de valer'), 'perfil com salário estimado só se o CEO escolher (opção B) e entra NÃO conferido')
ok(/custo_hora_manual, projetos_mao_obra_id\)/.test(aplicar), 'função migrada guarda o R$/h atual como custo manual (composições não mudam de valor)')
ok(!/xlsx|importar_planilha/i.test(sql), 'sem importação por planilha (CEO cancelou o xlsx: cadastro manual e conferido)')

// ── a tela ──
const tela = readFileSync('src/app/dashboard/projetos/mao-obra/page.tsx', 'utf8')
ok(tela.includes("from \"@/lib/hub/custoMaoObra\"") && tela.includes('calcularCustoMaoObra(ficha, encargos)'), 'a tela mostra o custo com a mesma conta do banco enquanto digita')
ok(tela.includes('data-testid="mao-obra-encargos"') && /provisórios/.test(tela), 'aviso de encargos provisórios na tela')
ok(tela.includes('data-testid="mao-obra-lgpd"'), 'aviso LGPD para quem vê só a média')
for (const t of ['mao-obra-novo-funcionario', 'mao-obra-novo-perfil', 'mao-obra-nova-funcao', 'mao-obra-conferir', 'mao-obra-editar', 'mao-obra-encerrar']) ok(tela.includes(`data-testid="${t}"`), `ação na tela: ${t}`)
ok(!/\.from\("erp_mao_obra_custo"\)\.(insert|update|delete)/.test(tela), 'a tela não grava direto na tabela (só pelas funções)')

if (falhas) { console.error(`\ncheck-hub-mao-obra: ${falhas} falha(s)`); process.exit(1) }
console.log('\nHub · Mão de obra: ok')
