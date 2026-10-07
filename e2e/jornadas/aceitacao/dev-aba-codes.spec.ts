// Central de Desenvolvimento · aba "Codes" em tempo real (CEO 07/10 14:30). Migration 20261007200060 · @pos-migration.
//   1) usuário de cliente (o robô: fora de ps_equipe_acesso — o users.role não conta) é RECUSADO — 0 linhas pela REST e a aba
//      mostra "Acesso restrito à equipe PS";
//   2) equipe PS: a aba carrega e um evento NOVO em erp_dev_entrega aparece sem recarregar (Realtime com RLS);
//   3) o script do workflow registrar-entrega grava "publicada" quando uma PR é mergeada (idempotente no re-run).
// 2 e 3 só no BANCO DE TESTES: para provar como equipe PS o robô entra em ps_equipe_acesso durante o teste (e sai no
// fim) — isso nunca é feito na produção; lá roda só o 1 (o 2 e o 3 ficam com a aceitação da main, no banco de testes).
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, aguardarConteudo } from '../../support/fixtures'
import { dbDelete, dbInsert, dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const ROBO = '74cf7dfa-4af5-4ef5-bd58-6a2166ea4cfa'
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const PRODUCAO = SUPABASE_URL.includes('horsymhsinqcimflrtjo')
const RUN = `${process.env.GITHUB_RUN_ID ?? 'local'}-${Date.now().toString(36)}`
// número de PR de teste (bem acima dos reais) — apagado no fim
const PR_TESTE = 900000 + Math.floor(Math.random() * 90000)

async function comoRobo<T>(tabela: string, query: string): Promise<{ status: number; linhas: T[] }> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } })
  return { status: r.status, linhas: r.ok ? ((await r.json()) as T[]) : [] }
}

