// Gate (Mão de obra · HORAS EXTRAS, CEO 09/10 · FC Pisos): HE a 50% e a 100% por funcionário, reflexos pelos mesmos % de
// "Configurar padrões", custo da hora SEM e COM HE lado a lado, escolha por função, colunas opcionais na planilha. Sem rede.
import { readFileSync } from 'node:fs'
import { calcularCustoMaoObra, chavesPadrao, type Componente } from '../../src/lib/hub/custoMaoObra'
import { componentesDaLinha, validarFuncionarios } from '../../src/lib/hub/importarMaoObra'
import { COLUNAS_FUNC } from '../../src/lib/hub/importarMaoObra'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const perto = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= 0.011

const enc = { prov_13_pct: 8.33, prov_ferias_pct: 11.11, prov_rescisao_pct: 4, encargos_folha_pct: 36.8 }
const ch = (t: Componente['tipo'], sub?: string) => chavesPadrao('clt', t, sub ?? null)
const fixo: Componente = { tipo: 'fixo', subtipo: 'mensal', valor: 2200, ...ch('fixo', 'mensal') }
const he50: Componente = { tipo: 'hora_extra', valor: 0, quantidade: 10, percentual: 50, ...ch('hora_extra') }
const he100: Componente = { tipo: 'hora_extra', valor: 0, quantidade: 4, percentual: 100, ...ch('hora_extra') }
const base = { vinculo: 'clt' as const, forma_pagamento: 'mensal' as const, horas_produtivas_mes: 176 }

// conta feita à mão: hora = 2200 ÷ 220 = 10; HE = 10×10×1,5 + 4×10×2 = 150 + 80 = 230
const sem = calcularCustoMaoObra({ ...base, componentes: [fixo] }, enc)
const com = calcularCustoMaoObra({ ...base, componentes: [fixo, he50, he100] }, enc)
const dsr = 230 / 6, prov = (2430 + dsr) * (8.33 + 11.11) / 100, encargos = (2430 + dsr + prov) * 36.8 / 100, resc = (2430 + dsr) * 4 / 100
const mensalCom = 2430 + dsr + prov + encargos + resc
ok(perto(com.base, 2430) && perto(com.dsr, dsr), 'HE = salário ÷ 220 × (1 + adicional): 150 + 80 e DSR de 1/6 só sobre a HE')
ok(perto(com.custo_mensal, mensalCom), 'reflexos: 13º, férias, encargos e rescisão também sobre a HE, com os % configurados')
ok(com.horas_extras === 14 && perto(com.custo_mensal_sem_he, sem.custo_mensal ?? -1), 'SEM HE = a mesma ficha sem os componentes de HE')
ok(perto(com.custo_he, mensalCom - (sem.custo_mensal ?? 0)) && (com.custo_he ?? 0) > 230, 'custo das HE inclui os reflexos (maior que as HE puras)')
ok(perto(com.custo_hora_sem_he, (sem.custo_mensal ?? 0) / 176) && perto(com.custo_hora_com_he, mensalCom / (176 + 14)), 'hora SEM = base ÷ horas produtivas; COM = (base + HE) ÷ (horas produtivas + horas extras)')
ok(sem.horas_extras === 0 && sem.custo_he === 0 && sem.custo_hora_sem_he === sem.custo_hora && sem.custo_hora_com_he === sem.custo_hora, 'não regressão: ficha sem HE tem SEM = COM = custo de sempre')
ok(com.custo_hora === Math.round(mensalCom / 176 * 100) / 100, 'custo_hora de sempre (÷ horas produtivas) não muda de definição')
const rpa = calcularCustoMaoObra({ vinculo: 'rpa', forma_pagamento: 'hora', horas_produtivas_mes: 176, componentes: [{ tipo: 'fixo', subtipo: 'hora', valor: 20, quantidade: 176 }, { tipo: 'hora_extra', valor: 0, quantidade: 10, percentual: 50 }] }, enc)
ok(perto(rpa.custo_hora_sem_he, 20 * 1.2) && (rpa.custo_he ?? 0) > 0, 'vínculo sem folha (RPA): HE só com o INSS do autônomo, sem DSR')

