// Catálogo de serviço · MÃO DE OBRA em 2 modos de custo (CEO 24/11). Prova o CUSTO (o que se paga à equipe):
//  • Modo A — Por hora (equipe própria): mao_obra_id, quantidade = horas por m² → custo = custo/h × horas/m².
//  • Modo B — Por m² (empreitada): linha manual (item_nome_manual) com unidade m², quantidade 1 e o valor por m²
//    → custo = valor por m² (sem horas, sem coeficiente). Cabe na estrutura atual (sem coluna nova).
// Vale para QUALQUER vertical: roda na DEMO comércio (DEMO_REVENDA), não só construção. DEMO (RD-69/LGPD).
// Sem @pos-migration: a matemática de custo já é a de produção (a PR só mexe na TELA + ajuda RD-95).
import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbSelect, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

type Servico = { custo_mao_obra: string | number | null; custo_unitario_total: string | number | null }
type Linha = { tipo: string; unidade: string | null; quantidade: string | number | null; custo_unitario: string | number | null; custo_total: string | number | null; ordem: number }

test.describe('Hub · catálogo mão de obra — Por hora × Por m²', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-catalogo-mao-obra-modo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('Modo A (por hora) e Modo B (por m² empreitada) somam o custo de mão de obra certo', async () => {
    const tag = Date.now()
    let servicoId = '', moId = ''
    const bomIds: string[] = []
    try {
      const serv = await dbInsert<{ id: string }>('projetos_servicos', { company_id: DEMO_REVENDA, codigo: `TSTMO-${tag}`, nome: `Serviço MO modos ${tag}`, unidade: 'm²', is_publico: true, ativo: true })
      servicoId = serv.id
      moId = (await dbInsert<{ id: string }>('projetos_mao_obra', { company_id: DEMO_REVENDA, funcao: `Oficial Teste ${tag}`, custo_hora: 50, ativo: true })).id

      // Modo A — por hora: 0,2 h por m² × R$ 50/h = R$ 10/m²
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'mao_obra', mao_obra_id: moId, quantidade: 0.2, unidade: 'h', perda_pct: 0, ordem: 1 })).id)
      // Modo B — por m² (empreitada): linha manual, unidade m², 1 × R$ 18/m² = R$ 18/m²
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'mao_obra', item_nome_manual: 'Empreitada gesso (equipe)', custo_unitario_manual: 18, quantidade: 1, unidade: 'm²', perda_pct: 0, ordem: 2 })).id)

      // trigger recalcula a cada insert — custo de mão de obra = 10 (A) + 18 (B) = 28
      const s = (await dbSelect<Servico>('projetos_servicos', `id=eq.${servicoId}`))[0]
      expect(Number(s.custo_mao_obra), 'MO = por hora 10 + por m² 18').toBe(28)

      // custo por linha (cache usado na grade)
      await rpc('fn_projetos_atualizar_cache_bom', { p_servico_id: servicoId })
      const linhas = await dbSelect<Linha>('projetos_servicos_bom', `servico_id=eq.${servicoId}&order=ordem`)
      // Modo A
      expect(Number(linhas[0].custo_total), 'por hora: 0,2 × 50 = 10').toBe(10)
      // Modo B: custo unitário = o valor por m² digitado; total = 1 × 18; sem horas (unidade m²)
      expect(linhas[1].unidade).toBe('m²')
      expect(Number(linhas[1].quantidade)).toBe(1)
      expect(Number(linhas[1].custo_unitario), 'por m²: o próprio valor pago por m²').toBe(18)
      expect(Number(linhas[1].custo_total), 'por m²: 1 × 18 = 18').toBe(18)

      // a ficha completa expõe as duas linhas de mão de obra
      const completo = await rpc<{ bom: { tipo: string; item_nome: string }[]; validacao: { tem_mao_obra: boolean } }>('fn_projetos_servico_completo', { p_servico_id: servicoId })
      expect(completo.validacao.tem_mao_obra).toBe(true)
      expect(completo.bom.filter((b) => b.tipo === 'mao_obra').length).toBe(2)
      expect(completo.bom.map((b) => b.item_nome)).toContain('Empreitada gesso (equipe)')
    } finally {
      for (const id of bomIds) await dbDelete('projetos_servicos_bom', `id=eq.${id}`)
      if (servicoId) await dbDelete('projetos_servicos', `id=eq.${servicoId}`)
      if (moId) await dbDelete('projetos_mao_obra', `id=eq.${moId}`)
    }
  })
})