test.describe('Central de Desenvolvimento · aba Codes', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-dev-aba-codes', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('usuário de cliente é recusado: não lê os dados e a aba mostra acesso restrito', { tag: '@pos-migration' }, async ({ page }) => {
    // equipe PS = SOMENTE ps_equipe_acesso ativo (o users.role não conta: usuário de cliente pode ter adm/acesso_total)
    const naEquipe = await dbSelect<{ user_id: string }>('ps_equipe_acesso', `user_id=eq.${ROBO}&ativo=eq.true&select=user_id`)
    test.skip(naEquipe.length > 0, 'o robô está na equipe PS neste banco (outro teste em andamento): não serve de usuário de cliente')
    for (const t of ['erp_dev_entrega', 'erp_agente_sessao_lease', 'erp_agente_rotina']) {
      const r = await comoRobo(t, 'select=*&limit=5')
      expect(r.status, `${t}: leitura responde`).toBe(200)
      expect(r.linhas, `${t}: nenhuma linha para o cliente`).toEqual([])
    }
    const msg = await comoRobo('erp_agente_mensagem', 'select=id,assunto&limit=5')
    expect(msg.linhas, 'caixa dos agentes: nenhuma linha para o cliente').toEqual([])

    await page.goto('/dashboard/dev/codes')
    await aguardarConteudo(page)
    await expect(page.getByTestId('codes-acesso-negado'), 'a aba recusa o usuário de cliente').toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('codes-painel')).toHaveCount(0)
  })

  test.describe('como equipe PS (só no banco de testes)', () => {
    let entrouNaEquipe = false
    test.beforeAll(async () => {
      if (PRODUCAO) return
      const ja = await dbSelect<{ ativo: boolean }>('ps_equipe_acesso', `user_id=eq.${ROBO}&select=ativo`)
      if (ja.length === 0) { await dbInsert('ps_equipe_acesso', { user_id: ROBO, papel: 'acesso_total', ativo: true, observacao: `aceitação aba Codes ${RUN} (sai no fim)` }); entrouNaEquipe = true }
    })
    test.afterAll(async () => {
      if (!PRODUCAO) await dbDelete('erp_dev_entrega', `pr_numero=eq.${PR_TESTE}`)
      if (entrouNaEquipe) await dbDelete('ps_equipe_acesso', `user_id=eq.${ROBO}`)
    })

    test('a aba carrega e um evento novo aparece sem recarregar', { tag: '@pos-migration' }, async ({ page }) => {
      test.skip(PRODUCAO, 'na produção o robô não é promovido à equipe PS — prova no banco de testes (aceitação da main)')
      await page.goto('/dashboard/dev/codes')
      await aguardarConteudo(page)
      await expect(page.getByTestId('codes-painel'), 'a equipe PS vê a aba').toBeVisible({ timeout: 20000 })
      for (const c of ['gilberto-desenv', 'gilberto-chamados', 'gilberto-produto', 'jordana-code', 'rodrigo-code', 'gilberto-revisor', 'eng-chefe-auto']) {
        await expect(page.getByTestId(`card-code-${c}`)).toBeVisible()
      }
      await expect(page.getByTestId('codes-faixa')).toBeVisible()
      await expect(page.getByTestId('codes-atualizado'), 'assinou o Realtime').toContainText('(ao vivo)', { timeout: 20000 })

      // evento novo gravado DEPOIS da tela aberta: tem de aparecer sozinho, sem page.reload()
      await dbInsert('erp_dev_entrega', { pr_numero: PR_TESTE, titulo: `Aceitação aba Codes ${RUN}`, code: 'gilberto-desenv', evento: 'publicada',
        via: 'rapida', sha: RUN, url: null, ocorrido_em: new Date().toISOString() })
      await expect(page.getByTestId('card-entregue-gilberto-desenv').getByTestId(`entrega-${PR_TESTE}`),
        'a entrega nova aparece no cartão sem recarregar').toBeVisible({ timeout: 20000 })
      await expect(page.getByTestId(`linha-tempo-${PR_TESTE}`), 'e na linha do tempo do dia').toContainText('gilberto-desenv')
    })

    test('o workflow grava "publicada" quando a PR é mergeada', { tag: '@pos-migration' }, async () => {
      test.skip(PRODUCAO, 'não grava PR de teste no painel da produção — prova no banco de testes (aceitação da main)')
      const dir = mkdtempSync(join(tmpdir(), 'registrar-entrega-'))
      try {
        const ev = join(dir, 'evento.json')
        const mergedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
        writeFileSync(ev, JSON.stringify({ action: 'closed', pull_request: {
          number: PR_TESTE, title: `Aceitação workflow ${RUN}`, html_url: `https://github.com/psgestaoecapital/erp-psgestao/pull/${PR_TESTE}`,
          body: 'teste de aceitação\n\nCode: jordana-code', labels: [], draft: false, merged: true, merged_at: mergedAt,
          merge_commit_sha: `merge-${RUN}`, head: { sha: `head-${RUN}` }, created_at: mergedAt } }))
        const rodar = () => spawnSync(process.execPath, ['scripts/dev/registrar-entrega.mjs'], { encoding: 'utf8',
          env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_PATH: ev, SUPABASE_URL } })
        for (let i = 0; i < 2; i++) {
          const r = rodar()
          expect(r.status, `script do workflow (rodada ${i + 1}): ${r.stdout}${r.stderr}`).toBe(0)
        }
        const linhas = await dbSelect<{ evento: string; code: string; sha: string; ocorrido_em: string }>('erp_dev_entrega',
          `pr_numero=eq.${PR_TESTE}&sha=eq.merge-${RUN}&select=evento,code,sha,ocorrido_em`)
        expect(linhas.length, 'uma linha só (o re-run não duplica)').toBe(1)
        expect(linhas[0].evento).toBe('publicada')
        expect(linhas[0].code, 'Code da linha "Code:" do corpo').toBe('jordana-code')
        expect(new Date(linhas[0].ocorrido_em).toISOString(), 'ocorrido_em = merged_at').toBe(new Date(mergedAt).toISOString())
      } finally { rmSync(dir, { recursive: true, force: true }) }
    })
  })
})
