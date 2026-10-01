// SPEC P&M · Pauta — fase P1 (banco) · CEO 01/10. Migration 20261001200000 → @pos-migration (no preview informativo;
// o veredito é em produção logo após o deploy). Na Agência (P&M) - DEMO, como o robô (logado, sem is_admin):
//  1) listas configuráveis: 6 situações (com "Aguardando") e 5 motivos de espera; a semente não duplica;
//  2) contador das abas: uma chamada, bate com os jobs da empresa e respeita o filtro;
//  3) anotação é privada do autor; ninguém grava anotação em nome de outro; visão salva do próprio usuário;
//  4) empresa que não é do usuário → 42501 (listas) e contador vazio (RLS); quem não está logado não chama.
// Limpeza sem apagar (RD-30): anotação e visão de teste vão para a lixeira (excluido_em).

import { test, expect } from '../../support/fixtures'
import { dbPatch, dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const DEMO_AG = 'b0700000-0000-4000-a000-000000000002'
const OUTRA = '00000000-0000-4000-a000-0000000a0e01'
const OUTRO_USER = '00000000-0000-4000-a000-00000000abcd'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const RUN = Date.now().toString(36).toUpperCase()
let token = ''
let robo = ''
const anotacoes: string[] = []
const visoes: string[] = []

type Resp = { status: number; corpo: Record<string, unknown> & Array<Record<string, unknown>> }
async function comoRobo(caminho: string, body: unknown, semLogin = false): Promise<Resp> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY, Authorization: `Bearer ${semLogin ? ANON_KEY : token}`, 'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as Resp['corpo'] }
}
async function lerComoRobo<T>(caminho: string): Promise<T[]> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  expect(r.status).toBe(200)
  return (await r.json()) as T[]
}

test.describe('Pauta P1 · banco: listas, contador das abas, anotação privada, visão salva, empresa alheia', () => {
  test.beforeAll(async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_AG}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const sess = JSON.parse(await obterSessionPayload()) as { access_token: string; user: { id: string } }
    token = sess.access_token; robo = sess.user.id
  })
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-pauta-p1-banco', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })
  test.afterAll(async () => {
    const agora = new Date().toISOString()
    for (const id of anotacoes) await dbPatch('agency_anotacoes', `id=eq.${id}`, { excluido_em: agora }).catch(() => {})
    for (const id of visoes) await dbPatch('agency_visoes_pauta', `id=eq.${id}`, { excluido_em: agora }).catch(() => {})
  })

  test('listas configuráveis: 6 situações com "Aguardando" e 5 motivos; a semente não duplica', { tag: '@pos-migration' }, async () => {
    const r = await comoRobo('rpc/fn_pauta_opcoes', { p_company_id: DEMO_AG })
    expect(r.status, JSON.stringify(r.corpo)).toBe(200)
    const situacoes = r.corpo.situacoes as Array<{ valor: string; rotulo: string }>
    const motivos = r.corpo.motivos as Array<{ valor: string }>
    expect(situacoes.map((s) => s.valor)).toEqual(['nao_iniciada', 'em_producao', 'aguardando', 'em_aprovacao', 'concluida', 'publicado'])
    expect(situacoes.find((s) => s.valor === 'aguardando')?.rotulo).toBe('Aguardando')
    expect(motivos).toHaveLength(5)

    await comoRobo('rpc/fn_pauta_opcoes', { p_company_id: DEMO_AG })
    const linhas = await dbSelect('agency_config_opcao', `company_id=eq.${DEMO_AG}&lista=in.(situacao_job,motivo_aguardando)&select=id`)
    expect(linhas, 'chamar de novo não duplica a semente').toHaveLength(11)
  })

  test('contador das abas: bate com os jobs da empresa e respeita o filtro', { tag: '@pos-migration' }, async () => {
    const jobs = await dbSelect<{ status: string; numero: number | null }>('agency_jobs', `company_id=eq.${DEMO_AG}&excluido_em=is.null&select=status,numero`)
    expect(jobs.length, 'a demo tem jobs').toBeGreaterThan(0)

    const r = await comoRobo('rpc/fn_pauta_contadores', { p_company_id: DEMO_AG, p_filtros: {} })
    expect(r.status, JSON.stringify(r.corpo)).toBe(200)
    expect(r.corpo.total).toBe(jobs.length)
    const porSituacao = r.corpo.por_situacao as Record<string, number>
    expect(Object.values(porSituacao).reduce((a, b) => a + b, 0), 'a soma das abas é o total').toBe(jobs.length)
    for (const st of new Set(jobs.map((j) => j.status))) expect(porSituacao[st]).toBe(jobs.filter((j) => j.status === st).length)

    const nada = await comoRobo('rpc/fn_pauta_contadores', { p_company_id: DEMO_AG, p_filtros: { titulo: `nao-existe-${RUN}` } })
    expect(nada.corpo.total, 'filtro sem resultado zera').toBe(0)

    const comNumero = jobs.find((j) => j.numero != null)
    if (comNumero) {
      const porCodigo = await comoRobo('rpc/fn_pauta_contadores', { p_company_id: DEMO_AG, p_filtros: { codigo: `${comNumero.numero}A` } })
      expect(Number(porCodigo.corpo.total), 'código com a letra da rodada acha o job').toBeGreaterThanOrEqual(1)
    }
  })

  test('anotação privada do autor; ninguém grava em nome de outro; visão salva do próprio usuário', { tag: '@pos-migration' }, async () => {
    const a = await comoRobo('agency_anotacoes', { company_id: DEMO_AG, texto: `E2E anotação ${RUN}` })
    expect(a.status, JSON.stringify(a.corpo)).toBe(201)
    expect(a.corpo[0].user_id, 'o autor é quem está logado').toBe(robo)
    anotacoes.push(String(a.corpo[0].id))
    expect(await lerComoRobo(`agency_anotacoes?id=eq.${a.corpo[0].id}&select=id`)).toHaveLength(1)

    const alheia = await comoRobo('agency_anotacoes', { company_id: DEMO_AG, user_id: OUTRO_USER, texto: `E2E em nome de outro ${RUN}` })
    expect(alheia.status, 'anotação em nome de outro é recusada').toBeGreaterThanOrEqual(400)
    expect(alheia.corpo.code).toBe('42501')

    const v = await comoRobo('agency_visoes_pauta', { company_id: DEMO_AG, nome: `E2E visão ${RUN}`, filtros: { atalho: 'atrasados' } })
    expect(v.status, JSON.stringify(v.corpo)).toBe(201)
    expect(v.corpo[0].dono_id).toBe(robo)
    expect(v.corpo[0].compartilhada).toBe(false)
    visoes.push(String(v.corpo[0].id))
  })

  test('empresa alheia: listas → 42501, contador vazio; sem login não chama', { tag: '@pos-migration' }, async () => {
    const op = await comoRobo('rpc/fn_pauta_opcoes', { p_company_id: OUTRA })
    expect(op.status).toBeGreaterThanOrEqual(400)
    expect(op.corpo.code).toBe('42501')

    const ct = await comoRobo('rpc/fn_pauta_contadores', { p_company_id: OUTRA, p_filtros: {} })
    expect(ct.status, JSON.stringify(ct.corpo)).toBe(200)
    expect(ct.corpo.total).toBe(0)

    const anon = await comoRobo('rpc/fn_pauta_contadores', { p_company_id: DEMO_AG, p_filtros: {} }, true)
    expect(anon.status, 'quem não está logado não chama').toBeGreaterThanOrEqual(400)
  })
})
