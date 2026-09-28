// CEO 28/09 · trava temporária do #286: a NFS-e ainda não leva as retenções federais do cadastro do serviço
// (INSS, IR, PIS, COFINS, CSLL). Até a correção entrar no ar, serviço com retenção marcada não emite — a rota
// devolve a mensagem do CEO e a tela a mostra. Serviço sem retenção segue o caminho normal.
// Prova sem emitir nada: o recebível é inexistente, então o caminho normal para em "Recebível não encontrado"
// (depois da trava) e nenhuma nota é enviada. Serviços de teste criados na demo GE e apagados no fim.

import { test, expect } from '../../support/fixtures'
import { registrarJornada, obterSessionPayload, dbInsert, dbDelete } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const RECEBER_INEXISTENTE = '00000000-0000-4000-a000-00000000286f'
const MSG = 'Este serviço tem retenções federais. A emissão com retenção está sendo corrigida; aguarde a liberação no chamado #286.'

async function emitir(request: import('@playwright/test').APIRequestContext, servicoId: string) {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await request.post('/api/fiscal/nfse/emitir', {
    headers: { Authorization: `Bearer ${token}` },
    data: { companyId: DEMO_GE, erpReceberId: RECEBER_INEXISTENTE, servicoId },
  })
  return { status: r.status(), corpo: await r.json() as { ok?: boolean; mensagem?: string; trava_retencao_286?: boolean } }
}

test.describe('Trava #286 · NFS-e de serviço com retenção federal', () => {
  const criados: string[] = []
  test.afterEach(async ({}, testInfo) => {
    for (const id of criados.splice(0)) await dbDelete('erp_servicos', `id=eq.${id}`)
    await registrarJornada('aceitacao-trava-nfse-retencao-286', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('serviço com retenção marcada (INSS) não emite: mensagem do chamado #286', async ({ request }) => {
    const sv = await dbInsert<{ id: string }>('erp_servicos', {
      company_id: DEMO_GE, descricao_resumida: 'E2E trava #286 (com retenção)', codigo: 'E2E286R',
      codigo_servico_municipio: '070501', codigo_lc116: '07.05', ativo: true, retem_inss: true, aliquota_inss: 11,
    })
    criados.push(sv.id)
    const { status, corpo } = await emitir(request, sv.id)
    expect(status).toBe(400)
    expect(corpo.trava_retencao_286).toBe(true)
    expect(corpo.mensagem).toBe(MSG)
  })

  test('caminho principal: serviço sem retenção passa pela trava e segue o fluxo normal', async ({ request }) => {
    const sv = await dbInsert<{ id: string }>('erp_servicos', {
      company_id: DEMO_GE, descricao_resumida: 'E2E trava #286 (sem retenção)', codigo: 'E2E286S',
      codigo_servico_municipio: '070501', codigo_lc116: '07.05', ativo: true,
    })
    criados.push(sv.id)
    const { corpo } = await emitir(request, sv.id)
    expect(corpo.trava_retencao_286, 'a trava não pega serviço sem retenção').toBeFalsy()
    expect(corpo.mensagem, 'seguiu o fluxo normal (parou no recebível inexistente, nada foi emitido)').toMatch(/Recebível não encontrado/)
  })
})
