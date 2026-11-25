// Catálogo de serviço · MÃO DE OBRA — 2 modos de custo (CEO 24-25/11). Prova o CUSTO (o que se paga à equipe):
//  • Por hora (equipe própria): mao_obra_id, quantidade = horas por unidade → custo = custo/h × horas.
//  • Empreitada (paga por unidade feita — m², metro, un, ponto…): linha manual (item_nome_manual) com a unidade
//    e o valor por unidade, quantidade 1 → custo = valor por unidade (sem horas, sem coeficiente).
// A "empreitada" vale para QUALQUER unidade que não seja hora — aqui m² e m (metro linear). Cabe na estrutura atual
// (sem coluna nova). Vale para QUALQUER vertical: roda na DEMO comércio (DEMO_REVENDA). DEMO (RD-69/LGPD).
// Sem @pos-migration: a matemática de custo já é a de produção (a PR só mexe na TELA + ajuda RD-95).
import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbSelect, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

type Servico = { custo_mao_obra: string | number | null }
type Linha = { tipo: string; unidade: string | null; quantidade: string | number | null; custo_unitario: string | number | null; custo_total: string | number | null; ordem: number }

test.describe('Hub · catálogo mão de obra — Por hora × Empreitada (qualquer unidade)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-hub-catalogo-mao-obra-modo', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('função por hora + empreitada por m² + empreitada por metro somam o custo certo', async () => {
    const tag = Date.now()
    let servicoId = '', moId = ''
    const bomIds: string[] = []
    try {
      const serv = await dbInsert<{ id: string }>('projetos_servicos', { company_id: DEMO_REVENDA, codigo: `TSTMO-${tag}`, nome: `Serviço MO modos ${tag}`, unidade: 'm²', is_publico: true, ativo: true })
      servicoId = serv.id
      moId = (await dbInsert<{ id: string }>('projetos_mao_obra', { company_id: DEMO_REVENDA, funcao: `Oficial Teste ${tag}`, custo_hora: 50, ativo: true })).id

      // 1) Por hora (função): 0,2 h por m² × R$ 50/h = R$ 10
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'mao_obra', mao_obra_id: moId, quantidade: 0.2, unidade: 'h', perda_pct: 0, ordem: 1 })).id)
      // 2) Empreitada por m²: linha manual, unidade m², 1 × R$ 18/m² = R$ 18
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'mao_obra', item_nome_manual: 'Empreitada gesso (m²)', custo_unitario_manual: 18, quantidade: 1, unidade: 'm²', perda_pct: 0, ordem: 2 })).id)
      // 3) Empreitada por metro linear: linha manual, unidade m, 1 × R$ 9/m = R$ 9
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'mao_obra', item_nome_manual: 'Empreitada rodapé (metro)', custo_unitario_manual: 9, quantidade: 1, unidade: 'm', perda_pct: 0, ordem: 3 })).id)

      // trigger recalcula a cada insert — custo de mão de obra = 10 + 18 + 9 = 37
      const s = (await dbSelect<Servico>('projetos_servicos', `id=eq.${servicoId}`))[0]
      expect(Number(s.custo_mao_obra), 'MO = por hora 10 + m² 18 + metro 9').toBe(37)

      // custo por linha (cache usado na grade)
      await rpc('fn_projetos_atualizar_cache_bom', { p_servico_id: servicoId })
      const linhas = await dbSelect<Linha>('projetos_servicos_bom', `servico_id=eq.${servicoId}&order=ordem`)
      // por hora
      expect(Number(linhas[0].custo_total), 'por hora: 0,2 × 50 = 10').toBe(10)
      // empreitada m²: custo unitário = o valor por m²; total = 1 × 18; sem horas
      expect(linhas[1].unidade).toBe('m²')
      expect(Number(linhas[1].quantidade)).toBe(1)
      expect(Number(linhas[1].custo_unitario), 'empreitada: o próprio valor por m²').toBe(18)
      expect(Number(linhas[1].custo_total), 'empreitada m²: 1 × 18 = 18').toBe(18)
      // empreitada metro: custo unitário = o valor por metro; total = 1 × 9
      expect(linhas[2].unidade).toBe('m')
      expect(Number(linhas[2].custo_unitario), 'empreitada: o próprio valor por metro').toBe(9)
      expect(Number(linhas[2].custo_total), 'empreitada metro: 1 × 9 = 9').toBe(9)

      // a ficha completa expõe as três linhas de mão de obra
      const completo = await rpc<{ bom: { tipo: string; item_nome: string }[]; validacao: { tem_mao_obra: boolean } }>('fn_projetos_servico_completo', { p_servico_id: servicoId })
      expect(completo.validacao.tem_mao_obra).toBe(true)
      expect(completo.bom.filter((b) => b.tipo === 'mao_obra').length).toBe(3)
      const nomes = completo.bom.map((b) => b.item_nome)
      expect(nomes).toContain('Empreitada gesso (m²)')
      expect(nomes).toContain('Empreitada rodapé (metro)')
    } finally {
      for (const id of bomIds) await dbDelete('projetos_servicos_bom', `id=eq.${id}`)
      if (servicoId) await dbDelete('projetos_servicos', `id=eq.${servicoId}`)
      if (moId) await dbDelete('projetos_mao_obra', `id=eq.${moId}`)
    }
  })
})
