// Equipes de Mão de obra (CEO 18/11, Hub/Projetos · piloto FC Pisos): a empresa monta uma equipe, o sistema calcula o
// custo MÉDIO/hora (média do custo/hora dos membros) e a empresa pode fixar um custo EFETIVO/hora (fica "ajustado" e
// não acompanha mais o médio); limpar o efetivo volta a acompanhar o médio. Multi-tenant: a equipe só aparece para a
// empresa dona. @pos-migration: as tabelas/RPCs só existem após o deploy. Roda na DEMO (RD-69/LGPD), self-cleaning.
import { test, expect } from '../../support/fixtures'
import { rpc, dbSelect, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

type Equipe = { id: string; custo_medio_hora: string | number | null; custo_hora_efetivo: string | number | null; qtd_pessoas: number; ajustado: boolean; ativo: boolean }

test.describe('Equipes de mão de obra · custo médio/hora e efetivo editável @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-projetos-equipe-custo-medio', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('calcula o médio, mantém o efetivo ajustado, volta ao médio e isola por empresa', async () => {
    const nome = `Equipe Lapa (aceitação ${Date.now()})`
    let id = ''
    try {
      // 1) cria com 3 membros (22, 30, 32) → médio = 28,00; sem ajuste o efetivo acompanha o médio
      const criado = await rpc<{ ok: boolean; id: string; custo_medio_hora: number; qtd_pessoas: number }>('fn_projetos_equipe_salvar', {
        p_company_id: DEMO_REVENDA,
        p_equipe: { nome },
        p_membros: [
          { nome_pessoa: 'Servente', custo_hora: 22, ordem: 0 },
          { nome_pessoa: 'Pintor', custo_hora: 30, ordem: 1 },
          { nome_pessoa: 'Pedreiro', custo_hora: 32, ordem: 2 },
        ],
      })
      expect(criado.ok).toBe(true)
      id = criado.id
      expect(Number(criado.custo_medio_hora)).toBe(28)
      expect(criado.qtd_pessoas).toBe(3)

      let eq = (await dbSelect<Equipe>('projetos_equipe', `id=eq.${id}`))[0]
      expect(Number(eq.custo_hora_efetivo), 'sem ajuste, o efetivo acompanha o médio').toBe(28)
      expect(eq.ajustado).toBe(false)

      // 2) fixa o efetivo em 35 → marca "ajustado"
      expect((await rpc<{ ok: boolean }>('fn_projetos_equipe_set_custo_efetivo', { p_company_id: DEMO_REVENDA, p_id: id, p_custo: 35 })).ok).toBe(true)
      eq = (await dbSelect<Equipe>('projetos_equipe', `id=eq.${id}`))[0]
      expect(Number(eq.custo_hora_efetivo)).toBe(35)
      expect(eq.ajustado).toBe(true)

      // 3) acrescenta o Mestre (48) → médio vira 33,00; o efetivo ajustado NÃO muda (fica 35)
      const atualizado = await rpc<{ ok: boolean; custo_medio_hora: number; qtd_pessoas: number }>('fn_projetos_equipe_salvar', {
        p_company_id: DEMO_REVENDA,
        p_equipe: { nome },
        p_membros: [
          { nome_pessoa: 'Servente', custo_hora: 22, ordem: 0 },
          { nome_pessoa: 'Pintor', custo_hora: 30, ordem: 1 },
          { nome_pessoa: 'Pedreiro', custo_hora: 32, ordem: 2 },
          { nome_pessoa: 'Mestre', custo_hora: 48, ordem: 3 },
        ],
        p_id: id,
      })
      expect(Number(atualizado.custo_medio_hora)).toBe(33)
      expect(atualizado.qtd_pessoas).toBe(4)
      eq = (await dbSelect<Equipe>('projetos_equipe', `id=eq.${id}`))[0]
      expect(Number(eq.custo_hora_efetivo), 'o efetivo ajustado não acompanha o médio').toBe(35)
      expect(eq.ajustado).toBe(true)

      // 4) limpa o efetivo (NULL) → volta a acompanhar o médio (33) e deixa de ser "ajustado"
      expect((await rpc<{ ok: boolean }>('fn_projetos_equipe_set_custo_efetivo', { p_company_id: DEMO_REVENDA, p_id: id, p_custo: null })).ok).toBe(true)
      eq = (await dbSelect<Equipe>('projetos_equipe', `id=eq.${id}`))[0]
      expect(Number(eq.custo_hora_efetivo)).toBe(33)
      expect(eq.ajustado).toBe(false)

      // 5) multi-tenant: a equipe aparece para a dona e NÃO para outra empresa
      const minha = await rpc<{ equipes: { id: string; membros: unknown[] }[] }>('fn_projetos_equipe_listar', { p_company_id: DEMO_REVENDA })
      const achada = minha.equipes.find((e) => e.id === id)
      expect(achada, 'a empresa dona vê a equipe').toBeTruthy()
      expect(achada!.membros.length).toBe(4)
      const outra = await rpc<{ equipes: { id: string }[] }>('fn_projetos_equipe_listar', { p_company_id: '00000000-0000-4000-a000-0000000000ff' })
      expect(outra.equipes.some((e) => e.id === id), 'outra empresa não vê a equipe').toBe(false)

      // 6) arquivar não apaga (RD-30): some do uso ativo, histórico fica
      expect((await rpc<{ ok: boolean; ativo: boolean }>('fn_projetos_equipe_arquivar', { p_company_id: DEMO_REVENDA, p_id: id, p_ativo: false })).ativo).toBe(false)
      eq = (await dbSelect<Equipe>('projetos_equipe', `id=eq.${id}`))[0]
      expect(eq.ativo).toBe(false)
    } finally {
      if (id) await dbDelete('projetos_equipe', `id=eq.${id}`) // cascade remove os membros
    }
  })
})
