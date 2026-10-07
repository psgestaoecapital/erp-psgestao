// Canal PS · PR A (CEO 07/10 16:20) — o sócio pede direto ao SEU Code pela fn_agente_pedido_enviar, logado (RD-82/83).
// Migration 20261007210060 · @pos-migration. Cenários do CEO:
//   1) "Rodrigo" envia para o rodrigo-code: ok, mensagem de rodrigo-chat (tarefa) e a rotina é acionada;
//   2) "Rodrigo" com empresa da carteira da Jordana: recusado, com mensagem que ensina;
//   3) pedido de núcleo: fica esperando o OK do CEO, sem acionar;
//   4) André (Code inativo): recusado;
//   5) usuário de cliente (sem Code): recusado — este roda também na produção;
//   6) o 31º pedido na hora: recusado.
// Só há um login de teste (o robô). Para agir "como Rodrigo", no BANCO DE TESTES o robô vira por alguns segundos o dono do
// rodrigo-code (e a demonstração GE entra na carteira dele); tudo volta ao que era no fim. Na produção isso nunca é feito.
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbDelete, dbInsert, dbPatch, dbSelect, registrarJornada, rpcComoRobo } from '../../support/api'

const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const JORDANA = '43ef8386-3262-4e56-b31a-6f0e41d1e21c'
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const PRODUCAO = SUPABASE_URL.includes('horsymhsinqcimflrtjo')
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
const ASSUNTO = `Aceitação canal PS ${RUN}`

type Resp = { ok?: boolean; erro?: string; mensagem?: string; id?: string; agente?: string; requer_ok_ceo?: boolean
  acionamento?: { acionou?: boolean; motivo?: string } | null }
type Dono = { agente: string; user_id: string; remetente_chat: string | null; ativo: boolean }
type Carteira = { id: string; company_id: string; responsavel_id: string | null }

const pedir = async (args: Record<string, unknown>) => (await rpcComoRobo<Resp>('fn_agente_pedido_enviar', { p_assunto: ASSUNTO, p_corpo: 'teste de aceitação', ...args })).corpo ?? {}

