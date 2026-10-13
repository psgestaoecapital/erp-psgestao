// Hub · Mão de obra v2 — remuneração por COMPONENTES (SPEC Hub E1+E2 rev. 16, seção 5.1 · lista do banco e valores-padrão
// aprovados pelo CEO em 01/10, todos "a confirmar com o contador").
// 1) A conta do banco é a da tela: exemplo da SPEC 5.1 (fixo R$ 2.000 + R$ 3,00/m² × 500 → R$ 7.077 · R$ 40,21/h ·
//    R$ 14,15/m²), a ficha antiga (R$ 31,18/h), RPA +20%, MEI em obra +20% e diarista com alerta acima de 8 dias.
// 2) Pela tela: perfil com fixo + produção (volume estimado) mostra custo mensal, da hora e por m² enquanto digita; salvar
//    sem componente com valor é barrado; salvo, os componentes ficam gravados com as chaves de incidência.
// 3) Diarista com 10 dias mostra o alerta de risco trabalhista.
// Depende da migration 20261002130000 → @pos-migration. Demonstração Comércio (GE); dados de teste removidos no fim.

import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbSelect, dbDelete, rpc, registrarJornada } from '../../support/api'
import { calcularCustoMaoObra, chavesPadrao, type Componente, type Encargos } from '../../../src/lib/hub/custoMaoObra'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RUN = Date.now().toString(36)
const FUNCAO = `Gesseiro componentes ${RUN}`
const PERFIL = `Gesseiro produção ${RUN}`
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const ENC_SPEC = { prov_13_pct: 8.33, prov_ferias_pct: 11.11, prov_rescisao_pct: 4, encargos_folha_pct: 36.8, padroes: { dsr_fator: 0.16667, rpa_inss_pct: 20, salario_minimo: 1518 } }