// planilha: colunas novas opcionais no fim; planilha antiga (sem elas) continua valendo
const n = COLUNAS_FUNC.length
ok(COLUNAS_FUNC[n - 2] === 'Horas extras 50% (média/mês)' && COLUNAS_FUNC[n - 1] === 'Horas extras 100% (média/mês)' && COLUNAS_FUNC[0] === 'Matrícula*', 'modelo: HE 50%/100% nas últimas colunas (as antigas não mudam de lugar)')
const linhaBase = { 'Matrícula*': '1', 'Nome completo*': 'Ana Teste', 'CPF*': '529.982.247-25', 'Data de admissão*': '15/03/2022', 'Função*': 'Ajudante', 'Vínculo*': 'CLT', 'Forma de pagamento*': 'Mensal', 'Salário base (R$)*': 2200, 'Vigência a partir de*': '01/10/2026', 'MEI de obra (Sim/Não)': 'Não' }
const antiga = validarFuncionarios([linhaBase]).linhas[0]
ok(antiga.ok && antiga.he50 === 0 && antiga.he100 === 0 && !componentesDaLinha(antiga).some((c) => c.tipo === 'hora_extra'), 'planilha antiga (sem as colunas): vale, sem HE')
const nova = validarFuncionarios([{ ...linhaBase, 'Horas extras 50% (média/mês)': '10', 'Horas extras 100% (média/mês)': '4,5' }]).linhas[0]
const hes = componentesDaLinha(nova).filter((c) => c.tipo === 'hora_extra')
ok(nova.ok && hes.length === 2 && hes[0].percentual === 50 && hes[0].quantidade === 10 && hes[1].percentual === 100 && hes[1].quantidade === 4.5, 'planilha nova: HE 50% e 100% viram componentes')
ok(validarFuncionarios([{ ...linhaBase, 'Horas extras 50% (média/mês)': 'dez' }]).linhas[0].erros.some((e) => /Horas extras 50%/.test(e)), 'HE não numérica: motivo que ensina')

// banco: migration e telas
const mig = readFileSync('supabase/migrations/20261009220030_mao_obra_horas_extras.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/he50_horas_padrao numeric NOT NULL DEFAULT 0/.test(mig) && /he100_horas_padrao numeric NOT NULL DEFAULT 0/.test(mig) && /custo_hora_usa_he text NOT NULL DEFAULT 'sem'/.test(mig), 'banco: padrão de HE e escolha sem/com por função (aditivo, default sem mudar nada)')
ok(/'custo_hora_sem_he'/.test(mig) && /'custo_hora_com_he'/.test(mig) && /mensal \/ \(horas \+ he_h\)/.test(mig) && /x->>'tipo' <> 'hora_extra'/.test(mig), 'banco: o cálculo devolve a hora sem e com HE (mesma conta do TypeScript)')
ok(/IF f\.custo_hora_usa_he = 'com' THEN/.test(mig) && /\(r\.horas_produtivas_mes \+ v_hx\) \* r\.quantidade_pessoas/.test(mig), 'banco: a média da função usa o custo escolhido; COM pesa pelas horas produtivas + extras')
ok(/REVOKE ALL ON FUNCTION public\.fn_mao_obra_custo_calcular\(jsonb, jsonb\) FROM PUBLIC, anon;/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_funcao_custo_hora\(uuid\) FROM PUBLIC, anon;/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_mao_obra_funcao_salvar\(uuid, uuid, jsonb\) FROM PUBLIC, anon;/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_mao_obra_listar\(uuid\) FROM PUBLIC, anon;/.test(mig), 'banco: grants das funções iguais aos de antes (sem anon)')
const tela = readFileSync('src/app/dashboard/projetos/mao-obra/page.tsx', 'utf8')
for (const t of ['ficha-he50', 'ficha-he100', 'ficha-he-custo', 'ficha-custo-hora-sem-he', 'ficha-custo-hora-com-he', 'funcao-he50', 'funcao-he100', 'funcao-usa-he'])
  ok(tela.includes(`data-testid="${t}"`), `tela: ${t}`)
for (const k of ['funcao.he50', 'funcao.he100', 'funcao.usa_he', 'ficha.he50', 'ficha.he100', 'ficha.he_custo', 'resultado.hora_sem_he', 'resultado.hora_com_he']) {
  ok(tela.includes(`projetos.mao_obra.${k}`) && mig.includes(`'projetos.mao_obra.${k}'`), `RD-95: "?" ${k} na tela e na migration`)
}

if (falhas) { console.error(`\ncheck-mao-obra-horas-extras: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-mao-obra-horas-extras: OK')
