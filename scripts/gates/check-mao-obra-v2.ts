// Gate (Mão de obra v2 · SPEC Hub E1+E2 rev. 16 seção 5.1 · lista do banco e valores-padrão aprovados pelo CEO em 01/10):
// remuneração por COMPONENTES com chaves de incidência; vínculos CLT/intermitente/RPA/MEI-PJ/diarista; DSR 1/6; INSS do
// RPA 20% (0% no Simples III/V); MEI em serviço de obra 20%; diarista como autônomo com alerta acima de 8 dias;
// empreitada × 30 ÷ dias; insalubridade % do mínimo; periculosidade 30% do fixo. Obrigatórios com CPF válido e "pelo
// menos um componente com valor"; ajuste por ficha com quem/quando; padrões da empresa; funções-modelo só por botão. Sem rede.
import { readFileSync } from 'node:fs'
import { cpfValido, mascaraCpf } from '../../src/lib/documentos/cpf'
import { calcularCustoMaoObra, chavesPadrao, meiServicoObraPadrao, rpaInssPadrao, temComponenteComValor, type Componente } from '../../src/lib/hub/custoMaoObra'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

ok(cpfValido('529.982.247-25') && cpfValido('52998224725'), 'CPF válido passa (com ou sem máscara)')
ok(!cpfValido('529.982.247-24') && !cpfValido('111.111.111-11') && !cpfValido('1234'), 'CPF com dígito errado, repetido ou curto é recusado')
ok(mascaraCpf('52998224725') === '529.982.247-25', 'máscara do CPF enquanto digita')

// encargos do exemplo da SPEC (Lucro Real 36,8%) com os padrões que o banco devolve
const enc = { prov_13_pct: 8.33, prov_ferias_pct: 11.11, prov_rescisao_pct: 4, encargos_folha_pct: 36.8, padroes: { dsr_fator: 0.16667, rpa_inss_pct: 20, salario_minimo: 1518 } }
const clt = (tipo: Componente['tipo'], subtipo: string | null, c: Partial<Componente>): Componente => ({ tipo, subtipo, ...chavesPadrao('clt', tipo, subtipo), ...c })

// ── SPEC 5.1: fixo R$ 2.000 + R$ 3,00/m² × 500 m² (volume estimado), VT 300 + alimentação 500 ──
const spec = calcularCustoMaoObra({ vinculo: 'clt', horas_produtivas_mes: 176, beneficio_vt: 300, beneficio_alimentacao: 500,
  componentes: [clt('fixo', 'mensal', { valor: 2000 }), clt('producao', null, { valor: 3, quantidade: 500, unidade: 'm2', estimado: true })] }, enc)
ok(Math.round(spec.custo_mensal ?? 0) === 7077 && spec.custo_hora === 40.21 && spec.custo_unidade === 14.15 && spec.unidade === 'm2',
  `exemplo da SPEC 5.1: R$ 7.077/mês → R$ 40,21/h ou R$ 14,15/m² (deu ${spec.custo_mensal} · ${spec.custo_hora} · ${spec.custo_unidade})`)
ok(Math.round(spec.dsr) === 250, `DSR 1/6 só sobre a produção (R$ 1.500 → R$ 250; o fixo mensal já inclui o repouso) (deu ${spec.dsr})`)
ok(spec.alertas.includes('volume_estimado'), 'volume estimado fica marcado como estimativa')

// ── a ficha antiga continua dando o mesmo número (R$ 31,18) ──
const antiga = calcularCustoMaoObra({ vinculo: 'clt', forma_pagamento: 'mensal', salario: 2800, beneficio_vt: 300, beneficio_alimentacao: 500, horas_produtivas_mes: 176 }, enc)
ok(antiga.custo_mensal === 5487.03 && antiga.custo_hora === 31.18, `ficha antiga (salário único) R$ 2.800 → R$ 5.487,03 · R$ 31,18/h (deu ${antiga.custo_mensal} · ${antiga.custo_hora})`)
const comoComp = calcularCustoMaoObra({ vinculo: 'clt', beneficio_vt: 300, beneficio_alimentacao: 500, horas_produtivas_mes: 176, componentes: [clt('fixo', 'mensal', { valor: 2800 })] }, enc)
ok(comoComp.custo_mensal === 5487.03, 'o mesmo salário como componente "fixo mensal" dá o mesmo custo')