test.describe('Hub · Mão de obra v2 — remuneração por componentes', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
  })

  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-mao-obra-componentes', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.afterAll(async () => {
    const fs = await dbSelect<{ id: string }>('erp_funcao_mao_obra', `company_id=eq.${DEMO_GE}&nome=eq.${encodeURIComponent(FUNCAO)}&select=id`).catch(() => [])
    for (const f of fs) {
      const fichas = await dbSelect<{ id: string }>('erp_mao_obra_custo', `funcao_id=eq.${f.id}&select=id`).catch(() => [])
      for (const k of fichas) {
        await dbDelete('erp_mao_obra_acesso_log', `ficha_id=eq.${k.id}`).catch(() => {})
        await dbDelete('erp_mao_obra_componente', `ficha_id=eq.${k.id}`).catch(() => {})
      }
      await dbDelete('erp_mao_obra_custo', `funcao_id=eq.${f.id}`).catch(() => {})
      await dbDelete('erp_funcao_mao_obra', `id=eq.${f.id}`).catch(() => {})
    }
  })

  test('a conta do banco é a da tela (SPEC 5.1, ficha antiga, RPA, MEI em obra, diarista)', { tag: '@pos-migration' }, async () => {
    const casos: { nome: string; ficha: Record<string, unknown>; mensal?: number; hora?: number; unidade?: number; alerta?: string }[] = [
      { nome: 'SPEC 5.1', hora: 40.21, unidade: 14.15, alerta: 'volume_estimado',
        ficha: { vinculo: 'clt', horas_produtivas_mes: 176, beneficio_vt: 300, beneficio_alimentacao: 500, componentes: [
          { tipo: 'fixo', subtipo: 'mensal', valor: 2000, ...chavesPadrao('clt', 'fixo', 'mensal') },
          { tipo: 'producao', valor: 3, quantidade: 500, unidade: 'm2', estimado: true, ...chavesPadrao('clt', 'producao') }] } },
      { nome: 'ficha antiga', mensal: 5487.03, hora: 31.18, ficha: { vinculo: 'clt', forma_pagamento: 'mensal', salario: 2800, beneficio_vt: 300, beneficio_alimentacao: 500, horas_produtivas_mes: 176 } },
      { nome: 'RPA', mensal: 3600, ficha: { vinculo: 'rpa', horas_produtivas_mes: 176, componentes: [{ tipo: 'fixo', subtipo: 'mensal', valor: 3000 }] } },
      { nome: 'MEI em obra', mensal: 2880, ficha: { vinculo: 'pj', mei_servico_obra: true, componentes: [{ tipo: 'producao', valor: 4, quantidade: 600, unidade: 'm2' }] } },
      { nome: 'diarista 10 dias', mensal: 1800, alerta: 'diarista_mais_8_dias', ficha: { vinculo: 'diarista', horas_produtivas_mes: 80, componentes: [{ tipo: 'diaria', valor: 150, quantidade: 10 }] } },
    ]
    for (const c of casos) {
      const banco = await rpc<{ custo_mensal: number | null; custo_hora: number | null; custo_unidade: number | null; alertas: string[] }>('fn_mao_obra_custo_calcular', { p_ficha: c.ficha, p_encargos: ENC_SPEC })
      const tela = calcularCustoMaoObra(c.ficha as Parameters<typeof calcularCustoMaoObra>[0], ENC_SPEC)
      expect([tela.custo_mensal, tela.custo_hora, tela.custo_unidade], `${c.nome}: banco = tela`).toEqual([banco.custo_mensal, banco.custo_hora, banco.custo_unidade].map((x) => (x === null ? null : Number(x))))
      if (c.mensal !== undefined) expect(Number(banco.custo_mensal), c.nome).toBe(c.mensal)
      if (c.hora !== undefined) expect(Number(banco.custo_hora), c.nome).toBe(c.hora)
      if (c.unidade !== undefined) expect(Number(banco.custo_unidade), c.nome).toBe(c.unidade)
      if (c.alerta) expect(banco.alertas, c.nome).toContain(c.alerta)
    }
  })

  test('pela tela: fixo + produção → custo mensal, hora e m²; sem componente com valor não salva; diarista avisa', { tag: '@pos-migration' }, async ({ page }) => {
    const enc = await rpc<Encargos>('fn_mao_obra_encargos_vigentes', { p_company_id: DEMO_GE })
    const inc = enc.padroes?.incidencia ?? {}
    const comps: Componente[] = [
      { tipo: 'fixo', subtipo: 'mensal', valor: 2000, ...chavesPadrao('clt', 'fixo', 'mensal', inc) },
      { tipo: 'producao', valor: 3, quantidade: 500, unidade: 'm2', estimado: true, ...chavesPadrao('clt', 'producao', null, inc) },
    ]
    const esperado = calcularCustoMaoObra({ vinculo: 'clt', horas_produtivas_mes: 176, beneficio_vt: 300, beneficio_alimentacao: 500, componentes: comps }, enc)

    await page.addInitScript((id) => { try { window.localStorage.setItem('ps_empresa_sel', id) } catch { /* noop */ } }, DEMO_GE)
    await page.goto('/dashboard/projetos/mao-obra')
    await aguardarConteudo(page)
    await expect(page.getByTestId('mao-obra-page')).toBeVisible()

    // função por produção (m²)
    await page.getByTestId('mao-obra-nova-funcao').click()
    await page.getByTestId('funcao-nome').fill(FUNCAO)
    await page.getByTestId('funcao-forma').selectOption('producao')
    await page.getByTestId('funcao-salvar').click()
    await expect.poll(async () => (await dbSelect<{ id: string }>('erp_funcao_mao_obra', `company_id=eq.${DEMO_GE}&nome=eq.${encodeURIComponent(FUNCAO)}&select=id`))[0]?.id ?? '',
      { timeout: 15000 }).not.toBe('')
    const [funcao] = await dbSelect<{ id: string; forma_pagamento: string; unidade_producao: string }>('erp_funcao_mao_obra', `company_id=eq.${DEMO_GE}&nome=eq.${encodeURIComponent(FUNCAO)}&select=id,forma_pagamento,unidade_producao`)
    expect([funcao.forma_pagamento, funcao.unidade_producao]).toEqual(['producao', 'm2'])

    // perfil: escolher a função de produção já traz o componente "produção por m²"
    await page.getByTestId('mao-obra-novo-perfil').click()
    const modal = page.getByTestId('mao-obra-modal-ficha')
    await modal.getByTestId('ficha-vinculo').selectOption('clt')
    await modal.getByTestId('ficha-funcao').selectOption(funcao.id)
    await modal.getByPlaceholder('Gesseiro padrão').fill(PERFIL)
    await modal.getByTestId('ficha-horas').fill('176')
    await modal.getByTestId('ficha-beneficio_vt').fill('300')
    await modal.getByTestId('ficha-beneficio_alimentacao').fill('500')
    const fixo = modal.getByTestId('componente-0')
    await fixo.getByTestId('componente-tipo').selectOption('fixo')
    await fixo.getByTestId('componente-valor').fill('')
    // sem componente com valor: não salva e diz o que falta
    const prod = modal.getByTestId('componente-1')
    await expect(prod.getByTestId('componente-tipo'), 'a função de produção sugere o componente de produção').toHaveValue('producao')
    await modal.getByTestId('ficha-salvar').click()
    await expect(modal.getByTestId('ficha-faltando')).toContainText('pelo menos um componente')
    await fixo.getByTestId('componente-valor').fill('2000')
    await prod.getByTestId('componente-valor').fill('3')
    await prod.getByTestId('componente-quantidade').fill('500')
    await expect(prod.getByTestId('componente-estimado')).toBeChecked()
    await expect(modal.getByTestId('ficha-custo-mensal')).toHaveText(brl(esperado.custo_mensal!))
    await expect(modal.getByTestId('ficha-custo-hora')).toHaveText(brl(esperado.custo_hora!))
    await expect(modal.getByTestId('ficha-custo-unidade')).toHaveText(brl(esperado.custo_unidade!))
    await expect(modal.getByTestId('ficha-alerta-estimado')).toBeVisible()
    await modal.getByTestId('ficha-salvar').click()
    await expect(modal).toBeHidden({ timeout: 15000 })

    const [ficha] = await dbSelect<{ id: string; forma_pagamento: string; salario: number }>('erp_mao_obra_custo', `funcao_id=eq.${funcao.id}&select=id,forma_pagamento,salario`)
    expect(Number(ficha?.salario), 'o fixo mensal fica também na coluna salário (histórico)').toBe(2000)
    const gravados = await dbSelect<{ tipo: string; valor: number; quantidade: number; estimado: boolean; gera_dsr: boolean; integra_remuneracao: boolean }>('erp_mao_obra_componente',
      `ficha_id=eq.${ficha.id}&select=tipo,valor,quantidade,estimado,gera_dsr,integra_remuneracao&order=ordem`)
    expect(gravados.map((g) => [g.tipo, Number(g.valor), Number(g.quantidade), g.estimado, g.gera_dsr])).toEqual([['fixo', 2000, 0, false, comps[0].gera_dsr], ['producao', 3, 500, true, comps[1].gera_dsr]])
    const lista = await page.getByTestId('mao-obra-equipe').textContent()
    expect(lista).toContain(PERFIL)

    // diarista com 10 dias: alerta de risco trabalhista (não salva — só a tela)
    await page.getByTestId('mao-obra-novo-perfil').click()
    await modal.getByTestId('ficha-vinculo').selectOption('diarista')
    const d = modal.getByTestId('componente-0')
    await d.getByTestId('componente-tipo').selectOption('diaria')
    await d.getByTestId('componente-valor').fill('150')
    await d.getByTestId('componente-quantidade').fill('10')
    await expect(modal.getByTestId('ficha-alerta-diarista')).toBeVisible()
    await d.getByTestId('componente-quantidade').fill('8')
    await expect(modal.getByTestId('ficha-alerta-diarista')).toBeHidden()
  })
})
