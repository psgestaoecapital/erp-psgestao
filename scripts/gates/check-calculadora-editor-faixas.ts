// Gate (Hub HB2): editor das faixas de pé-direito — faixa inválida nunca é salva; todo controle tem "?" na migration; referência passa limpa.
import { readFileSync } from 'node:fs'
import { faixasIguais, faixasParaForm, montarFaixas } from '../../src/lib/calculadora/faixas-editor'
import { REGRAS_PAREDE_SIMPLES_ST, calcularParede } from '../../src/lib/calculadora/motor'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ref = REGRAS_PAREDE_SIMPLES_ST.faixas
const form = faixasParaForm(ref)
const r = montarFaixas(form)
ok(r.ok && faixasIguais(r.faixas, ref), 'referência → formulário → faixas devolve a mesma lista')
const com = (i: number, p: Partial<(typeof form)[0]>) => form.map((x, j) => (j === i ? { ...x, ...p } : x))
ok(!montarFaixas([]).ok, 'lista vazia recusada')
ok(!montarFaixas(com(0, { de: '' })).ok && !montarFaixas(com(0, { ate: 'abc' })).ok, 'vazio e texto recusados')
ok(!montarFaixas(com(0, { de: '3', ate: '2' })).ok, '"até" menor que "de" recusado')
ok(!montarFaixas(com(0, { ate: '2,6' })).ok, 'sobreposição recusada')
ok(!montarFaixas(com(0, { espacamento: '0.5' })).ok && !montarFaixas(com(0, { bitola: 'M99' })).ok, 'espaçamento e bitola fora da lista recusados')
const virgula = montarFaixas(com(0, { de: '0,25' }))
ok(virgula.ok && virgula.faixas[0].de === 0.25, 'vírgula decimal aceita')
// faixa editada vira conta nova, sem travar
const editada = montarFaixas(com(0, { bitola: 'M70' }))
const calc = editada.ok ? calcularParede({ ...REGRAS_PAREDE_SIMPLES_ST, faixas: editada.faixas }, { comprimento: 12.5, peDireito: 2.4, vaos: 1.68 }) : null
ok(!!calc && calc.ok && calc.itens.some((i) => i.descricao.includes('M70')), 'faixa editada muda a conta (guia M70 em 2,40 m)')
const sql = readFileSync('supabase/migrations/20261014190005_calculadora_faixas_ajuda.sql', 'utf8')
for (const k of ['faixas', 'faixa.de', 'faixa.ate', 'faixa.bitola', 'faixa.espacamento', 'faixa.duplo', 'faixa.adicionar', 'faixa.remover']) ok(sql.includes(`'projetos.calculadora.regra.parede.${k}'`), `"?" de ${k} na migration`)
const tela = readFileSync('src/app/dashboard/projetos/calculadora/EditorRegras.tsx', 'utf8')
for (const k of ['faixas', 'faixa.de', 'faixa.ate', 'faixa.bitola', 'faixa.espacamento', 'faixa.duplo', 'faixa.adicionar', 'faixa.remover']) ok(tela.includes(`"projetos.calculadora.regra.parede.${k}"`), `tela usa o "?" de ${k}`)
ok(!/\b(UPDATE|DELETE|DROP|CREATE OR REPLACE)\b/i.test(sql), 'migration só insere ajuda')
if (falhas) process.exit(1)
