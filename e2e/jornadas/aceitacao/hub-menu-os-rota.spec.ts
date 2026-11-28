// Hub · auditoria CEO 20/11: o item "Ordens de Serviço" do menu do Hub (hub_ordens_servico) apontava para
// /dashboard/os (OS da oficina). Deve apontar para a OS de obra (/dashboard/projetos/obras/os).
// Depende da migration 20261123100640 → @pos-migration. Só leitura de catálogo; não semeia nem apaga nada.

import { test, expect } from '../../support/fixtures'
import { dbSelect, registrarJornada } from '../../support/api'

test.describe('Hub · item de OS aponta para a OS de obra', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-menu-os-rota', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('hub_ordens_servico aponta para /dashboard/projetos/obras/os', { tag: '@pos-migration' }, async () => {
    const [m] = await dbSelect<{ id: string; rota: string }>('module_catalog', 'id=eq.hub_ordens_servico&select=id,rota')
    expect(m, 'o item hub_ordens_servico existe no catálogo').toBeTruthy()
    expect(m.rota).toBe('/dashboard/projetos/obras/os')
  })
})
