// RD-78 · Aceitação do chamado #76 (Frioeste): régua de tolerância das pausas térmicas.
// A cliente respondeu: "Pausas até 23 devem contar como normais e a partir de 24 como excedidas".
// Migration 20260926250000: tolerancia_excesso_min 23 → 24 (parâmetro da empresa) + reclassificação dos eventos.
// @pos-migration: só passa com a migration aplicada — o veredito é o aceitacao-pos-migration.yml em PRODUÇÃO.
// Somente leitura (nenhuma escrita no tenant do cliente).

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const FRIOESTE = '975365cc-9e5a-4251-9022-68c6bfde10d8'
type Pausa = { duracao_seg: number | null; fim: string | null; em_aberto: boolean | null; classe_evento: string | null }

test.describe('Aceitação #76 — régua das pausas: até 23 normal, a partir de 24 excesso', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-76-regua-pausas', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('régua da empresa = 24 e a faixa [23,24) min conta como normal @pos-migration', async () => {
    const regra = await dbSelect<{ parametros: Record<string, unknown> }>('nr36_pausa_regra',
      `company_id=eq.${FRIOESTE}&tipo=eq.termica_253&select=parametros`)
    expect(Number(regra[0]?.parametros?.tolerancia_excesso_min), 'tolerância da Frioeste').toBe(24)

    // pausas fechadas de 23 a 45 min: abaixo de 24 → normal; de 24 a 45 → excesso
    const pausas = await dbSelect<Pausa>('ind_ponto_pausa',
      `company_id=eq.${FRIOESTE}&duracao_seg=gte.1380&duracao_seg=lte.2700&select=duracao_seg,fim,em_aberto,classe_evento`)
    const fechadas = pausas.filter((p) => p.fim != null && p.em_aberto !== true)
    const faixa2324 = fechadas.filter((p) => Number(p.duracao_seg) < 1440)
    const de24a45 = fechadas.filter((p) => Number(p.duracao_seg) >= 1440)
    expect(faixa2324.length, 'há pausas entre 23 e 24 min para provar a régua').toBeGreaterThan(0)
    expect(faixa2324.filter((p) => p.classe_evento !== 'pausa_normal'), 'entre 23 e 24 min: todas normais').toEqual([])
    expect(de24a45.filter((p) => p.classe_evento !== 'pausa_excesso'), 'de 24 a 45 min: todas excesso').toEqual([])
  })
})
