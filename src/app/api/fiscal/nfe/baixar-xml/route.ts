import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardarXmlNota } from '@/lib/fiscal/guardarXmlNota'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/fiscal/nfe/baixar-xml
//   { nfeId }                       → baixa e guarda o XML de UMA nota
//   { companyId, backfill: true }   → baixa e guarda o XML de TODAS as autorizadas dessa empresa sem XML
// Guarda no Storage (bucket privado) + grava xml_storage_path e o vTotTrib (prova da Lei 12.741).
interface Body { nfeId?: string; companyId?: string; backfill?: boolean; forcar?: boolean }

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  let body: Body
  try { body = (await req.json()) as Body } catch { return NextResponse.json({ ok: false, mensagem: 'JSON inválido' }, { status: 400 }) }

  // resolve a empresa (pela nota ou pelo companyId) e checa acesso
  let companyId = body.companyId ?? null
  if (!companyId && body.nfeId) {
    const { data } = await supabaseAdmin.from('erp_nfe_emitidas').select('company_id').eq('id', body.nfeId).maybeSingle()
    companyId = (data?.company_id as string | null) ?? null
  }
  if (!companyId) return NextResponse.json({ ok: false, mensagem: 'companyId ou nfeId obrigatório' }, { status: 400 })
  const negado = await guardaEmpresaFiscal({ userId, companyId, papelMinimo: 'membro', log: { notaTipo: 'nfe', operacao: 'baixar_xml', endpoint: 'nfe/baixar-xml' } })
  if (negado) return negado

  if (body.nfeId) {
    const r = await guardarXmlNota(body.nfeId, body.forcar === true)
    return NextResponse.json({ ok: r.ok, resultado: r }, { status: r.ok ? 200 : 502 })
  }

  if (body.backfill) {
    const { data: notas } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'autorizada')
      .is('xml_storage_path', null)
      .limit(200)
    const alvos = (notas ?? []) as { id: string }[]
    const resultados = []
    for (const n of alvos) resultados.push(await guardarXmlNota(n.id, false))
    const ok = resultados.filter((r) => r.ok).length
    return NextResponse.json({
      ok: true, total: alvos.length, guardados: ok, falhas: alvos.length - ok,
      // prova da Lei 12.741: vTotTrib de cada nota baixada
      vtottrib: resultados.filter((r) => r.ok).map((r) => ({ nfeId: r.nfeId, valor_total_tributos: r.valorTotalTributos ?? null })),
      resultados: resultados.filter((r) => !r.ok).slice(0, 20),
    })
  }

  return NextResponse.json({ ok: false, mensagem: 'Forneça nfeId OU companyId+backfill' }, { status: 400 })
})
