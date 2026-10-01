// 🔒 Segurança · lote 1 · S1 Financeiro e banco (CEO 01/10). Migration 20261001180000: 8 funções que rodam como dono
// (pulam a RLS) e gravavam em qualquer empresa pelo id (títulos de compra, parcelas de pedido, proposta de cotação,
// vínculo de DRE, Pluggy, fechamento BPO) passam a conferir que a empresa DO REGISTRO é do usuário (fn__guarda_empresa;
// sem usuário = serviço/cron passa; equipe PS passa). A recusa para usuário de outra empresa foi provada em produção
// com RAISE (desfeito) nas 8 funções. Aqui: o caminho principal da demo segue funcionando e o conferidor nega empresa
// que não é do robô. O robô é PS_ADMIN (vê as empresas não restritas), não "adm".
// Só na Demonstração Comércio (GE). Nenhuma chamada aqui passa por empresa de cliente.

import { test, expect } from '../../support/fixtures'
import { dbSelect, obterSessionPayload, registrarJornada } from '../../support/api'

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
const DEMO_GE = 'b0700000-0000-4000-a000-000000000004'
const OUTRA = '00000000-0000-4000-a000-0000000051f1'

async function chamar(fn: string, args: Record<string, unknown>) {
  const token = (JSON.parse(await obterSessionPayload()) as { access_token: string }).access_token
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  return { status: r.status, corpo: (await r.json().catch(() => ({}))) as { code?: string; success?: boolean } }
}

test.describe('Segurança S1 · financeiro só grava na empresa do usuário', () => {
  test.afterEach(async ({}, testInfo) => {
    await registrarJornada('aceitacao-seguranca-s1-financeiro', testInfo.status === testInfo.expectedStatus ? 'verde' : 'vermelho', testInfo.title)
  })

  test('fechamento BPO da demo: marcar acesso ao portal segue funcionando', async () => {
    const [emp] = await dbSelect<{ is_demo: boolean }>('companies', `id=eq.${DEMO_GE}&select=is_demo`)
    expect(emp?.is_demo, 'só na demonstração').toBe(true)
    const [fech] = await dbSelect<{ id: string }>('bpo_fechamento_mensal', `company_id=eq.${DEMO_GE}&select=id&limit=1`)
    test.skip(!fech, 'a demo não tem fechamento BPO')
    const r = await chamar('fn_bpo_fechamento_marcar_enviado', { p_fechamento_id: fech.id, p_canal: 'portal', p_destinatario: null, p_user_id: null })
    expect(r.status, JSON.stringify(r.corpo)).toBe(200)
    expect(r.corpo.success).toBe(true)
  })

  test('conferidor: empresa do usuário passa, empresa de outro é negada (42501)', { tag: '@pos-migration' }, async () => {
    const minha = await chamar('fn__guarda_empresa', { p_company_id: DEMO_GE })
    expect(minha.status, JSON.stringify(minha.corpo)).toBeLessThan(300)
    const outra = await chamar('fn__guarda_empresa', { p_company_id: OUTRA })
    expect(outra.status).toBeGreaterThanOrEqual(400)
    expect(outra.corpo.code, 'negado por permissão').toBe('42501')
  })
})
