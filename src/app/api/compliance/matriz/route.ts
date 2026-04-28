// PS Gestão ERP — Compliance Hub
// GET /api/compliance/matriz?company_id=...&empresa_tomadora=...&obra=...&setor=...&cargo=...
//
// Retorna a view v_compliance_matriz_funcionarios filtrada. A view traz
// um registro por (funcionario, tipo_documento) — o cliente faz o pivot
// pra renderizar em grid.

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { createClient } from '@supabase/supabase-js'

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export const GET = withAuth(async (req: NextRequest) => {
  const url = new URL(req.url)
  const companyIdsParam = url.searchParams.get('company_ids')
  const companyIdParam = url.searchParams.get('company_id')
  const companyIds = companyIdsParam
    ? companyIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : companyIdParam
      ? [companyIdParam]
      : []
  const empresaTomadora = url.searchParams.get('empresa_tomadora')
  const obra = url.searchParams.get('obra')
  const setor = url.searchParams.get('setor')
  const cargo = url.searchParams.get('cargo')
  const apenasAtivos = url.searchParams.get('apenas_ativos') !== 'false'

  if (companyIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'company_id ou company_ids obrigatório' },
      { status: 400 }
    )
  }

  const sb = admin()

  // Carrega tipos de documento de funcionário (colunas do grid).
  const { data: tipos } = await sb
    .from('compliance_tipos_documento')
    .select('id, slug, nome, grupo, obrigatorio, ordem_exibicao')
    .eq('categoria', 'funcionario')
    .eq('ativo', true)
    .order('ordem_exibicao')
    .order('nome')

  // Carrega a matriz.
  // Carrega a matriz. Filtra funcionários onde a empresa selecionada é
  // empregadora (company_id) OU tomadora de serviço (empresa_tomadora_id) —
  // padrão terceirização: CLT em A presta serviço em obra de B.
  const idsCsv = companyIds.join(',')
  let q = sb
    .from('v_compliance_matriz_funcionarios')
    .select('*')
    .or(`company_id.in.(${idsCsv}),empresa_tomadora_id.in.(${idsCsv})`)
  if (apenasAtivos) q = q.eq('funcionario_ativo', true)
  if (empresaTomadora) q = q.eq('empresa_tomadora_nome', empresaTomadora)
  if (obra) q = q.eq('obra_nome', obra)
  if (setor) q = q.eq('setor', setor)
  if (cargo) q = q.eq('cargo', cargo)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const linhas = (data as any[] | null) ?? []

  // Agrupa por funcionário.
  const porFuncionario = new Map<string, any>()
  for (const l of linhas) {
    if (!porFuncionario.has(l.funcionario_id)) {
      porFuncionario.set(l.funcionario_id, {
        funcionario_id: l.funcionario_id,
        company_id: l.company_id,
        nome_completo: l.nome_completo,
        cpf: l.cpf,
        cargo: l.cargo,
        setor: l.setor,
        empresa_tomadora_nome: l.empresa_tomadora_nome,
        obra_nome: l.obra_nome,
        funcionario_ativo: l.funcionario_ativo,
        documentos: {} as Record<string, any>,
      })
    }
    const f = porFuncionario.get(l.funcionario_id)
    f.documentos[l.tipo_slug] = {
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
    }
  }

  const funcionarios = Array.from(porFuncionario.values()).sort((a, b) =>
    (a.nome_completo || '').localeCompare(b.nome_completo || '')
  )

  return NextResponse.json({
    ok: true,
    tipos: tipos ?? [],
    funcionarios,
    total: funcionarios.length,
  })
})
