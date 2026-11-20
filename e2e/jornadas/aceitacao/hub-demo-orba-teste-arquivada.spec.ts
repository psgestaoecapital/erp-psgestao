// Hub · auditoria CEO 20/11: a obra lixo "ORBA TESTE" (OBR-2026-0002) da DEMO Construtora Modelo (006)
// foi arquivada (soft-delete) só na DEMO. Depende da migration 20261122101735 → @pos-migration.
// Só leitura; não semeia nem apaga nada.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

const OBRA_ORBA = 'f5bd22cb-8bea-4676-a7d3-687d874ba90b'

test.describe('Hub · obra lixo "ORBA TESTE" arquivada na DEMO', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-demo-orba-teste', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('ORBA TESTE tem deleted_at (fora do Cockpit ativo)', { tag: '@pos-migration' }, async () => {
    const [o] = await dbSelect<{ id: string; deleted_at: string | null }>('projetos_obras', `id=eq.${OBRA_ORBA}&select=id,deleted_at`)
    // o registro é preservado (RD-30), só marcado como excluído/arquivado
    expect(o, 'a obra continua no banco (RD-30, não apagada)').toBeTruthy()
    expect(o.deleted_at, 'ORBA TESTE arquivada (deleted_at preenchido)').not.toBeNull()
  })
})
