import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/withAuth'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import ExcelJS from 'exceljs'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

// import-produtos-fiscal-v1
// POST multipart: file=<xlsx>, companyId=<uuid>, mode='parse'|'preview'|'aplicar'
//   parse:   so devolve headers + auto-mapping + sample (sem rodar RPC)
//   preview: roda RPC com dry_run=true (com o mapping vindo do body)
//   aplicar: roda RPC com dry_run=false

type Campo = 'codigo' | 'ncm' | 'st' | 'cest' | 'monofasico'

const SINONIMOS: Record<Campo, string[]> = {
  codigo: ['codigo','código','code','sku','ref','referencia','referência','id','cod','codigo do produto','codigo produto'],
  ncm: ['ncm','ncm/sh','codigo ncm','código ncm'],
  st: ['st','icms st','icms-st','substituicao tributaria','substituição tributária','tem st','possui st'],
  cest: ['cest'],
  monofasico: ['monofasico','monofásico','pis/cofins','pis cofins','tributacao pis','tributação pis'],
}

function normalize(s: string): string {
  return s.toString().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

function autoDetect(headers: string[]): Record<Campo, string | null> {
  const normHeaders = headers.map((h) => ({ raw: h, norm: normalize(h) }))
  const out: Record<Campo, string | null> = { codigo: null, ncm: null, st: null, cest: null, monofasico: null }
  for (const campo of Object.keys(SINONIMOS) as Campo[]) {
    const sinNorm = SINONIMOS[campo].map(normalize)
    const match = normHeaders.find((h) => sinNorm.some((s) => h.norm === s || h.norm.includes(s)))
    if (match) out[campo] = match.raw
  }
  return out
}

function parseBoolBR(v: unknown): boolean {
  if (v == null) return false
  const s = String(v).trim().toLowerCase()
  return s === 'sim' || s === 's' || s === 'true' || s === '1' || s === 'x' || s === 'yes'
}

interface MappingInput {
  codigo?: string
  ncm?: string
  st?: string
  cest?: string
  monofasico?: string
}

export const POST = withAuth(async (req: NextRequest, { userId }) => {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const companyId = form.get('companyId')?.toString() ?? null
    const mode = (form.get('mode')?.toString() ?? 'parse') as 'parse' | 'preview' | 'aplicar'
    const mappingRaw = form.get('mapping')?.toString() ?? null

    if (!file) {
      return NextResponse.json({ ok: false, mensagem: 'file obrigatorio' }, { status: 400 })
    }
    if (!companyId) {
      return NextResponse.json({ ok: false, mensagem: 'companyId obrigatorio' }, { status: 400 })
    }

    // Valida acesso a empresa
    const { count: accessCnt, error: accessErr } = await supabaseAdmin
      .from('user_companies')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('company_id', companyId)
    if (accessErr) {
      return NextResponse.json({ ok: false, mensagem: 'Erro ao validar permissao: ' + accessErr.message }, { status: 500 })
    }
    if ((accessCnt ?? 0) === 0) {
      return NextResponse.json({ ok: false, mensagem: 'Sem permissao para essa empresa' }, { status: 403 })
    }

    // Parse XLSX
    const buf = Buffer.from(await file.arrayBuffer())
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const ws = wb.worksheets[0]
    if (!ws) {
      return NextResponse.json({ ok: false, mensagem: 'Planilha sem abas' }, { status: 400 })
    }
    const headerRow = ws.getRow(1)
    const headers: string[] = []
    headerRow.eachCell({ includeEmpty: false }, (cell) => {
      headers.push(String(cell.value ?? '').trim())
    })

    if (mode === 'parse') {
      const mapping = autoDetect(headers)
      const sample: Array<Record<string, unknown>> = []
      for (let r = 2; r <= Math.min(ws.rowCount, 51); r++) {
        const row = ws.getRow(r)
        const obj: Record<string, unknown> = {}
        headers.forEach((h, idx) => {
          const cell = row.getCell(idx + 1)
          obj[h] = cell.value ?? null
        })
        sample.push(obj)
      }
      return NextResponse.json({
        ok: true,
        headers,
        mapping_auto: mapping,
        sample,
        total_rows: ws.rowCount - 1,
      })
    }

    // preview / aplicar: precisa de mapping
    if (!mappingRaw) {
      return NextResponse.json({ ok: false, mensagem: 'mapping obrigatorio em modo preview/aplicar' }, { status: 400 })
    }
    const mapping = JSON.parse(mappingRaw) as MappingInput

    // Extrai todas as rows + monta o jsonb pra RPC
    const colIdx: Partial<Record<Campo, number>> = {}
    ;(['codigo', 'ncm', 'st', 'cest', 'monofasico'] as Campo[]).forEach((c) => {
      const header = mapping[c]
      if (header) {
        const idx = headers.indexOf(header)
        if (idx >= 0) colIdx[c] = idx + 1
      }
    })

    if (colIdx.codigo == null) {
      return NextResponse.json({ ok: false, mensagem: 'Mapeamento obrigatorio: codigo' }, { status: 400 })
    }

    const rows: Array<Record<string, unknown>> = []
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r)
      const cellCodigo = row.getCell(colIdx.codigo)
      const codigoVal = String(cellCodigo.value ?? '').trim()
      if (!codigoVal) continue
      const obj: Record<string, unknown> = { codigo: codigoVal }
      if (colIdx.ncm != null) obj.ncm = String(row.getCell(colIdx.ncm).value ?? '').replace(/\D/g, '')
      if (colIdx.cest != null) obj.cest = String(row.getCell(colIdx.cest).value ?? '').replace(/\D/g, '')
      if (colIdx.st != null) obj.st = parseBoolBR(row.getCell(colIdx.st).value)
      if (colIdx.monofasico != null) obj.monofasico = parseBoolBR(row.getCell(colIdx.monofasico).value)
      rows.push(obj)
    }

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, mensagem: 'Nenhuma linha valida apos mapeamento' }, { status: 400 })
    }

    const isDryRun = mode === 'preview'
    const { data, error } = await supabaseAdmin.rpc('fn_import_produtos_fiscal', {
      p_company_id: companyId,
      p_rows: rows,
      p_dry_run: isDryRun,
      p_user_id: userId,
      p_arquivo: file.name,
    })
    if (error) {
      return NextResponse.json({ ok: false, mensagem: 'Erro RPC: ' + error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, ...(data as object) })
  } catch (err) {
    const msg = (err as Error)?.message ?? 'Erro interno'
    return NextResponse.json({ ok: false, mensagem: msg }, { status: 500 })
  }
})
