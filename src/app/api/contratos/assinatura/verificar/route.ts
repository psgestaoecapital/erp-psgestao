// #2936 etapa 4 · Rota PÚBLICA (sem login) da conferência de contrato assinado.
// A função do banco só aceita service_role; esta rota é a única porta. O que ela garante:
//  - só código de verificação (12 hex) ou hash SHA-256 (64 hex) chegam ao banco; o resto é recusado sem consulta;
//  - o arquivo conferido NUNCA sobe: a página calcula o hash no próprio navegador e manda só o hash;
//  - limite de 30 consultas por minuto por IP; a resposta traz só nome mascarado, papel e situação (LGPD).
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ipDaRequisicao } from '@/lib/contratos/assinatura'
import { normalizarConsulta, type ResultadoVerificacao } from '@/lib/contratos/verificacao'
import { rateLimit } from '@/lib/rateLimit'

const erro = (msg: string, status = 400) => NextResponse.json({ ok: false, erro: msg }, { status })

export async function POST(req: NextRequest) {
  const ip = ipDaRequisicao(req) ?? 'sem-ip'
  if (!rateLimit(`verificar-contrato:${ip}`, 60_000, 30).success) return erro('Muitas consultas seguidas; aguarde um minuto', 429)
  let body: { consulta?: string }
  try { body = await req.json() } catch { return erro('Pedido inválido') }
  const q = normalizarConsulta(body.consulta)
  if (!q) return erro('Digite o código de verificação (12 letras e números) ou confira o arquivo PDF')

  const { data, error } = await supabaseAdmin.rpc('fn_contrato_assinatura_verificar', { p_codigo_ou_hash: q.valor })
  if (error) return erro('Não consegui conferir agora; tente de novo em instantes', 500)
  const r = data as ResultadoVerificacao | null
  if (!r?.ok) return erro(r?.erro ?? 'Não consegui conferir agora')
  return NextResponse.json({ ...r, consulta: q.tipo })
}
