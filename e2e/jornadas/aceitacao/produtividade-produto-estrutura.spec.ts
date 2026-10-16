// Produtividade Onda 2 (banco): catálogo genérico de produtos + estrutura de desmontagem, chamados COMO USUÁRIO (RD-82)
// pelas mesmas RPCs da tela. Migration 20261007130010 → @pos-migration. Roda na DEMO Indústria (SST); nada é apagado (arquiva).
// Cobre: cadastro manual, editar/arquivar/reativar, ligação origem→saída, ciclo recusado, rendimento zero recusado,
// aviso de soma >100%, "Colar lista" (prévia não grava; linha inválida avisada; grava como rascunho) e isolamento por empresa.

import { test, expect } from '../../support/fixtures'
import { rpc, dbSelect } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const OUTRA_EMPRESA = 'b0700000-0000-4000-a000-000000000002'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}${Date.now().toString(36)}`.replace(/[^a-z0-9]/gi, '').slice(-8)
const cod = (s: string) => `T${RUN}${s}`

type Nos = { ok: boolean; nos: { id: string; nivel: number; origem_codigo: string; produto_codigo: string; status: string; rendimento_padrao_pct: number | null; ativo: boolean }[]; avisos_soma: unknown[] }
type Colar = { ok: boolean; gravado: boolean; gravadas: number; validas: unknown[]; nao_casaram: { linha: number; motivo: string }[] }

test.describe('Produtividade · produto e estrutura (Onda 2 banco)', { tag: '@pos-migration' }, () => {
  let plant = ''
  const ids: Record<string, string> = {}
  const ligacoes: string[] = []

  const salvarProduto = (k: string, extra: Record<string, unknown> = {}) =>
    rpc<{ id: string }>('fn_prod_produto_salvar', { p_company_id: DEMO_SST, p_plant_id: plant, p_id: null, p_codigo: cod(k), p_nome: `Produto ${k} ${RUN}`, p_papel: 'intermediario', ...extra })
  const ligar = (o: string, p: string, extra: Record<string, unknown> = {}) =>
    rpc<{ id: string; avisos: unknown[] }>('fn_prod_estrutura_salvar', { p_company_id: DEMO_SST, p_plant_id: plant, p_id: null, p_origem_produto_id: ids[o], p_produto_id: ids[p], ...extra })
  const arvore = (k: string) => rpc<Nos>('fn_prod_estrutura_listar', { p_company_id: DEMO_SST, p_plant_id: plant, p_produto_id: ids[k] })
  const colar = (linhas: string, p_gravar: boolean) => rpc<Colar>('fn_prod_estrutura_colar', { p_company_id: DEMO_SST, p_plant_id: plant, p_linhas: linhas, p_gravar })

  test.beforeAll(async () => {
    const [pl] = await dbSelect<{ id: string }>('industrial_plants', `company_id=eq.${DEMO_SST}&select=id&limit=1`)
    expect(pl, 'a demo Indústria tem planta').toBeTruthy()
    plant = pl.id
    ids.A = (await salvarProduto('A', { p_papel: 'acabado' })).id
    ids.B = (await salvarProduto('B')).id
    ids.C = (await salvarProduto('C', { p_papel: 'origem' })).id
    ids.D = (await salvarProduto('D', { p_papel: 'subproduto' })).id
  })
  test.afterAll(async () => {
    for (const id of ligacoes) await rpc('fn_prod_estrutura_arquivar', { p_company_id: DEMO_SST, p_id: id, p_ativo: false }).catch(() => {})
    for (const id of Object.values(ids)) await rpc('fn_prod_produto_arquivar', { p_company_id: DEMO_SST, p_id: id, p_ativo: false }).catch(() => {})
  })

  test('produto: código repetido recusado, editar, arquivar some da lista e reativar', async () => {
    await expect(salvarProduto('A')).rejects.toThrow(/codigo_ja_existe/)
    await rpc('fn_prod_produto_salvar', { p_company_id: DEMO_SST, p_plant_id: plant, p_id: ids.B, p_codigo: cod('B'), p_nome: `Renomeado ${RUN}`, p_papel: 'intermediario' })
    const busca = () => rpc<{ itens: { id: string; nome: string }[] }>('fn_prod_produto_listar', { p_company_id: DEMO_SST, p_plant_id: plant, p_busca: cod('B') })
    expect((await busca()).itens.map(i => i.nome)).toEqual([`Renomeado ${RUN}`])
    await rpc('fn_prod_produto_arquivar', { p_company_id: DEMO_SST, p_id: ids.B, p_ativo: false })
    expect((await busca()).itens).toHaveLength(0)
    await rpc('fn_prod_produto_arquivar', { p_company_id: DEMO_SST, p_id: ids.B, p_ativo: true })
    expect((await busca()).itens).toHaveLength(1)
  })

  test('estrutura: árvore do acabado até a origem, ciclo e rendimento zero recusados, aviso de soma > 100%', async () => {
    const l1 = await ligar('B', 'A', { p_tipo_saida: 'principal', p_rendimento_pct: 60 })
    const l2 = await ligar('C', 'B', { p_rendimento_pct: null })
    ligacoes.push(l1.id, l2.id)
    const a = await arvore('A')
    expect(a.nos.map(n => [n.nivel, n.origem_codigo, n.produto_codigo])).toEqual([[1, cod('B'), cod('A')], [2, cod('C'), cod('B')]])
    expect(a.nos[1].rendimento_padrao_pct).toBeNull() // "a definir", nunca zero
    expect(a.nos.every(n => n.status === 'rascunho')).toBe(true)
    await expect(ligar('A', 'C')).rejects.toThrow(/ciclo_na_estrutura/)
    await expect(ligar('A', 'A')).rejects.toThrow(/ciclo_na_estrutura/)
    await expect(ligar('D', 'A', { p_rendimento_pct: 0 })).rejects.toThrow(/rendimento_invalido/)
    await expect(ligar('B', 'A')).rejects.toThrow(/ligacao_ja_existe/)
    const l3 = await ligar('B', 'D', { p_tipo_saida: 'subproduto', p_rendimento_pct: 55 }) // 60 + 55 > 100: avisa, não bloqueia
    ligacoes.push(l3.id)
    expect(l3.avisos).toHaveLength(1)
    // editar sem se bloquear pela própria ligação e arquivar/reativar
    await rpc('fn_prod_estrutura_salvar', { p_company_id: DEMO_SST, p_plant_id: plant, p_id: l2.id, p_origem_produto_id: ids.C, p_produto_id: ids.B, p_rendimento_pct: 98.5, p_status: 'validado' })
    expect((await arvore('A')).nos[1]).toMatchObject({ rendimento_padrao_pct: 98.5, status: 'validado' })
    await rpc('fn_prod_estrutura_arquivar', { p_company_id: DEMO_SST, p_id: l2.id, p_ativo: false })
    expect((await arvore('A')).nos).toHaveLength(1)
    await rpc('fn_prod_estrutura_arquivar', { p_company_id: DEMO_SST, p_id: l2.id, p_ativo: true })
    expect((await arvore('A')).nos).toHaveLength(2)
  })

  test('colar lista: prévia não grava, linha inválida é avisada, gravação entra como rascunho', async () => {
    const [E, F] = [(await salvarProduto('E')).id, (await salvarProduto('F')).id]
    ids.E = E; ids.F = F
    const lista = `origem;produto;tipo_saida;rendimento_pct;etapa\n${cod('F')};${cod('E')};coproduto;12,5;\n${cod('F')};NAOEXISTE${RUN};principal;10;\n${cod('E')};${cod('F')};principal;;`
    const previa = await colar(lista, false)
    expect(previa.gravado).toBe(false)
    expect(previa.validas).toHaveLength(1)
    expect(previa.nao_casaram.map(n => n.motivo.split(':')[0]).sort()).toEqual(['ciclo_na_estrutura', 'produto_nao_encontrado'])
    expect((await arvore('E')).nos).toHaveLength(0)
    const real = await colar(lista, true)
    expect(real.gravadas).toBe(1)
    const e = await arvore('E')
    expect(e.nos).toHaveLength(1)
    expect(e.nos[0]).toMatchObject({ status: 'rascunho', rendimento_padrao_pct: 12.5 })
    ligacoes.push(e.nos[0].id)
    expect((await colar(`${cod('F')};${cod('E')};coproduto;12,5;`, false)).nao_casaram[0].motivo).toBe('ligacao_ja_existe')
  })

  test('isolamento: outra empresa não lê nem grava nesta planta', async () => {
    await expect(rpc('fn_prod_estrutura_listar', { p_company_id: OUTRA_EMPRESA, p_plant_id: plant, p_produto_id: ids.A })).rejects.toThrow()
    await expect(rpc('fn_prod_produto_salvar', { p_company_id: OUTRA_EMPRESA, p_plant_id: plant, p_id: null, p_codigo: cod('X'), p_nome: 'x', p_papel: 'origem' })).rejects.toThrow()
  })
})
