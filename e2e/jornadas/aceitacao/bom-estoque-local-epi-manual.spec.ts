// BOM "Adicionar item" (CEO 18/11, FC Pisos/Diego): 4 tipos (Material/MO/Equipamento/EPI), itens do ESTOQUE REAL
// (erp_produtos) + ENTRADA MANUAL, EPI vindo do estoque (Decisão 🅰️). Prova que o custo soma TODAS as fontes e que
// o EPI entra no total (material + EPI = custo_material; não some), nomes resolvem, e a RPC de fontes do modal responde.
// @pos-migration: colunas/funcoes só existem após o deploy. DEMO (RD-69/LGPD), serviço público p/ ler via service.
import { test, expect } from '../../support/fixtures'
import { rpc, dbInsert, dbSelect, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

type Servico = { custo_material: string | number | null; custo_mao_obra: string | number | null; custo_unitario_total: string | number | null }
type Linha = { tipo: string; custo_total: string | number | null; ordem: number }

test.describe('BOM · estoque real + local + EPI + manual @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-bom-estoque-local-epi-manual', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('soma material+manual+EPI+MO de fontes diversas; EPI entra no total; nomes resolvem', async () => {
    const tag = Date.now()
    let servicoId = '', p1 = '', p2 = '', moId = ''
    const bomIds: string[] = []
    try {
      const serv = await dbInsert<{ id: string }>('projetos_servicos', { company_id: DEMO_REVENDA, codigo: `TSTBOM-${tag}`, nome: `Serviço BOM teste ${tag}`, unidade: 'un', is_publico: true, ativo: true })
      servicoId = serv.id
      p1 = (await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO_REVENDA, codigo: `P1-${tag}`, nome: 'Produto Material Teste', unidade: 'un', preco_custo: 10, ativo: true })).id
      p2 = (await dbInsert<{ id: string }>('erp_produtos', { company_id: DEMO_REVENDA, codigo: `P2-${tag}`, nome: 'Luva Nitrílica Teste', unidade: 'par', preco_custo: 8, ativo: true })).id
      moId = (await dbInsert<{ id: string }>('projetos_mao_obra', { company_id: DEMO_REVENDA, funcao: `Pedreiro Teste ${tag}`, custo_hora: 30, ativo: true })).id

      // material via produto do estoque (2 × 10 = 20)
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'insumo', produto_id: p1, quantidade: 2, perda_pct: 0, ordem: 1 })).id)
      // entrada manual (3 × 5 = 15)
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'insumo', item_nome_manual: 'Parafuso manual', custo_unitario_manual: 5, quantidade: 3, perda_pct: 0, ordem: 2 })).id)
      // EPI via produto do estoque (1 × 8 = 8) → entra no material
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'epi', produto_id: p2, quantidade: 1, perda_pct: 0, ordem: 3 })).id)
      // mão de obra (2 × 30 = 60)
      bomIds.push((await dbInsert<{ id: string }>('projetos_servicos_bom', { servico_id: servicoId, tipo: 'mao_obra', mao_obra_id: moId, quantidade: 2, perda_pct: 0, ordem: 4 })).id)

      // o trigger recalcula o serviço a cada insert — confere os totais (EPI dentro do material)
      const serv2 = (await dbSelect<Servico>('projetos_servicos', `id=eq.${servicoId}`))[0]
      expect(Number(serv2.custo_material), 'material 20 + manual 15 + EPI 8').toBe(43)
      expect(Number(serv2.custo_mao_obra)).toBe(60)
      expect(Number(serv2.custo_unitario_total), 'EPI entra no total').toBe(103)

      // custo por linha (cache do BOM, usado na grade)
      await rpc('fn_projetos_atualizar_cache_bom', { p_servico_id: servicoId })
      const linhas = await dbSelect<Linha>('projetos_servicos_bom', `servico_id=eq.${servicoId}&order=ordem`)
      expect(Number(linhas[0].custo_total)).toBe(20)
      expect(Number(linhas[1].custo_total)).toBe(15)
      expect(Number(linhas[2].custo_total)).toBe(8)
      expect(Number(linhas[3].custo_total)).toBe(60)

      // nome resolve em todas as fontes + tem_epi
      const completo = await rpc<{ bom: { tipo: string; item_nome: string }[]; validacao: { tem_epi: boolean; tem_mao_obra: boolean } }>('fn_projetos_servico_completo', { p_servico_id: servicoId })
      const nomes = completo.bom.map((b) => b.item_nome)
      expect(nomes).toContain('Produto Material Teste')
      expect(nomes).toContain('Parafuso manual')
      expect(nomes).toContain('Luva Nitrílica Teste')
      expect(completo.validacao.tem_epi).toBe(true)
      expect(completo.validacao.tem_mao_obra).toBe(true)

      // fontes do estoque para o modal (produtos + locais + mapa)
      const fontes = await rpc<{ ok: boolean; produtos: { id: string }[]; locais: unknown[] }>('fn_bom_estoque_fontes', { p_company_id: DEMO_REVENDA })
      expect(fontes.ok).toBe(true)
      expect(fontes.produtos.some((p) => p.id === p1)).toBe(true)
      expect(fontes.produtos.some((p) => p.id === p2)).toBe(true)
      expect(Array.isArray(fontes.locais)).toBe(true)
    } finally {
      for (const id of bomIds) await dbDelete('projetos_servicos_bom', `id=eq.${id}`)
      if (servicoId) await dbDelete('projetos_servicos', `id=eq.${servicoId}`)
      if (p1) await dbDelete('erp_produtos', `id=eq.${p1}`)
      if (p2) await dbDelete('erp_produtos', `id=eq.${p2}`)
      if (moId) await dbDelete('projetos_mao_obra', `id=eq.${moId}`)
    }
  })
})