// ── vínculos ──
const rpa = calcularCustoMaoObra({ vinculo: 'rpa', horas_produtivas_mes: 176, componentes: [{ tipo: 'fixo', subtipo: 'mensal', valor: 3000 }] }, enc)
const rpaSimples = calcularCustoMaoObra({ vinculo: 'rpa', horas_produtivas_mes: 176, componentes: [{ tipo: 'fixo', subtipo: 'mensal', valor: 3000 }] }, { ...enc, padroes: { ...enc.padroes, rpa_inss_pct: 0 } })
ok(rpa.custo_mensal === 3600 && rpaSimples.custo_mensal === 3000, 'autônomo (RPA): +20% de INSS; Simples Anexo III/V: 0%')
ok(rpaInssPadrao('simples', 'III') === 0 && rpaInssPadrao('simples', 'V') === 0 && rpaInssPadrao('simples', 'IV') === 20 && rpaInssPadrao('real', null) === 20 && rpaInssPadrao('presumido', null) === 20,
  'INSS do RPA pelo regime: Anexo III/V 0% · Anexo IV, Real e Presumido 20%')
const meiObra = calcularCustoMaoObra({ vinculo: 'pj', mei_servico_obra: true, componentes: [{ tipo: 'producao', valor: 4, quantidade: 600, unidade: 'm2' }] }, enc)
const meiOutro = calcularCustoMaoObra({ vinculo: 'pj', mei_servico_obra: false, componentes: [{ tipo: 'producao', valor: 4, quantidade: 600, unidade: 'm2' }] }, enc)
ok(meiObra.custo_mensal === 2880 && meiOutro.custo_mensal === 2400 && meiOutro.encargos === 0, 'MEI em serviço de obra: +20% de INSS patronal (LC 123); MEI/PJ fora disso: sem encargos')
ok(['Pintor', 'Eletricista', 'Encanador', 'Instalador hidráulico', 'Pedreiro de alvenaria', 'Carpinteiro'].every(meiServicoObraPadrao) && !meiServicoObraPadrao('Engenheiro') && !meiServicoObraPadrao('Gesseiro'),
  'chave "MEI em serviço de obra" já vem ligada em hidráulica, elétrica, pintura, alvenaria e carpintaria')
const diar10 = calcularCustoMaoObra({ vinculo: 'diarista', horas_produtivas_mes: 80, componentes: [{ tipo: 'diaria', valor: 150, quantidade: 10 }] }, enc)
const diar8 = calcularCustoMaoObra({ vinculo: 'diarista', horas_produtivas_mes: 64, componentes: [{ tipo: 'diaria', valor: 150, quantidade: 8 }] }, enc)
ok(diar10.custo_mensal === 1800 && diar10.alertas.includes('diarista_mais_8_dias') && !diar8.alertas.includes('diarista_mais_8_dias'),
  'diarista: calculado como autônomo (+20%) e com alerta de risco trabalhista acima de 8 dias no mês')
ok(chavesPadrao('rpa', 'fixo', 'mensal').incide_encargos === false && chavesPadrao('pj', 'producao', null).gera_dsr === false, 'terceiros não levam chaves de folha')

// ── componentes ──
const emp = calcularCustoMaoObra({ vinculo: 'pj', componentes: [{ tipo: 'empreitada', valor: 9000, quantidade: 45 }] }, enc)
ok(emp.base === 6000, 'empreitada: valor × 30 ÷ dias da obra (R$ 9.000 em 45 dias → R$ 6.000/mês)')
const adic = calcularCustoMaoObra({ vinculo: 'clt', componentes: [clt('fixo', 'mensal', { valor: 2000 }), clt('adicional', 'insalubridade', { percentual: 20 }), clt('adicional', 'periculosidade', { percentual: 30 })] }, enc)
ok(adic.base === 2000 + 303.6 + 600, 'insalubridade = % do salário mínimo (20% × 1.518); periculosidade = 30% do fixo')
const he = calcularCustoMaoObra({ vinculo: 'clt', componentes: [clt('fixo', 'mensal', { valor: 2200 }), clt('hora_extra', null, { quantidade: 10, percentual: 50 })] }, enc)
ok(he.base === 2350, 'hora extra habitual: 10 h × (2.200 ÷ 220) × 1,5 = R$ 150')
const com = calcularCustoMaoObra({ vinculo: 'clt', componentes: [clt('comissao', null, { percentual: 5, quantidade: 20000 })] }, enc)
ok(com.base === 1000 && Math.round(com.dsr) === 167, 'comissão = % sobre a base média, com DSR 1/6')
ok(!chavesPadrao('clt', 'fixo', 'mensal').gera_dsr && chavesPadrao('clt', 'producao').gera_dsr && chavesPadrao('clt', 'comissao').gera_dsr && chavesPadrao('clt', 'hora_extra').gera_dsr && !chavesPadrao('clt', 'bonus').integra_remuneracao,
  'chaves pré-preenchidas: DSR sobre produção, comissão e hora extra; bônus não integra')
