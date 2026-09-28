// Frioeste #107 (CEO 28/09). Migration 20260928233000:
// (A) importação que aceita ZERO linhas falha com mensagem clara (antes ficava "processado" calado — o arquivo de
//     14–15/09 entrou assim e ninguém soube; RD-77). Prova na demo SST: processar um upload vazio → ok=false,
//     erro 'zero_linhas', status 'falhou'.
// (B) reimportação do Vinicius 01–11/09 com as 30 confirmações guardadas como histórico (caminho B do CEO).
//     Prova (só leitura, Frioeste): 30 registros no histórico com o fim confirmado pela cliente; 22 pausas reais no
//     lugar; nenhum dia de 01–11/09 "aguardando confirmação".

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_SST = 'b0700000-0000-4000-a000-000000000005'
const FRIOESTE = '975365cc-9e5a-4251-9022-68c6bfde10d8'
const VINICIUS = '46781011871'

async function comoRobo<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  expect(r.status, `${fn} responde`).toBe(200)
  return (await r.json()) as T
}

test.describe('NR-36 #107 · upload vazio falha com aviso + reparo do Vinicius com histórico', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-nr36-107-reparo-upload-vazio', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('importação com zero linhas falha com mensagem e não fica "processada"', { tag: '@pos-migration' }, async () => {
    const hash = `e2e-107-vazio-${Date.now()}`
    const reg = await comoRobo<{ ok: boolean; upload_id?: string; mensagem?: string }>('fn_nr36_upload_registrar', {
      p_company_id: DEMO_SST, p_arquivo_nome: 'e2e-vazio.xlsx', p_arquivo_path: `e2e/${hash}.xlsx`, p_arquivo_hash: hash,
      p_bytes: 0, p_mime: null, p_periodo_ini: '2026-09-15', p_periodo_fim: '2026-09-15',
    })
    expect(reg.ok, reg.mensagem).toBe(true)
    const proc = await comoRobo<{ ok: boolean; erro?: string; mensagem?: string }>('fn_nr36_upload_processar', { p_upload_id: reg.upload_id, p_linhas: [] })
    expect(proc.ok, 'zero linhas não é sucesso').toBe(false)
    expect(proc.erro).toBe('zero_linhas')
    expect(proc.mensagem ?? '', 'mensagem clara para quem enviou').toMatch(/nada foi importado/i)
    const [up] = await dbSelect<{ status: string }>('nr36_upload', `select=status&id=eq.${reg.upload_id}`)
    expect(up.status, 'upload marcado como falhou').toBe('falhou')
  })

  test('Vinicius 01–11/09: pausas reais no cálculo e confirmações guardadas como histórico', { tag: '@pos-migration' }, async () => {
    const hist = await dbSelect<{ fim_confirmado: string | null }>('nr36_pausa_historico',
      `select=fim_confirmado&company_id=eq.${FRIOESTE}&cpf=eq.${VINICIUS}&data=gte.2026-09-01&data=lte.2026-09-11`)
    expect(hist.length, 'as 30 confirmações da cliente estão guardadas').toBe(30)
    expect(hist.every(h => h.fim_confirmado), 'todas com o fim confirmado preservado').toBe(true)
    const pausas = await dbSelect<{ duracao_seg: number }>('ind_ponto_pausa',
      `select=duracao_seg&company_id=eq.${FRIOESTE}&cpf=eq.${VINICIUS}&data=gte.2026-09-01&data=lte.2026-09-11`)
    expect(pausas.length, 'pausas reais lidas do arquivo').toBe(22)
    expect(pausas.every(p => p.duracao_seg >= 15 * 60 && p.duracao_seg <= 30 * 60), 'pausas de 15–30 min').toBe(true)
    const pend = await dbSelect<{ data: string }>('nr36_pausa_apurada',
      `select=data&company_id=eq.${FRIOESTE}&cpf=eq.${VINICIUS}&data=gte.2026-09-01&data=lte.2026-09-11&status=eq.pendente_confirmacao`)
    expect(pend, 'nenhum dia aguardando confirmação').toEqual([])
  })
})