test.describe('Canal PS — pedido do sócio ao próprio Code', () => {
  test.describe.configure({ mode: 'serial' })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-canal-ps-pedido', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('usuário de cliente (sem Code) e anônimo são recusados', { tag: '@pos-migration' }, async () => {
    const donos = await dbSelect<Dono>('erp_agente_dono', `user_id=eq.${ROBO}&select=agente`)
    test.skip(donos.length > 0, 'o robô está como dono de um Code neste banco (outro teste em andamento)')
    const r = await pedir({})
    expect(r.ok, 'sem Code, não pede').toBe(false)
    expect(r.erro).toBe('sem_code')
    const anon = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_agente_pedido_enviar`, { method: 'POST',
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_assunto: 'x', p_corpo: 'y' }) })
    expect(anon.ok, 'anônimo não executa a função').toBe(false)
  })

  test.describe('como sócio dono do rodrigo-code (só no banco de testes)', () => {
    const salvos: { donos: Dono[]; carteira: Carteira | null; carteiraCriada: string | null; equipe: boolean } = { donos: [], carteira: null, carteiraCriada: null, equipe: false }
    let outraEmpresa = DEMO_REVENDA

    test.beforeAll(async () => {
      if (PRODUCAO) return
      salvos.donos = await dbSelect<Dono>('erp_agente_dono', 'agente=in.(rodrigo-code,andre-code)&select=agente,user_id,remetente_chat,ativo')
      const rod = salvos.donos.find((d) => d.agente === 'rodrigo-code')
      if (rod) await dbPatch('erp_agente_dono', 'agente=eq.rodrigo-code', { user_id: ROBO, ativo: true })
      else await dbInsert('erp_agente_dono', { agente: 'rodrigo-code', user_id: ROBO, remetente_chat: 'rodrigo-chat', ativo: true })
      // carteira: a demonstração GE passa a ser do "Rodrigo" (o robô) durante o teste
      const [vig] = await dbSelect<Carteira>('erp_carteira_responsavel', `company_id=eq.${DEMO_GE}&vigencia_fim=is.null&select=id,company_id,responsavel_id`)
      if (vig) { salvos.carteira = vig; await dbPatch('erp_carteira_responsavel', `id=eq.${vig.id}`, { responsavel_id: ROBO }) }
      else salvos.carteiraCriada = (await dbInsert<{ id: string }>('erp_carteira_responsavel', { company_id: DEMO_GE, responsavel_id: ROBO, motivo: `aceitação canal PS ${RUN}` })).id
      const [daJordana] = await dbSelect<Carteira>('erp_carteira_responsavel', `responsavel_id=eq.${JORDANA}&vigencia_fim=is.null&company_id=neq.${DEMO_GE}&select=company_id&limit=1`)
      if (daJordana) outraEmpresa = daJordana.company_id
      // a aba Codes é da equipe PS: o robô entra só durante o teste
      const ja = await dbSelect('ps_equipe_acesso', `user_id=eq.${ROBO}&select=user_id`)
      if (ja.length === 0) { await dbInsert('ps_equipe_acesso', { user_id: ROBO, papel: 'acesso_total', ativo: true, observacao: `aceitação canal PS ${RUN} (sai no fim)` }); salvos.equipe = true }
    })

    test.afterAll(async () => {
      if (PRODUCAO) return
      await dbDelete('erp_agente_mensagem', `de=eq.rodrigo-chat&assunto=like.${encodeURIComponent('Aceitação canal PS*')}`)
      const rod = salvos.donos.find((d) => d.agente === 'rodrigo-code')
      if (rod) await dbPatch('erp_agente_dono', 'agente=eq.rodrigo-code', { user_id: rod.user_id, ativo: rod.ativo })
      else await dbDelete('erp_agente_dono', 'agente=eq.rodrigo-code')
      const and = salvos.donos.find((d) => d.agente === 'andre-code')
      if (and) await dbPatch('erp_agente_dono', 'agente=eq.andre-code', { user_id: and.user_id, ativo: and.ativo })
      else await dbDelete('erp_agente_dono', `agente=eq.andre-code&user_id=eq.${ROBO}`)
      if (salvos.carteira) await dbPatch('erp_carteira_responsavel', `id=eq.${salvos.carteira.id}`, { responsavel_id: salvos.carteira.responsavel_id })
      if (salvos.carteiraCriada) await dbDelete('erp_carteira_responsavel', `id=eq.${salvos.carteiraCriada}`)
      if (salvos.equipe) await dbDelete('ps_equipe_acesso', `user_id=eq.${ROBO}`)
    })

    test('envia ao rodrigo-code: tarefa de rodrigo-chat e a rotina é acionada', { tag: '@pos-migration' }, async () => {
      test.skip(PRODUCAO, 'na produção o robô não vira dono de Code — prova no banco de testes')
      const r = await pedir({ p_empresa_id: DEMO_GE })
      expect(r.ok, r.mensagem).toBe(true)
      expect(r.agente, 'destino é sempre o Code do próprio dono').toBe('rodrigo-code')
      const [m] = await dbSelect<{ para: string; de: string; tipo: string; enviado_por: string; requer_ok_ceo: boolean; acionamento: { motivo?: string } | null; empresa_id: string }>(
        'erp_agente_mensagem', `id=eq.${r.id}&select=para,de,tipo,enviado_por,requer_ok_ceo,acionamento,empresa_id`)
      expect([m.para, m.de, m.tipo, m.enviado_por]).toEqual(['rodrigo-code', 'rodrigo-chat', 'tarefa', 'rodrigo-chat'])
      expect(m.requer_ok_ceo).toBe(false)
      expect(m.acionamento, 'o gatilho da caixa acionou a rotina (fn_agente_acionar)').not.toBeNull()
      expect(m.acionamento?.motivo, 'não ficou esperando OK').not.toBe('aguarda_ok_ceo')
      const audit = await dbSelect('audit_log_global', `registro_id=eq.${r.id}&acao=eq.agente_pedido_enviar&select=id`)
      expect(audit.length, 'registrado em audit_log_global').toBe(1)
      const meus = (await rpcComoRobo<{ pedidos: { id: string }[] }>('fn_agente_pedidos_meus', { p_limite: 30 })).corpo
      expect(meus?.pedidos.some((p) => p.id === r.id), 'aparece em "meus pedidos"').toBe(true)
    })

    test('empresa da carteira da Jordana: recusado com mensagem que ensina', { tag: '@pos-migration' }, async () => {
      test.skip(PRODUCAO, 'prova no banco de testes')
      const r = await pedir({ p_empresa_id: outraEmpresa })
      expect(r.ok).toBe(false)
      expect(r.erro).toBe('fora_da_carteira')
      expect(r.mensagem).toContain('não está na sua carteira')
    })

    test('pedido de núcleo espera o OK do CEO sem acionar', { tag: '@pos-migration' }, async () => {
      test.skip(PRODUCAO, 'prova no banco de testes')
      const r = await pedir({ p_nucleo: true })
      expect(r.ok, r.mensagem).toBe(true)
      expect(r.requer_ok_ceo).toBe(true)
      expect(r.acionamento?.acionou, 'não aciona').toBe(false)
      expect(r.acionamento?.motivo).toBe('aguarda_ok_ceo')
    })

    test('a aba Codes mostra "Meu Code" e o pedido aparece sem recarregar', { tag: '@pos-migration' }, async ({ page }) => {
      test.skip(PRODUCAO, 'prova no banco de testes')
      await page.goto('/dashboard/dev/codes')
      await aguardarConteudo(page)
      await expect(page.getByTestId('meu-code'), 'o dono vê o painel do seu Code').toBeVisible({ timeout: 20000 })
      await page.getByTestId('meu-code-assunto').fill(`${ASSUNTO} tela`)
      await page.getByTestId('meu-code-texto').fill('pedido pela tela (aceitação)')
      await page.getByTestId('meu-code-enviar').click()
      await expect(page.getByTestId('meu-code-aviso')).toHaveAttribute('data-ok', 'sim', { timeout: 15000 })
      await expect(page.getByTestId('meu-code-pedidos'), 'aparece na lista').toContainText(`${ASSUNTO} tela`, { timeout: 15000 })
    })

    test('o 31º pedido na mesma hora é recusado', { tag: '@pos-migration' }, async () => {
      test.skip(PRODUCAO, 'prova no banco de testes')
      const desde = new Date(Date.now() - 3600_000).toISOString()
      const feitos = (await dbSelect('erp_agente_mensagem', `de=eq.rodrigo-chat&criado_em=gt.${desde}&select=id`)).length
      for (let i = feitos; i < 30; i++) expect((await pedir({})).ok, `pedido ${i + 1} de 30`).toBe(true)
      const r = await pedir({})
      expect(r.ok, 'o 31º passa do limite').toBe(false)
      expect(r.erro).toBe('limite_hora')
    })

    test('André (Code inativo) é recusado', { tag: '@pos-migration' }, async () => {
      test.skip(PRODUCAO, 'prova no banco de testes')
      await dbPatch('erp_agente_dono', 'agente=eq.rodrigo-code', { ativo: false })
      const and = salvos.donos.find((d) => d.agente === 'andre-code')
      if (and) await dbPatch('erp_agente_dono', 'agente=eq.andre-code', { user_id: ROBO, ativo: false })
      else await dbInsert('erp_agente_dono', { agente: 'andre-code', user_id: ROBO, remetente_chat: 'andre-chat', ativo: false })
      const r = await pedir({})
      expect(r.ok).toBe(false)
      expect(r.erro).toBe('code_inativo')
    })
  })
})
