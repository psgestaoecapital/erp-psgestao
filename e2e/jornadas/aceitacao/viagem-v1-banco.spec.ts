// Viagem · V1 (banco) — CEO 01/10, tela de viagem da FC. Migration 20261001210000 → @pos-migration (no preview
// informativo; o veredito é em produção logo após o deploy). Na Comércio (GE) - DEMO, como o robô:
//  1) a viagem 471 (acerto de julho, o exemplo de layout) lançada pelas funções dá EXATAMENTE o resumo da planilha:
//     total 2.619,26 · a prazo 1.080,00 · à vista 1.539,26 · pago pelo colaborador 1.027,80 · saldo 3.972,20
//     (colaborador devolve) · 926 km · 116,37 L · 7,96 km/l · 2,83 R$/km;
//  2) as recusas da planilha valem também aqui (data fora do período, categoria de fora, forma fora da lista,
//     valor zero, hodômetro além do km final);
//  3) empresa que não é do usuário → 42501; sem login não chama.
// A demo não tem as categorias 2.05/2.06 da FC: usa 2.01 (estadia/alimentação) e 2.02 (veículo) da própria demo.
// Nada se apaga (RD-30): o lançamento de teste extra vai para a lixeira pela função oficial.

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const OUTRA = '00000000-0000-4000-a000-0000000a0e02'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
let token = ''
let obra = ''
let viagem = ''

async function rpc(fn: string, args: Record<string, unknown>, semLogin = false) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${semLogin ? ANON_KEY : token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as Record<string, unknown> }
}

test.describe.configure({ mode: 'serial' })

