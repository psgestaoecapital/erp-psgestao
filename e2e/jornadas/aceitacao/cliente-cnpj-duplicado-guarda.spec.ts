// Caixa jordana-code 3352399e, item 4 (Gean · FC Pisos, Eng. Chefe 09/10): cliente com o mesmo CNPJ de outro ATIVO da
// empresa não pode ser criado — o duplicado com CNPJ formatado fez a NFS-e da OS-2026-0198 pegar o tomador errado.
// Gatilho trg_clientes_cnpj_duplicado_guarda: compara só dígitos (cpf_cnpj e cnpj_cpf), só entre ativos da mesma empresa;
// inativo e linha de sincronização/importação (ref_externa_sistema) passam; reativar um duplicado é recusado.
// Demonstração Comércio (GE), nunca empresa real. Cadastros de teste desativados no fim.

import { test, expect } from '../../support/fixtures'
import { dbSelect, dbInsert, dbPatch, registrarJornada } from '../../support/api'

const DEMO_COMERCIO = 'b0700000-0000-4000-a000-000000000004'
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
// 14 dígitos únicos por execução (não é CNPJ válido de verdade; o gatilho só compara dígitos)
const DOC = `9${Date.now().toString().slice(-9)}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`
const DOC_FMT = `${DOC.slice(0, 2)}.${DOC.slice(2, 5)}.${DOC.slice(5, 8)}/${DOC.slice(8, 12)}-${DOC.slice(12)}`

const criados: string[] = []
async function cliente(campos: Record<string, unknown>) {
  const c = await dbInsert<{ id: string }>('erp_clientes', {
    company_id: DEMO_COMERCIO, tipo_pessoa: 'PJ', ativo: true, nome_fantasia: `Cliente CNPJ dup ${RUN}`, ...campos,
  })
  criados.push(c.id)
  return c.id
}
async function recusa(p: Promise<unknown>) {
  const erro = await p.then(() => null, (e: Error) => e.message)
  expect(erro, 'devia recusar o CNPJ duplicado').toMatch(/já está cadastrado nesta empresa/)
}

test.describe('Cliente: CNPJ já cadastrado (ativo) na empresa não pode ser criado de novo (caixa 3352399e)', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-cliente-cnpj-duplicado', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_COMERCIO}&select=is_demo`)
    expect(emp?.is_demo, 'a aceitação só roda na empresa de demonstração').toBe(true)
  })

  test.afterAll(async () => {
    for (const id of criados) await dbPatch('erp_clientes', `id=eq.${id}`, { ativo: false })
  })

  test('recusa o duplicado (formatado ou não); inativo, sincronização e edição do original passam', { tag: '@pos-migration' }, async () => {
    const original = await cliente({ cnpj_cpf: DOC, nome_fantasia: `FC Original ${RUN}` })

    // o caso da Gean: o mesmo CNPJ com pontuação, na outra coluna
    await recusa(cliente({ cpf_cnpj: DOC_FMT }))
    await recusa(cliente({ cnpj_cpf: DOC }))

    // cadastro inativo não bloqueia; reativá-lo com o original ativo é recusado
    const inativo = await cliente({ cpf_cnpj: DOC_FMT, ativo: false })
    await recusa(dbPatch('erp_clientes', `id=eq.${inativo}`, { ativo: true }))

    // sincronização/importação espelha a origem e passa
    await cliente({ cpf_cnpj: DOC, ref_externa_sistema: 'teste_aceitacao', ref_externa_id: `dup-${RUN}` })

    // editar outro campo do original continua livre
    await dbPatch('erp_clientes', `id=eq.${original}`, { nome_fantasia: `FC Original editado ${RUN}` })

    // trocar o documento de outro cliente para o duplicado é recusado
    const outro = await cliente({ nome_fantasia: `Sem doc ${RUN}` })
    await recusa(dbPatch('erp_clientes', `id=eq.${outro}`, { cpf_cnpj: DOC }))

    // inativou o original → o documento fica livre para um cadastro novo
    await dbPatch('erp_clientes', `id=eq.${original}`, { ativo: false })
    await cliente({ cpf_cnpj: DOC_FMT, nome_fantasia: `FC Novo ${RUN}` })

    const ativos = await dbSelect<{ id: string }>('erp_clientes',
      `company_id=eq.${DEMO_COMERCIO}&ativo=is.true&ref_externa_sistema=is.null&or=(cpf_cnpj.eq.${DOC},cpf_cnpj.eq.${encodeURIComponent(DOC_FMT)},cnpj_cpf.eq.${DOC})&select=id`)
    expect(ativos.length, 'um só cadastro ativo feito à mão com o documento').toBe(1)
  })
})