ok(chavesPadrao('clt', 'producao', null, { producao: { gera_dsr: false, integra_13_ferias: true, incide_encargos: true, integra_remuneracao: true } }).gera_dsr === false, 'padrão da empresa (contador) vence o padrão interno')
ok(!temComponenteComValor([]) && !temComponenteComValor([{ tipo: 'fixo', valor: 0 }]) && temComponenteComValor([{ tipo: 'comissao', percentual: 5, quantidade: 10000 }]), 'obrigatório: pelo menos um componente com valor')

// ── ajuste por ficha ──
const encLp = { ...enc, encargos_folha_pct: 31 }
const padrao = calcularCustoMaoObra({ vinculo: 'clt', salario: 2800 }, encLp)
const ajustado = calcularCustoMaoObra({ vinculo: 'clt', salario: 2800, encargos_folha_pct_ajuste: 40 }, encLp)
ok(padrao.encargos_folha_pct === 31 && ajustado.encargos_folha_pct === 40 && ajustado.custo_mensal === 4794.05, `ajuste de encargos para 40% na ficha → R$ 4.794,05 (deu ${ajustado.custo_mensal})`)
ok(calcularCustoMaoObra({ vinculo: 'clt', salario: 2800, encargos_folha_pct_ajuste: null }, encLp).custo_mensal === padrao.custo_mensal, 'sem ajuste (null) = padrão da empresa')
ok(calcularCustoMaoObra({ vinculo: 'clt', componentes: [clt('producao', null, { valor: 3, quantidade: 500 })], dsr_fator_ajuste: 0 }, enc).dsr === 0, 'DSR editável na ficha')

// ── o banco ──
const mig = readFileSync('supabase/migrations/20261002130000_mao_obra_componentes.sql', 'utf8').replace(/--[^\n]*/g, '')
const corpo = (fn: string) => { const i = mig.indexOf(`FUNCTION public.${fn}(`); return mig.slice(i, mig.indexOf('$function$;', i)) }
const salvar = corpo('fn_mao_obra_ficha_salvar')
ok(salvar.includes("IF NOT public.fn__cpf_valido(v_cpf) THEN RAISE EXCEPTION 'CPF inválido"), 'banco recusa CPF inválido')
ok(salvar.includes("RAISE EXCEPTION 'Informe a data de admissão.'") && salvar.includes("Informe o vínculo"), 'banco exige data de admissão (pessoa) e vínculo')
ok(salvar.includes("'Informe pelo menos um componente da remuneração com valor.'"), 'banco exige pelo menos um componente com valor')
ok(salvar.includes("WHEN COALESCE(NULLIF(p_ficha->>'salario', '')::numeric, 0) > 0 THEN jsonb_build_array(jsonb_build_object('tipo', 'fixo'"), 'tela antiga aberta durante o deploy (salário único) continua salvando')
ok(/CASE WHEN v_tem_ajuste THEN auth\.uid\(\) END, CASE WHEN v_tem_ajuste THEN now\(\) END/.test(salvar), 'ajuste na ficha registra quem e quando')
const reaj = corpo('fn_mao_obra_ficha_reajustar')
ok(/n\.ajuste_por := NULL; n\.ajuste_em := NULL;/.test(reaj) && reaj.includes('FROM erp_mao_obra_componente x WHERE x.ficha_id = a.id'), 'reajuste copia os componentes da vigência anterior; "voltar ao padrão" limpa quem/quando')
const calc = corpo('fn_mao_obra_custo_calcular')
ok(calc.includes("WHEN 'empreitada' THEN COALESCE((c->>'valor')::numeric, 0) * 30 / GREATEST") && calc.includes("WHEN 'insalubridade' THEN COALESCE((c->>'percentual')::numeric, 20) / 100 * sm")
  && calc.includes("WHEN 'periculosidade' THEN COALESCE((c->>'percentual')::numeric, 30) / 100 * fixo_mes"), 'banco: empreitada × 30 ÷ dias, insalubridade % do mínimo, periculosidade 30% do fixo')
