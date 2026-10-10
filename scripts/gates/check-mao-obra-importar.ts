// Gate (Mão de obra · importação em massa, CEO 07/10 · FC Pisos): a regra pura da planilha — o motivo que ensina por linha
// (CPF inválido/repetido, data, número, lista, obrigatório), colunas de dado pessoal ignoradas, sócio fora, componentes da remuneração
// e uso das RPCs existentes (sem caminho paralelo). Sem rede.
import { readFileSync } from 'node:fs'
import { componentesDaLinha, fichaDaLinha, lerData, lerEncargos, lerNumero, validarFuncionarios } from '../../src/lib/hub/importarMaoObra'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

ok(lerData('15/03/2022') === '2022-03-15' && lerData('2022-03-15') === '2022-03-15' && lerData(44635) === '2022-03-15' && lerData('31/02/2022') === null && lerData('abc') === null, 'datas: dd/mm/aaaa, ISO e serial do Excel; 31/02 recusa')
ok(lerNumero('1.234,56') === 1234.56 && lerNumero('R$ 2.200,00') === 2200 && lerNumero(10.5) === 10.5 && lerNumero('abc') === null, 'números em formato BR')

const base = { 'Matrícula*': '1', 'Nome completo*': 'Ana Teste', 'CPF*': '529.982.247-25', 'Data de admissão*': '15/03/2022', 'Função*': 'Ajudante', 'Vínculo*': 'CLT', 'Forma de pagamento*': 'Mensal', 'Salário base (R$)*': '2.200,00', 'Vigência a partir de*': '01/10/2026' }
const r = validarFuncionarios([
  base,
  { ...base, 'Matrícula*': '2', 'CPF*': '111.111.111-11' },
  { ...base, 'Matrícula*': '3' },                                  // CPF repetido
  { ...base, 'Matrícula*': '4', 'CPF*': '390.533.447-05', 'Data de admissão*': '99/99/2022' },
  { ...base, 'Matrícula*': '5', 'CPF*': '390.533.447-05', 'Vínculo*': 'Estagiário', 'Salário base (R$)*': 'mil', RG: '123', 'Data de nascimento': '01/01/1990' },
  { ...base, 'Matrícula*': '6', 'CPF*': '', 'Nome completo*': '' },
  { ...base, 'Matrícula*': '7', 'CPF*': '168.995.350-09', 'Função*': 'Sócio administrador' },
])
const por = (n: number) => r.linhas.find((l) => l.linha === n + 1)!
ok(r.linhas.length === 7 && por(1).ok, 'linha certa passa')
ok(por(2).erros.some((e) => /dígito verificador/.test(e)), 'CPF com dígito errado: motivo que ensina')
ok(por(3).erros.some((e) => /CPF repetido/.test(e)), 'CPF repetido no arquivo')
ok(por(4).erros.some((e) => /dd\/mm\/aaaa/.test(e)), 'data inválida ensina o formato')
ok(por(5).erros.some((e) => /Vínculo/.test(e)) && por(5).erros.some((e) => /não é um número/.test(e)), 'vínculo fora da lista e valor não numérico')
ok(por(6).erros.some((e) => /obrigatório/.test(e)), 'obrigatório vazio')
ok(por(7).erros.some((e) => /Sócio/.test(e)), 'sócio/pró-labore fica de fora')
ok(r.avisos.some((a) => /LGPD/.test(a) && /RG/.test(a)), 'colunas RG/nascimento ignoradas com aviso')
ok(r.linhas.filter((l) => l.ok).length === 1, '3 válidas e 1 inválida: só a certa grava (aqui 1 de 7)')

const hora = validarFuncionarios([{ ...base, 'Forma de pagamento*': 'Hora', 'Valor por unidade (R$)': '25,50', 'Salário base (R$)*': '0', 'Insalubridade': '100' }]).linhas[0]
const comps = componentesDaLinha(hora)
ok(hora.ok && comps[0].tipo === 'fixo' && comps[0].subtipo === 'hora' && comps[0].valor === 25.5 && comps.some((c) => c.tipo === 'adicional' && c.valor === 100), 'hora: fixo/hora + adicional em R$')
const { ficha, pessoa } = fichaDaLinha(r.linhas[0], 'f1', null)
ok(ficha.tipo === 'pessoa' && ficha.funcao_id === 'f1' && pessoa?.cpf === '52998224725' && !('conferido' in ficha), 'ficha de pessoa nova (entra não conferida: o banco já grava assim)')
ok(fichaDaLinha(r.linhas[0], 'f1', 'p1').pessoa === null, 'pessoa existente (mesmo CPF): sem novo cadastro')

const e = lerEncargos([['Regime tributário*', 'Lucro Presumido'], ['INSS patronal %', 20], ['Desoneração da folha (Sim/Não)', 'Não'], ['Vigência a partir de', '01/10/2026']])
ok(e.dados?.regime === 'presumido' && e.dados?.inss_patronal_pct === 20 && e.dados?.desoneracao === false, 'encargos: regime e percentuais')
ok(lerEncargos([['Regime tributário*', 'Marte']]).erros.length > 0 && lerEncargos([['Regime tributário*', null]]).dados === null, 'encargos: regime inválido recusa; aba vazia não mexe')

const modal = readFileSync('src/components/projetos/ImportarMaoObraModal.tsx', 'utf8')
ok(/fn_mao_obra_ficha_salvar/.test(modal) && /fn_mao_obra_funcao_salvar/.test(modal) && /fn_mao_obra_encargos_salvar/.test(modal) && /fn_mao_obra_ficha_reajustar/.test(modal), 'grava pelas RPCs existentes (RD-65/RD-71)')
ok(!/\.from\("(erp_mao_obra_custo|compliance_funcionarios)"\)\s*\.(insert|update|upsert)/.test(modal), 'nenhuma escrita direta nas tabelas')
ok(/fn_mao_obra_importacao_registrar/.test(modal), 'registra quem importou')
const pg = readFileSync('src/app/dashboard/projetos/mao-obra/page.tsx', 'utf8')
ok(/mao-obra-baixar-modelo/.test(pg) && /mao-obra-importar"/.test(pg) && /\{pode && \(\s*<div className="flex flex-wrap gap-2">/.test(pg), 'botões Baixar modelo / Importar planilha só para quem vê salário')
const rota = readFileSync('src/app/api/mao-obra/modelo/route.ts', 'utf8')
ok(/gerarModeloMaoObra/.test(rota) && !/supabase|createClient|auth/i.test(rota), 'link público do modelo: rota sem login e sem acesso a dado de cliente')
ok(/\/api\/mao-obra\/modelo/.test(pg) && !/gerarModeloMaoObra/.test(pg), 'botão da tela usa a mesma rota (fonte única)')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
