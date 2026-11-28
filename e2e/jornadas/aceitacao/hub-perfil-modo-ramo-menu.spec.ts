// Onda M0 · Hub — o TIPO da empresa (modo) filtra a navegação e a guarda de rota (HubRotaGuard) bloqueia, por URL
// direta, a tela que o tipo não usa. Construtora DEMO 006. Semeia empresa_hub_perfil via service_role (a RPC
// fn_hub_perfil_salvar exige Master logado, fora do escopo deste e2e de guarda), testa a guarda e limpa o perfil
// (sem perfil = construtora, o padrão — nada fica para os outros testes/DEMO).
// @pos-migration: depende de 20261123190030 (projetos_ref_ramo), 20261123191030 (empresa_hub_perfil +
// fn_hub_rota_permitida + matriz module_catalog.ramos_aplicaveis).

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbInsert, dbDelete, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000006'
const BLOQUEIO = 'Esta tela não faz parte do Hub para o tipo da sua empresa'

async function limparPerfil(): Promise<void> {
  await dbDelete('empresa_hub_perfil', `company_id=eq.${DEMO}`).catch(() => {})
}
async function semear(modo: string, ramos: string[]): Promise<void> {
  await limparPerfil()
  await dbInsert('empresa_hub_perfil', { company_id: DEMO, modo, ramos })
}

async function entrar(page: import('@playwright/test').Page, rota: string): Promise<void> {
  await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO)
  await page.goto(rota)
  await aguardarConteudo(page)
}

test.describe('Hub — tipo de empresa e guarda de rota', () => {
  test.afterEach(async ({}, testInfo) => {
    await limparPerfil() // mesmo se o teste falhou no meio: DEMO volta a construtora (sem perfil = padrão)
    await registrarJornada(
      'aceitacao-hub-perfil-modo-ramo-menu',
      testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho',
      testInfo.title,
    )
  })

  test('sem perfil: o card aparece com Construtora como tipo padrão', { tag: '@pos-migration' }, async ({ page }) => {
    await limparPerfil()
    await entrar(page, '/dashboard/projetos/configuracoes')
    await expect(page.getByRole('heading', { name: 'Tipo de empresa no Hub' })).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: /Construtora/, pressed: true })).toBeVisible({ timeout: 15000 })
  })

  // Permutas saiu do Hub para o Gestão Empresarial (CEO 27/11): a tela construtora-only usada aqui passou a ser o
  // Simulador de Obra (ramos_aplicaveis sem hub_prestadora), que a guarda continua bloqueando para a prestadora.
  test('prestadora (pisos): a guarda bloqueia o Simulador de Obra e libera Ordens de serviço', { tag: '@pos-migration' }, async ({ page }) => {
    await semear('prestadora', ['pisos_revestimentos'])
    await entrar(page, '/dashboard/projetos/simulador')
    await expect(page.getByText(BLOQUEIO)).toBeVisible({ timeout: 30000 })

    await page.goto('/dashboard/os')
    await aguardarConteudo(page)
    await expect(page.getByText(BLOQUEIO)).toHaveCount(0)
  })

  test('pessoa física: a guarda bloqueia Clientes (comercial)', { tag: '@pos-migration' }, async ({ page }) => {
    await semear('pessoa_fisica', [])
    await entrar(page, '/dashboard/projetos/clientes')
    await expect(page.getByText(BLOQUEIO)).toBeVisible({ timeout: 30000 })
  })
})
