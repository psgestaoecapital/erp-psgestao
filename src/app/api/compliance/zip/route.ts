// PS Gestão ERP — Compliance Hub
// POST /api/compliance/zip   { company_id: uuid, funcionario_ids?: uuid[] }
//
// Empacota documentos ativos da empresa + dos funcionarios selecionados num
// arquivo ZIP. Estrutura:
//   <razao_social>/empresa/<tipo_slug>_<arquivo_nome>
//   <razao_social>/<nome_funcionario>/<tipo_slug>_<arquivo_nome>
//
// Documentos cujo download falhar (storage error) são pulados — registra
// warning no log mas não derruba o ZIP inteiro.

import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = 'compliance'

function fail(status: number, mensagem_humana: string) {
  return NextResponse.json({ ok: false, error: mensagem_humana, mensagem_humana }, { status })
}

function safe(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80) || 'sem_nome'
}

function yyyymmdd(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
}

export const POST = withAuth(async (req: NextRequest) => {
  const body = await req.json().catch(() => null)
  if (!body) return fail(400, 'Corpo da requisição inválido.')

  const company_id = (body.company_id as string | undefined) || ''
  const funcionarioIdsInput = Array.isArray(body.funcionario_ids) ? (body.funcionario_ids as string[]) : null

  if (!company_id) return fail(400, 'company_id é obrigatório.')

  // Empresa
  const { data: empresa, error: empErr } = await supabaseAdmin
    .from('companies')
    .select('id, razao_social, nome_fantasia')
    .eq('id', company_id)
    .maybeSingle()
  if (empErr) return fail(500, `Falha ao consultar empresa: ${empErr.message}`)
  if (!empresa) return fail(404, 'Empresa não encontrada.')

  const razao = (empresa as any).razao_social || (empresa as any).nome_fantasia || 'empresa'
  const rootDir = safe(razao)

  // Funcionarios alvo. Inclui terceirização: empresa selecionada como
  // empregadora (company_id) OU tomadora (empresa_tomadora_id).
  const orFilter = `company_id.eq.${company_id},empresa_tomadora_id.eq.${company_id}`
  let funcionarios: Array<{ id: string; nome_completo: string }> = []
  if (funcionarioIdsInput && funcionarioIdsInput.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('compliance_funcionarios')
      .select('id, nome_completo')
      .or(orFilter)
      .in('id', funcionarioIdsInput)
    if (error) return fail(500, `Falha ao consultar funcionários: ${error.message}`)
    funcionarios = (data as any[]) || []
  } else {
    const { data, error } = await supabaseAdmin
      .from('compliance_funcionarios')
      .select('id, nome_completo')
      .or(orFilter)
      .eq('ativo', true)
    if (error) return fail(500, `Falha ao consultar funcionários: ${error.message}`)
    funcionarios = (data as any[]) || []
  }

  // Documentos ativos: empresa (funcionario_id IS NULL) + funcionarios listados
  const funcIds = funcionarios.map((f) => f.id)

  const { data: docsEmpresa, error: docsEmpErr } = await supabaseAdmin
    .from('compliance_documentos')
    .select('id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original')
    .eq('company_id', company_id)
    .is('funcionario_id', null)
    .eq('ativo', true)
  if (docsEmpErr) return fail(500, `Falha ao consultar documentos: ${docsEmpErr.message}`)

  let docsFunc: any[] = []
  if (funcIds.length > 0) {
    // Não restringe company_id aqui: funcionarios podem vir pela tomadora
    // (CLT noutra empresa). funcIds já foi filtrado pelo OR acima.
    const { data, error } = await supabaseAdmin
      .from('compliance_documentos')
      .select('id, funcionario_id, tipo_documento_id, arquivo_url, arquivo_nome_original')
      .in('funcionario_id', funcIds)
      .eq('ativo', true)
    if (error) return fail(500, `Falha ao consultar documentos: ${error.message}`)
    docsFunc = data || []
  }

  const todosDocs = [...(docsEmpresa || []), ...docsFunc]
  if (todosDocs.length === 0) {
    return fail(404, 'Nenhum documento ativo encontrado para gerar o ZIP.')
  }

  // Slugs dos tipos referenciados
  const tipoIds = Array.from(new Set(todosDocs.map((d: any) => d.tipo_documento_id)))
  const { data: tipos } = await supabaseAdmin
    .from('compliance_tipos_documento')
    .select('id, slug')
    .in('id', tipoIds)
  const slugById = new Map<string, string>()
  for (const t of (tipos as any[]) || []) slugById.set(t.id, t.slug || 'doc')

  const nomeFuncById = new Map<string, string>()
  for (const f of funcionarios) nomeFuncById.set(f.id, f.nome_completo)

  // Monta ZIP
  const zip = new JSZip()
  let incluidos = 0
  const warnings: string[] = []

  for (const d of todosDocs) {
    const path: string = d.arquivo_url
    if (!path) {
      warnings.push(`doc ${d.id} sem arquivo_url`)
      continue
    }

    const { data: file, error: dlErr } = await supabaseAdmin.storage.from(BUCKET).download(path)
    if (dlErr || !file) {
      warnings.push(`download falhou para ${path}: ${dlErr?.message || 'sem dados'}`)
      continue
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const tipoSlug = slugById.get(d.tipo_documento_id) || 'doc'
    const nomeOriginal = (d.arquivo_nome_original as string | null) || `${tipoSlug}.bin`

    let entryPath: string
    if (d.funcionario_id) {
      const nomeFunc = safe(nomeFuncById.get(d.funcionario_id) || `funcionario_${d.funcionario_id.slice(0, 8)}`)
      entryPath = `${rootDir}/${nomeFunc}/${tipoSlug}_${nomeOriginal}`
    } else {
      entryPath = `${rootDir}/empresa/${tipoSlug}_${nomeOriginal}`
    }

    zip.file(entryPath, buffer)
    incluidos++
  }

  if (incluidos === 0) {
    return fail(500, `Nenhum arquivo pôde ser baixado do storage (${warnings.length} warnings).`)
  }

  const content = await zip.generateAsync({ type: 'nodebuffer' })
  const filename = `compliance_${rootDir}_${yyyymmdd()}.zip`

  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Compliance-Zip-Warnings': String(warnings.length),
      'X-Compliance-Zip-Files': String(incluidos),
    },
  })
})
