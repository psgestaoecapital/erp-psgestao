// #42 (Frioeste · treinamentos por setor): obrigatório = UNIÃO do que já era exigido + o parametrizado para o setor.
// Depende da migration 20261005130000 (tabela compliance_exigencia_setor) → @pos-migration.
// Tudo na DEMO Indústria (SST); o exigido de teste leva nome exclusivo e é desativado no fim (nunca apagado, RD-30).

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, dbDelete } from '../../support/api'

const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const NOME = 'E2E42 Treinamento por setor'
let exigidoId = ''

type Linha = { funcionario_id: string; setor: string | null; exigido_id: string | null }
const matriz = (f?: string) => dbSelect<Linha>('v_compliance_matriz_funcionarios', `company_id=eq.${DEMO_SST}&select=funcionario_id,setor,exigido_id${f ? `&${f}` : ''}`)
const limpar = async () => {
  await dbDelete('compliance_exigencia_setor', `company_id=eq.${DEMO_SST}&exigido_id=eq.${exigidoId}`).catch(() => {})
  if (exigidoId) await dbPatch('compliance_documento_exigido', `id=eq.${exigidoId}`, { ativo: false }).catch(() => {})
}

test.describe('#42 treinamentos por setor', { tag: '@pos-migration' }, () => {
  test.beforeAll(async () => {
    const velho = await dbSelect<{ id: string }>('compliance_documento_exigido', `company_id=eq.${DEMO_SST}&nome_custom=eq.${encodeURIComponent(NOME)}&select=id`)
    for (const v of velho) { exigidoId = v.id; await limpar() }
  })
  test.afterAll(async () => { await limpar() })

  test('correção: marcar o setor exige o treinamento só dos colaboradores dele; desmarcar volta ao que era', async () => {
    const pessoas = await dbSelect<{ id: string; setor_id: string; setor: string }>('compliance_funcionarios', `company_id=eq.${DEMO_SST}&ativo=eq.true&setor_id=not.is.null&select=id,setor_id,setor`)
    const setores = Array.from(new Set(pessoas.map(p => p.setor_id)))
    test.skip(setores.length < 2, 'DEMO sem dois setores')
    const [alvo, outro] = setores
    const novo = await dbInsert<{ id: string }>('compliance_documento_exigido', { company_id: DEMO_SST, nome_custom: NOME, aplica_a: 'funcionario', obrigatorio: true, ativo: true, setor_id: outro })
    exigidoId = novo.id
    const doAlvo = pessoas.filter(p => p.setor_id === alvo).map(p => p.id)
    // exigido restrito a OUTRO setor: ninguém do setor alvo o tem
    expect((await matriz(`exigido_id=eq.${exigidoId}`)).filter(l => doAlvo.includes(l.funcionario_id)).length).toBe(0)
    await dbInsert('compliance_exigencia_setor', { company_id: DEMO_SST, setor_id: alvo, exigido_id: exigidoId })
    const com = await matriz(`exigido_id=eq.${exigidoId}`)
    expect(new Set(com.filter(l => doAlvo.includes(l.funcionario_id)).map(l => l.funcionario_id)).size).toBe(doAlvo.length)
    expect(com.some(l => !doAlvo.includes(l.funcionario_id) && pessoas.find(p => p.id === l.funcionario_id)?.setor_id === alvo)).toBe(false)
    await dbPatch('compliance_exigencia_setor', `exigido_id=eq.${exigidoId}&setor_id=eq.${alvo}`, { ativo: false })
    expect((await matriz(`exigido_id=eq.${exigidoId}`)).filter(l => doAlvo.includes(l.funcionario_id)).length).toBe(0)
  })

  test('caminho principal: o que já era exigido continua exigido (aditivo, RD-55)', async () => {
    const regra = await dbSelect<{ id: string }>('compliance_documento_exigido', `company_id=eq.${DEMO_SST}&ativo=eq.true&funcao=is.null&setor_id=is.null&nome_custom=is.null&select=id`)
    test.skip(regra.length === 0, 'DEMO sem exigido sem escopo')
    const pessoas = await dbSelect<{ id: string }>('compliance_funcionarios', `company_id=eq.${DEMO_SST}&ativo=eq.true&prestador_id=is.null&select=id`)
    const m = await matriz(`exigido_id=eq.${regra[0].id}`)
    expect(new Set(m.map(l => l.funcionario_id)).size).toBe(pessoas.length)
  })
})
