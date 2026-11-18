// Equipes (CEO 18/11): o membro guarda o NOME da função como rótulo próprio (snapshot), porque as funções da empresa
// (erp_funcao_mao_obra) não têm vínculo com projetos_mao_obra. Prova que fn_projetos_equipe_salvar grava funcao_nome e
// fn_projetos_equipe_listar devolve, mesmo sem funcao_mao_obra_id. @pos-migration: a coluna só existe após o deploy.
import { test, expect } from '../../support/fixtures'
import { rpc, dbDelete, DEMO_REVENDA, registrarJornada } from '../../support/api'

test.describe('Equipes · rótulo de função (snapshot) @pos-migration', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-projetos-equipe-funcao-nome', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('salvar grava funcao_nome e listar devolve o rótulo, sem precisar de projetos_mao_obra', async () => {
    const nome = `Equipe Fn (aceitação ${Date.now()})`
    let id = ''
    try {
      const r = await rpc<{ ok: boolean; id: string }>('fn_projetos_equipe_salvar', {
        p_company_id: DEMO_REVENDA,
        p_equipe: { nome },
        p_membros: [
          { nome_pessoa: 'Airton', funcao_nome: 'Pedreiro', custo_hora: 32, ordem: 0 },
          { nome_pessoa: 'Avulso', custo_hora: 20, ordem: 1 }, // sem função → funcao_nome nulo
        ],
      })
      expect(r.ok).toBe(true)
      id = r.id

      const lista = await rpc<{ equipes: { id: string; membros: { nome_pessoa: string; funcao_nome: string | null; custo_hora: number }[] }[] }>('fn_projetos_equipe_listar', { p_company_id: DEMO_REVENDA })
      const eq = lista.equipes.find((e) => e.id === id)
      expect(eq, 'equipe aparece').toBeTruthy()
      const pedreiro = eq!.membros.find((m) => m.nome_pessoa === 'Airton')
      expect(pedreiro?.funcao_nome, 'rótulo da função guardado como snapshot').toBe('Pedreiro')
      const avulso = eq!.membros.find((m) => m.nome_pessoa === 'Avulso')
      expect(avulso?.funcao_nome ?? null, 'sem função → nulo').toBeNull()
    } finally {
      if (id) await dbDelete('projetos_equipe', `id=eq.${id}`)
    }
  })
})
