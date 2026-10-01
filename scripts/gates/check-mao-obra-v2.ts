// Gate (Mão de obra v2 · CEO 01/10): obrigatórios com CPF válido, ajuste por ficha (encargos/13º/férias/rescisão) com
// quem/quando e "voltar ao padrão", padrões da empresa na ficha nova e salário sugerido da função. Sem rede.
import { readFileSync } from 'node:fs'
import { cpfValido, mascaraCpf } from '../../src/lib/documentos/cpf'
import { calcularCustoMaoObra } from '../../src/lib/hub/custoMaoObra'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(cpfValido('529.982.247-25') && cpfValido('52998224725'), 'CPF válido passa (com ou sem máscara)')
ok(!cpfValido('529.982.247-24') && !cpfValido('111.111.111-11') && !cpfValido('1234'), 'CPF com dígito errado, repetido ou curto é recusado')
ok(mascaraCpf('52998224725') === '529.982.247-25', 'máscara do CPF enquanto digita')

const enc = { prov_13_pct: 8.33, prov_ferias_pct: 11.11, prov_rescisao_pct: 4, encargos_folha_pct: 31 }
const padrao = calcularCustoMaoObra({ vinculo: 'clt', forma_pagamento: 'mensal', salario: 2800 }, enc)
const ajustado = calcularCustoMaoObra({ vinculo: 'clt', forma_pagamento: 'mensal', salario: 2800, encargos_folha_pct_ajuste: 40 }, enc)
ok(padrao.encargos_folha_pct === 31 && ajustado.encargos_folha_pct === 40, 'ajuste da ficha vence o padrão da empresa (encargos %)')
ok(ajustado.custo_mensal === 4794.05, `ajuste de encargos para 40% → R$ 4.794,05 (deu ${ajustado.custo_mensal}, igual ao banco)`)
ok(calcularCustoMaoObra({ vinculo: 'clt', salario: 2800, encargos_folha_pct_ajuste: null }, enc).custo_mensal === padrao.custo_mensal, 'sem ajuste (null) = padrão da empresa')

const mig = readFileSync('supabase/migrations/20261002130000_mao_obra_padroes_ajustes.sql', 'utf8').replace(/--[^\n]*/g, '')
const salvar = mig.slice(mig.indexOf('FUNCTION public.fn_mao_obra_ficha_salvar'), mig.indexOf('FUNCTION public.fn_mao_obra_ficha_reajustar'))
ok(salvar.includes("IF NOT public.fn__cpf_valido(v_cpf) THEN RAISE EXCEPTION 'CPF inválido"), 'banco recusa CPF inválido')
ok(salvar.includes("RAISE EXCEPTION 'Informe a data de admissão.'"), 'banco exige data de admissão (pessoa)')
ok(salvar.includes("'Informe o salário médio.'") && salvar.includes("'Informe o salário base.'") && salvar.includes("Informe o valor %."), 'banco exige salário base / médio ou valor da diária, m² ou hora')
ok(salvar.includes("Informe o vínculo"), 'banco exige vínculo')
ok(/CASE WHEN v_tem_ajuste THEN auth\.uid\(\) END, CASE WHEN v_tem_ajuste THEN now\(\) END/.test(salvar), 'ajuste na ficha registra quem e quando')
const reaj = mig.slice(mig.indexOf('FUNCTION public.fn_mao_obra_ficha_reajustar'))
ok(/n\.ajuste_por := NULL; n\.ajuste_em := NULL;/.test(reaj) && reaj.includes('c || aj'), '"voltar ao padrão" (null explícito) limpa o ajuste e quem/quando')
ok(/p13 numeric := COALESCE\(\(p_ficha->>'prov_13_pct_ajuste'\)::numeric/.test(mig) && /encp numeric := COALESCE\(\(p_ficha->>'encargos_folha_pct_ajuste'\)::numeric/.test(mig), 'cálculo do banco usa o ajuste da ficha (média da função também)')
ok(/'salario_sugerido', CASE WHEN v_pode THEN/.test(mig), 'salário sugerido só para quem vê salário (LGPD)')
ok(mig.includes("REVOKE ALL ON FUNCTION public.fn__mao_obra_salario_sugerido(uuid, jsonb) FROM PUBLIC, anon, authenticated;"), 'salário sugerido não é chamável direto pelo cliente')
ok(/'padroes', jsonb_build_object\('horas_produtivas_mes', e\.horas_produtivas_padrao/.test(mig) && /'padroes', jsonb_build_object\('horas_produtivas_mes', 176, 'vinculo', 'clt', 'forma_pagamento', 'mensal'/.test(mig), 'padrões da empresa (176 h, CLT, mensal, benefícios) voltam junto com os encargos')
ok(/v_conf_por := a\.confirmado_por; v_conf_em := a\.confirmado_em;/.test(mig), 'mudar só os padrões não derruba a confirmação do contador')
ok(!/DELETE\s+FROM/i.test(mig), 'nada é apagado')

const tela = readFileSync('src/app/dashboard/projetos/mao-obra/page.tsx', 'utf8')
ok(tela.includes('>Configurar padrões</button>'), 'botão renomeado: "Configurar padrões"')
for (const t of ['pessoa-nome', 'pessoa-cpf', 'pessoa-admissao', 'ficha-funcao', 'ficha-vinculo', 'ficha-salario']) ok(new RegExp(`data-testid="${t}"`).test(tela), `campo ${t} presente`)
ok((tela.match(/<Obrig \/>/g) ?? []).length >= 8 && tela.includes('obrigatório. O resto pode completar depois.'), 'obrigatórios marcados com * e aviso "pode completar depois"')
ok(tela.includes('data-testid="ficha-voltar-padrao"') && tela.includes('data-testid="ficha-ajustada"'), 'ajuste por ficha com selo "Ajustado nesta ficha" e "Voltar ao padrão"')
ok(tela.includes('salario_sugerido') && tela.includes('data-testid="ficha-salario-sugerido"'), 'ao escolher a função, sugere o salário médio')
ok(tela.includes('encargos.padroes ?? PADRAO_FICHA'), 'ficha nova pré-preenchida pelos padrões da empresa')

if (falhas) { console.error(`\ncheck-mao-obra-v2: ${falhas} falha(s)`); process.exit(1) }
console.log('\nMão de obra v2: ok')
