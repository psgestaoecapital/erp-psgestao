// RD-35 · briefing de sessão aponta para os blueprints vivos (CEO 02/10). Migration 20261002290000 · @pos-migration.
// Só leitura (service_role, como a sessão do Claude): fn_briefing_blueprints() — o bloco que o briefing passa a anexar —
// conferido contra as tabelas. Não chama o briefing inteiro pela API: hoje ele leva ~7 s (fn_atak_status lê 600 MB de
// ind_atak_fato) e a API corta em 8 s; a sessão do Claude o chama pelo banco, sem esse limite. A linha que encaixa o
// bloco no briefing é conferida pelo gate check-briefing-blueprints e, após o deploy, no próprio banco.

import { test, expect } from '../../support/fixtures'
import { dbSelect, rpc, registrarJornada } from '../../support/api'

type Bp = { vertical: string; versao: number; titulo: string; data: string }
type Briefing = { blueprints_vigentes: Bp[]; ponto_de_partida: { titulo: string; descricao: string } | null }

test.describe('Briefing de sessão — blueprints vigentes e ponto de partida', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-briefing-blueprints', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('briefing traz os blueprints vigentes e o ponto de partida mais recente', { tag: '@pos-migration' }, async () => {
    const b = await rpc<Briefing>('fn_briefing_blueprints', {})

    const vigentes = await dbSelect<{ vertical: string; versao: number }>('erp_documento_vertical', 'vigente=is.true&select=vertical,versao')
    expect(b.blueprints_vigentes.length, 'um item por blueprint vigente').toBe(vigentes.length)
    for (const v of vigentes) {
      const item = b.blueprints_vigentes.find((x) => x.vertical === v.vertical)
      expect(item?.versao, `blueprint ${v.vertical} na versão vigente`).toBe(v.versao)
      expect(item?.titulo, `blueprint ${v.vertical} com título`).toBeTruthy()
      expect(item?.data, `blueprint ${v.vertical} com data`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }

    // mesma regra da função: o mais recente pela última atualização (sem atualização, pela criação)
    const pps = await dbSelect<{ titulo: string; descricao: string; atualizado_em: string | null; criado_em: string }>('erp_contexto_projeto',
      'tags=cs.{ponto-de-partida}&select=titulo,descricao,atualizado_em,criado_em')
    expect(pps.length, 'existe ao menos um registro ponto-de-partida').toBeGreaterThan(0)
    const quando = (r: { atualizado_em: string | null; criado_em: string }) => new Date(r.atualizado_em ?? r.criado_em).getTime()
    const pp = [...pps].sort((a, b) => quando(b) - quando(a))[0]
    expect(b.ponto_de_partida?.titulo, 'ponto de partida = o mais recente com a tag').toBe(pp.titulo)
    expect(b.ponto_de_partida?.descricao, 'ponto de partida com a descrição').toBe(pp.descricao)
  })
})
