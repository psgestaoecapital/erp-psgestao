import { NextRequest, NextResponse } from 'next/server'
import { exigirUsuario, exigirEmpresas, negar } from '@/lib/auth/guardaApi'
import { assinarEstado } from '@/lib/auth/contaazulState'

// POST /api/contaazul/state — gera o `state` ASSINADO do OAuth ContaAzul (início do fluxo).
// Body: { company_id, client_id, client_secret }. Exige login e acesso à empresa.
export async function POST(req: NextRequest) {
  const guarda = await exigirUsuario(req)
  if (guarda instanceof NextResponse) return guarda
  try {
    const { company_id, client_id, client_secret } = await req.json()
    if (!client_id || !client_secret) return negar(400, 'Client ID e Client Secret obrigatórios.')
    const negado = await exigirEmpresas(guarda, [company_id])
    if (negado) return negado
    const state = assinarEstado({ companyId: company_id, userId: guarda.userId, clientId: client_id, clientSecret: client_secret })
    return NextResponse.json({ ok: true, state })
  } catch (e: unknown) {
    return negar(500, e instanceof Error ? e.message : 'Erro ao gerar state')
  }
}