test.describe('Viagem V1 · registro, lançamentos e prestação de contas (como a planilha)', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
    const [o] = await dbSelect<{ id: string }>('projetos_obras', `company_id=eq.${DEMO_GE}&select=id&order=created_at.asc&limit=1`)
    expect(o, 'a demo tem obra').toBeTruthy()
    obra = o.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-viagem-v1-banco', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('viagem 471: o resumo do banco é o da planilha', { tag: '@pos-migration' }, async () => {
    const v = await rpc('fn_viagem_salvar', { p_company_id: DEMO_GE, p_id: null, p_dados: {
      colaborador_nome: `E2E Paulinho ${RUN}`, placa: 'ryf1g36', obra_id: obra, periodo_inicio: '2026-07-06', periodo_fim: '2026-07-17',
      origem: 'Iporã do Oeste/SC', destino: 'Promissão/SP', km_inicial: 160261, km_final: 161187, adiantamento: 5000,
    } })
    expect(v.status, JSON.stringify(v.corpo)).toBe(200)
    expect(v.corpo.ok, JSON.stringify(v.corpo)).toBe(true)
    viagem = String(v.corpo.id)

    const lanc = [
      { tipo: 'despesa', data: '2026-07-06', fornecedor_nome: 'RESTAURANTE BELL MAIK LTDA', categoria: '2.01', forma_pagamento: 'dinheiro', pago_colaborador: true, valor: 286 },
      { tipo: 'despesa', data: '2026-07-08', fornecedor_nome: 'DOUGLAS PAZNEAUSKI', categoria: '2.01', forma_pagamento: 'cartao_proprio', pago_colaborador: true, valor: 297.93 },
      { tipo: 'despesa', data: '2026-07-17', fornecedor_nome: 'MARIA LUIZA DOS SANTOS DE MELO', categoria: '2.01', descricao: '3 dias de marmita', forma_pagamento: 'a_prazo', pago_colaborador: false, valor: 1080 },
      { tipo: 'despesa', data: '2026-07-10', fornecedor_nome: 'POSTO PEIXINHO PROMISSAO LTDA', categoria: '2.02', forma_pagamento: 'dinheiro', pago_colaborador: true, valor: 157.77 },
      { tipo: 'abastecimento', data: '2026-07-06', fornecedor_nome: 'SANTA RITA COMERCIO DE COMBUSTIVEL', categoria: '2.02', hodometro: 160884, litros: 75.44, valor: 511.46, tanque_cheio: true, forma_pagamento: 'cartao_empresa', pago_colaborador: false },
      { tipo: 'abastecimento', data: '2026-07-12', fornecedor_nome: 'POSTO PEIXINHO PROMISSAO LTDA', categoria: '2.02', hodometro: 161187, litros: 40.93, valor: 286.1, tanque_cheio: true, forma_pagamento: 'dinheiro', pago_colaborador: true },
    ]
    for (const d of lanc) {
      const r = await rpc('fn_viagem_lancamento_salvar', { p_viagem_id: viagem, p_id: null, p_dados: d })
      expect(r.corpo.ok, `${d.fornecedor_nome}: ${JSON.stringify(r.corpo)}`).toBe(true)
    }

    const s = (await rpc('fn_viagem_resumo', { p_viagem_id: viagem })).corpo as Record<string, unknown>
    expect(Number(s.total)).toBe(2619.26)
    expect(Number(s.total_despesas)).toBe(1821.7)
    expect(Number(s.total_abastecimentos)).toBe(797.56)
    expect(Number(s.a_prazo)).toBe(1080)
    expect(Number(s.a_vista)).toBe(1539.26)
    expect(Number(s.pago_colaborador)).toBe(1027.8)
    expect(Number(s.saldo)).toBe(3972.2)
    expect(s.saldo_texto).toBe('colaborador devolve à empresa')
    expect(Number(s.km_rodado)).toBe(926)
    expect(Number(s.litros)).toBe(116.37)
    expect(Number(s.media_km_l)).toBe(7.96)
    expect(Number(s.custo_km)).toBe(2.83)
    const cat = s.por_categoria as Record<string, number>
    expect(Number(cat['2.01'])).toBe(1663.93)
    expect(Number(cat['2.02'])).toBe(955.33)

    const [vg] = await dbSelect<{ numero: number; placa: string; status: string }>('erp_viagem', `id=eq.${viagem}&select=numero,placa,status`)
    expect(vg.placa, 'placa normalizada').toBe('RYF1G36')
    expect(vg.status).toBe('aberta')
    expect(vg.numero).toBeGreaterThan(0)
  })

  test('as recusas da planilha valem no banco; excluir é lógico', { tag: '@pos-migration' }, async () => {
    expect(viagem, 'o teste anterior criou a viagem').toBeTruthy()
    const ruim = await rpc('fn_viagem_lancamento_salvar', { p_viagem_id: viagem, p_id: null, p_dados: {
      tipo: 'despesa', data: '2026-07-20', fornecedor_nome: 'X', categoria: '9.99', forma_pagamento: 'cheque', valor: 0 } })
    expect(ruim.corpo.ok).toBe(false)
    const erros = (ruim.corpo.erros as string[]).join(' | ')
    for (const t of ['data:', 'categoria:', 'forma de pagamento:', 'valor:']) expect(erros, t).toContain(t)

    const hod = await rpc('fn_viagem_lancamento_salvar', { p_viagem_id: viagem, p_id: null, p_dados: {
      tipo: 'abastecimento', data: '2026-07-10', fornecedor_nome: 'Posto', categoria: '2.02', hodometro: 170000, litros: 10, valor: 50, forma_pagamento: 'dinheiro' } })
    expect((hod.corpo.erros as string[]).join(' ')).toContain('hodômetro')

    const extra = await rpc('fn_viagem_lancamento_salvar', { p_viagem_id: viagem, p_id: null, p_dados: {
      tipo: 'despesa', data: '2026-07-07', fornecedor_nome: `E2E extra ${RUN}`, categoria: '2.01', forma_pagamento: 'pix', valor: 10 } })
    expect(extra.corpo.ok).toBe(true)
    const ex = await rpc('fn_viagem_lancamento_excluir', { p_id: extra.corpo.id })
    expect(ex.corpo.ok).toBe(true)
    const [l] = await dbSelect<{ excluido_em: string | null }>('erp_viagem_lancamento', `id=eq.${extra.corpo.id}&select=excluido_em`)
    expect(l.excluido_em, 'continua no banco, na lixeira').not.toBeNull()
    expect(Number((await rpc('fn_viagem_resumo', { p_viagem_id: viagem })).corpo.total), 'o excluído não conta').toBe(2619.26)
  })

  test('empresa de outro → 42501; sem login não chama', { tag: '@pos-migration' }, async () => {
    const negado = await rpc('fn_viagem_salvar', { p_company_id: OUTRA, p_id: null, p_dados: {
      colaborador_nome: 'x', obra_id: obra, periodo_inicio: '2026-07-06', periodo_fim: '2026-07-07' } })
    expect(negado.status).toBeGreaterThanOrEqual(400)
    expect(negado.corpo.code).toBe('42501')
    const anon = await rpc('fn_viagem_resumo', { p_viagem_id: viagem }, true)
    expect(anon.status, 'quem não está logado não chama').toBeGreaterThanOrEqual(400)
  })
})
