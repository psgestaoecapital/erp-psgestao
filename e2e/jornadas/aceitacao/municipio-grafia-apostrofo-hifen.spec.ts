// Caixa jordana-code 7f5305cb (Eng. Chefe 09/10): o gatilho do IBGE (#2290) não reconhecia 12 clientes reais só por
// grafia — "HERVAL D OESTE" (oficial Herval d'Oeste), "NAO ME TOQUE (RS)" (oficial Não-Me-Toque), "MOGI MIRIM" (oficial
// Moji Mirim) e similares. A regra única fn_municipio_por_nome_uf (gatilho + autocompletar do cadastro) passa a comparar
// só letras e números (sem acento, apóstrofo, hífen, pontuação) e a cair na tabela de sinônimos oficiais.
// Demonstração Comércio (GE), nunca empresa real. Cadastros de teste desativados no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, rpc, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`

// Os 12 casos reais do disparo de 09/10 (6 grafias distintas) + regressão dos casos da #2290.
const CASOS: Array<[string, string, string | null]> = [
  ['HERVAL D OESTE', 'SC', '4206702'],
  ['ITAPEJARA D OESTE', 'PR', '4111209'],
  ['SÃO JORGE D OESTE', 'PR', '4125209'],
  ['ESTRELA D OESTE', 'SP', '3515202'],
  ['NAO ME TOQUE (RS)', 'RS', '4312658'],
  ['MOGI MIRIM', 'SP', '3530805'],          // sinônimo oficial: Moji Mirim
  ["Herval d'Oeste", 'SC', '4206702'],      // a grafia oficial continua casando
  ['Naviraí', 'MS', '5005707'],
  ['CHAPECO (SC)', 'sc', '4204202'],
  ['Navirai/MS', 'MS', '5005707'],
  ['Mogi Guaçu', 'SP', '3530706'],          // oficial já é "Mogi": não pode virar Moji
  ['Herval', 'SC', null],                   // nome parcial não casa (não inventa)
  ['Cidade Que Não Existe', 'MS', null],
]

type Mun = { codigo_ibge: string }
const criados: string[] = []

test.describe('Município: grafia com apóstrofo, hífen e sinônimo oficial acha o IBGE (caixa 7f5305cb)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-municipio-grafia', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('fn_municipio_por_nome_uf: os 12 casos reais e a regressão', { tag: '@pos-migration' }, async () => {
    for (const [cidade, uf, esperado] of CASOS) {
      const r = await rpc<Mun[]>('fn_municipio_por_nome_uf', { p_nome: cidade, p_uf: uf })
      expect(r[0]?.codigo_ibge ?? null, `${cidade}/${uf}`).toBe(esperado)
    }
  })

  test('gatilho do cadastro usa a mesma regra: "NAO ME TOQUE (RS)" e "MOGI MIRIM" preenchem o IBGE', { tag: '@pos-migration' }, async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)

    for (const [cidade, uf, esperado] of [['NAO ME TOQUE (RS)', 'RS', '4312658'], ['MOGI MIRIM', 'SP', '3530805'], ['ESTRELA D OESTE', 'SP', '3515202']]) {
      const c = await dbInsert<{ id: string }>('erp_clientes', {
        company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: true, nome_fantasia: `Cliente grafia ${RUN}`, cidade, uf,
      })
      criados.push(c.id)
      const [lido] = await dbSelect<{ codigo_ibge_municipio: string | null }>('erp_clientes', `id=eq.${c.id}&select=codigo_ibge_municipio`)
      expect(lido.codigo_ibge_municipio, `${cidade}/${uf}`).toBe(esperado)
    }
  })
})