ok(calc.includes("ELSIF vinc IN ('rpa', 'diarista') THEN") && calc.includes("e := a * 20 / 100;") && calc.includes('"diarista_mais_8_dias"'), 'banco: RPA/diarista com INSS do RPA, MEI em obra 20%, alerta do diarista')
ok(/'rpa_inss_pct', COALESCE\(e\.rpa_inss_pct, CASE WHEN e\.regime = 'simples' AND e\.simples_anexo IN \('III', 'V'\) THEN 0 ELSE 20 END\)/.test(corpo('fn_mao_obra_encargos_vigentes')), 'banco: INSS do RPA 0% no Simples III/V, 20% nos demais')
ok(/IF COALESCE\(p_vinculo, 'clt'\) NOT IN \('clt', 'clt_intermitente'\) THEN/.test(corpo('fn_mao_obra_chaves_padrao')), 'banco: chaves de folha só para CLT/intermitente')
ok(/REVOKE ALL ON public\.erp_mao_obra_componente FROM anon, authenticated;/.test(mig), 'componentes (salário) não são lidos direto da tabela — só pelas funções com log (LGPD)')
ok(/'salario_sugerido', CASE WHEN v_pode THEN/.test(corpo('fn_mao_obra_listar')) && mig.includes('REVOKE ALL ON FUNCTION public.fn__mao_obra_salario_sugerido(uuid, jsonb) FROM PUBLIC, anon, authenticated;'), 'salário sugerido só para quem vê salário (LGPD)')
ok(/v_conf_por := a\.confirmado_por; v_conf_em := a\.confirmado_em;/.test(corpo('fn_mao_obra_encargos_salvar')), 'mudar só os padrões da ficha não derruba a confirmação do contador')
const modelo = corpo('fn_mao_obra_funcoes_modelo')
ok(modelo.includes("RAISE EXCEPTION 'A empresa já tem funções") && !/(PERFORM|SELECT)\s+public\.fn_mao_obra_funcoes_modelo/.test(mig) && !/custo_hora_manual/.test(modelo),
  'funções-modelo: só por botão, só em empresa sem funções e sem custo inventado (nada é criado sozinho)')
ok(!/DELETE\s+FROM/i.test(mig), 'nada é apagado')

// ── a tela ──
// a tela virou compartilhada (CEO 03/10): o Hub e as áreas renderizam o mesmo componente
const tela = readFileSync('src/components/mao-obra/MaoObraTela.tsx', 'utf8')
ok(tela.includes('>Configurar padrões</button>') && tela.includes('data-testid="padroes-incidencia"') && tela.includes('data-testid="padrao-rpa"'), '"Configurar padrões": horas, vínculo, forma, benefícios, DSR, INSS do RPA, mínimo e chaves de incidência')
for (const t of ['pessoa-nome', 'pessoa-cpf', 'pessoa-admissao', 'ficha-funcao', 'ficha-vinculo', 'ficha-componentes', 'componente-adicionar', 'componente-chaves', 'ficha-mei-obra', 'ficha-alerta-diarista', 'ficha-custo-unidade', 'ficha-chaves-confirmadas', 'mao-obra-funcoes-modelo']) {
  ok(tela.includes(`data-testid="${t}"`) || tela.includes(`data-testid={\`${t}`), `tela: ${t}`)
}
ok((tela.match(/<Obrig \/>/g) ?? []).length >= 6 && tela.includes('obrigatório. O resto pode completar depois.'), 'obrigatórios marcados com * e aviso "pode completar depois"')
ok(tela.includes('a confirmar com o contador') && tela.includes('temComponenteComValor(comps)'), 'chaves e padrões "a confirmar com o contador"; a tela confere o componente com valor antes de salvar')
ok(tela.includes('data-testid="ficha-voltar-padrao"') && tela.includes('data-testid="ficha-ajustada"'), 'ajuste por ficha com selo "Ajustado nesta ficha" e "Voltar ao padrão"')
ok(tela.includes('fn.salario_sugerido?.valor') && tela.includes('data-testid="ficha-salario-sugerido"'), 'ao escolher a função, sugere o salário médio e a forma de pagamento da função')

if (falhas) { console.error(`\ncheck-mao-obra-v2: ${falhas} falha(s)`); process.exit(1) }
console.log('\nMão de obra v2: ok')
