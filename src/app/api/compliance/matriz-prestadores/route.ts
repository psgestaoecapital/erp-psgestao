// PS Gestão ERP — Compliance Hub
// GET /api/compliance/matriz-prestadores?company_ids=...&q=...
//
// Espelha /api/compliance/matriz mas para prestadores PJ/MEI. Inclui
// terceirizacao via empresa_tomadora_id. Devolve { tipos, prestadores }
// onde cada prestador tem o pivot documentos por tipo_slug.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const idsParam = url.searchParams.get('company_ids')
  const idParam = url.searchParams.get('company_id')
  const ids = idsParam ? idsParam.split(',').map((s) => s.trim()).filter(Boolean) : (idParam ? [idParam] : [])
  if (ids.length === 0) return fail(400, 'company_id ou company_ids obrigatório.')
  const apenasAtivos = url.searchParams.get('apenas_ativos') !== 'false'

  // Tipos categoria=prestador (colunas do grid)
  const { data: tipos } = await supabaseAdmin
    .from('compliance_tipos_documento')
    .select('id, slug, nome, grupo, obrigatorio, ordem_exibicao')
    .eq('categoria', 'prestador')
    .eq('ativo', true)
    .order('ordem_exibicao')
    .order('nome')

  // Matriz com filtro empregadora OU tomadora
  const csv = ids.join(',')
  let q = supabaseAdmin
    .from('v_compliance_matriz_prestadores')
    .select('*')
    .or(`company_id.in.(${csv}),empresa_tomadora_id.in.(${csv})`)
  if (apenasAtivos) q = q.eq('prestador_ativo', true)

  const { data, error } = await q
  if (error) return fail(500, `Falha ao consultar matriz: ${error.message}`)

  const linhas = (data as any[] | null) ?? []
  const porPrestador = new Map<string, any>()
  for (const l of linhas) {
    if (!porPrestador.has(l.prestador_id)) {
      porPrestador.set(l.prestador_id, {
        prestador_id: l.prestador_id,
        company_id: l.company_id,
        razao_social: l.razao_social,
        cnpj: l.cnpj,
        nome_fantasia: l.nome_fantasia,
        responsavel_nome: l.responsavel_nome,
        tipo_contrato: l.tipo_contrato,
        empresa_tomadora_nome: l.empresa_tomadora_nome,
        obra_nome: l.obra_nome,
        servico_descricao: l.servico_descricao,
        prestador_ativo: l.prestador_ativo,
        documentos: {} as Record<string, any>,
      })
    }
    const p = porPrestador.get(l.prestador_id)
    p.documentos[l.tipo_slug] = {
      tipo_documento_id: l.tipo_documento_id,
      tipo_slug: l.tipo_slug,
      tipo_nome: l.tipo_nome,
      documento_id: l.documento_id,
      data_emissao: l.data_emissao,
      data_validade: l.data_validade,
      status_validade: l.status_validade,
      status_final: l.status_final,
      dias_para_vencer: l.dias_para_vencer,
      obrigatorio: l.obrigatorio,
      dispensa_motivo: l.dispensa_motivo,
    }
  }

  const prestadores = Array.from(porPrestador.values()).sort((a, b) =>
    (a.razao_social || '').localeCompare(b.razao_social || '')
  )

  return NextResponse.json({
    ok: true,
    tipos: tipos ?? [],
    prestadores,
    total: prestadores.length,
  })
})
