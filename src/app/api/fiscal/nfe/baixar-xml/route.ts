import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { guardarXmlNota, reparseXmlNota } from '@/lib/fiscal/guardarXmlNota'
import { guardaEmpresaFiscal } from '@/lib/auth/assertAcessoEmpresa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// POST /api/fiscal/nfe/baixar-xml
//   { nfeId }                        → baixa e guarda o XML de UMA nota (da Focus)
//   { companyId, backfill: true }    → baixa e guarda o XML de TODAS as autorizadas dessa empresa sem XML
//   { nfeId, reparse: true }         → re-parseia o XML JÁ guardado (sem tocar a Focus) e regrava vTotTrib
//   { companyId, reparse: true }     → re-parseia o XML de TODAS as autorizadas com XML guardado
// Guarda no Storage (bucket privado) + grava xml_storage_path e o vTotTrib (prova da Lei 12.741).
// O reparse serve para provar no dado (RD-38) se a Focus preenche vTotTrib na NF-e, depois de corrigir
// o parser — sem re-baixar da Focus (que este ambiente não alcança).
interface Body { nfeId?: string; companyId?: string; backfill?: boolean; reparse?: boolean; forcar?: boolean }

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

  // reparse: re-lê o XML guardado e regrava vTotTrib (sem Focus) — prova RD-38 do cálculo na NF-e
  if (body.reparse) {
    if (body.nfeId) {
      const r = await reparseXmlNota(body.nfeId)
      return NextResponse.json({ ok: r.ok, resultado: r }, { status: r.ok ? 200 : 502 })
    }
    const { data: notas } = await supabaseAdmin
      .from('erp_nfe_emitidas')
      .select('id')
      .eq('company_id', companyId)
      .eq('status', 'autorizada')
      .not('xml_storage_path', 'is', null)
      .limit(200)
    const alvos = (notas ?? []) as { id: string }[]
    const resultados = []
    for (const n of alvos) resultados.push(await reparseXmlNota(n.id))
    const ok = resultados.filter((r) => r.ok).length
    const comValor = resultados.filter((r) => r.valorTotalTributos != null).length
    return NextResponse.json({
      ok: true, modo: 'reparse', total: alvos.length, reparseados: ok, falhas: alvos.length - ok,
      com_vtottrib: comValor, // 0 = a Focus não calcula vTotTrib na NF-e; >0 = o parser era o bug
      detalhe: resultados.map((r) => ({ nfeId: r.nfeId, tipo: r.tipoDoc, valor_total_tributos: r.valorTotalTributos ?? null, itens_com_vtottrib: r.itensComVTotTrib ?? null, erro: r.erro ?? null })),
    })
  }

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

  return NextResponse.json({ ok: false, mensagem: 'Forneça nfeId OU companyId+backfill (ou +reparse)' }, { status: 400 })
})
