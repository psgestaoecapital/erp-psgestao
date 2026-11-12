// RD-82 (@pos-migration) · Tarefa 029fd118 (decisão 1 · CPF como chave de amarração, CEO 06/11).
// fn_prod_posto_pessoa_alocar passa a casar a pessoa pelo CPF no cadastro da PRÓPRIA empresa
// (compliance_funcionarios): com par, grava o funcionario_id (a tela mostra o nome e "do ponto"); sem par
// (pessoa nova/terceiro), segue MANUAL (só o CPF). Chamado como USUÁRIO real (JWT do robô), nunca service_role.
// Tag @pos-migration: só passa com a migration aplicada (em produção, pós-merge) — informativo no preview.
// DEMO Indústria (RD-69); cria e desfaz o que tocou (apaga o que criou, reabre o que a de-dup fechou).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbDelete, dbPatch, rpcComoRobo, registrarJornada } from '../../support/api'

const DEMO = 'b0700000-0000-4000-a000-000000000005' // Indústria Modelo - DEMO
const dig = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

type Alocar = { ok?: boolean; id?: string; erro?: string }
type Pessoa = { id: string; funcionario_id: string | null; nome: string | null; cpf: string | null; origem: string }
type Listar = { ok?: boolean; pessoas?: Pessoa[]; erro?: string }

test.describe('Aceitação 029fd118 — CPF amarra a pessoa do posto no cadastro (nome + "do ponto")', () => {
  let postoId = ''
  let cpfReal = ''
  let nomeReal = ''
  let cpfNovo = ''
  const criados: string[] = []
  let ativosAntes: string[] = []

  test.beforeAll(async () => {
    const posto = (await dbSelect<{ id: string }>('prod_posto',
      `company_id=eq.${DEMO}&plant_id=not.is.null&select=id&limit=1`))[0]
    postoId = posto?.id ?? ''
    const func = (await dbSelect<{ cpf: string; nome_completo: string }>('compliance_funcionarios',
      `company_id=eq.${DEMO}&cpf=not.is.null&select=cpf,nome_completo&limit=1`))[0]
    cpfReal = dig(func?.cpf)
    nomeReal = func?.nome_completo ?? ''
    // CPF garantidamente FORA do cadastro desta empresa (fica "manual")
    const todos = (await dbSelect<{ cpf: string }>('compliance_funcionarios',
      `company_id=eq.${DEMO}&cpf=not.is.null&select=cpf&limit=1000`)).map((f) => dig(f.cpf))
    cpfNovo = ['00000000191', '11111111111', '00000000000', '12345678900', '98765432100']
      .find((c) => !todos.includes(c)) ?? '00000000191'
    // foto das alocações ativas do posto, para restaurar no fim
    ativosAntes = (await dbSelect<{ id: string }>('prod_posto_pessoa',
      `company_id=eq.${DEMO}&posto_id=eq.${postoId}&vigencia_fim=is.null&select=id`)).map((p) => p.id)
  })

  test.afterAll(async ({}, testInfo) => {
    for (const id of criados) await dbDelete('prod_posto_pessoa', `id=eq.${id}`)
    // reabre o que a de-dup possa ter encerrado (restaura a foto)
    for (const id of ativosAntes) await dbPatch('prod_posto_pessoa', `id=eq.${id}`, { vigencia_fim: null })
    await registrarJornada('aceitacao-posto-cpf-029fd118',
      testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('CPF do cadastro → nome e "do ponto"; CPF de fora → manual sem nome', { tag: '@pos-migration' }, async () => {
    expect(postoId, 'a DEMO Indústria precisa ter ao menos um posto com planta').not.toBe('')
    expect(cpfReal, 'a DEMO Indústria precisa ter ao menos um funcionário com CPF').not.toBe('')

    const r1 = await rpcComoRobo<Alocar>('fn_prod_posto_pessoa_alocar', { p_dados: { posto_id: postoId, cpf: cpfReal } })
    expect(r1.status, r1.texto).toBe(200)
    expect(r1.corpo?.ok, `alocar CPF do cadastro: ${r1.corpo?.erro ?? r1.texto}`).toBe(true)
    if (r1.corpo?.id) criados.push(r1.corpo.id)

    const r2 = await rpcComoRobo<Alocar>('fn_prod_posto_pessoa_alocar', { p_dados: { posto_id: postoId, cpf: cpfNovo } })
    expect(r2.corpo?.ok, `alocar CPF de fora: ${r2.corpo?.erro ?? r2.texto}`).toBe(true)
    if (r2.corpo?.id) criados.push(r2.corpo.id)

    const lst = await rpcComoRobo<Listar>('fn_prod_posto_pessoas_listar', { p_posto_id: postoId })
    const pessoas = lst.corpo?.pessoas ?? []

    const real = pessoas.find((p) => dig(p.cpf) === cpfReal)
    expect(real, 'a pessoa do CPF do cadastro tem de aparecer no posto').toBeTruthy()
    expect(real!.funcionario_id, 'CPF do cadastro deve resolver o funcionario_id').not.toBeNull()
    expect(real!.nome).toBe(nomeReal)
    expect(real!.origem).toBe('ponto')

    const novo = pessoas.find((p) => dig(p.cpf) === cpfNovo)
    expect(novo, 'a pessoa do CPF de fora tem de aparecer no posto').toBeTruthy()
    expect(novo!.funcionario_id, 'CPF de fora não casa no cadastro → manual').toBeNull()
    expect(novo!.origem).toBe('manual')
  })
})
