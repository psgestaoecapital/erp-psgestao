// POST /api/industrial/folha/upload — sobe a planilha de folha (Domínio .xls/.xlsx),
// parseia e grava folha_competencia + folha_verba. Idempotente por competência
// (re-upload REGRAVA). Auth: sessão do usuário + escopo de empresa. LGPD: salário
// é sensível → RLS company-scoped; escrita via service_role após checar acesso.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseFolhaDominio } from '@/lib/folha/dominio'
import { repararWorkbookDominio } from '@/lib/folha/reparar-xls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function sessaoComAcesso(req: NextRequest, companyId: string): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data, error } = await sb.rpc('get_user_company_ids')
  if (error || !Array.isArray(data) || !(data as string[]).includes(companyId)) return null
  return { userId: user.id }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const companyId = String(form.get('company_id') || '')
    const confirmar = String(form.get('confirmar') || '') === 'true'
    const file = form.get('file')
    if (!companyId || !(file instanceof File)) {
      return NextResponse.json({ ok: false, erro: 'company_id e file sao obrigatorios' }, { status: 400 })
    }
    const sess = await sessaoComAcesso(req, companyId)
    if (!sess) return NextResponse.json({ ok: false, erro: 'nao autenticado ou sem acesso a esta empresa' }, { status: 401 })

    // FIX FOLHA-DOMINIO (14/07): os .xls do Domínio gravam o BOUNDSHEET com o
    // ponteiro lbPlyPos ERRADO — XLSX.read confia, pula pro offset errado e
    // devolve a planilha VAZIA SEM lançar exceção. O reparo BIFF (repararWorkbook
    // Dominio) conserta o ponteiro (JS puro, roda no Vercel). Fluxo: lê normal →
    // se vier vazio, REPARA e relê → só então erra. Mensagens DISTINTAS por código
    // (abertura ≠ vazio ≠ conteudo) — nunca mascara falha de abertura como de conteúdo.
    const buf = new Uint8Array(await file.arrayBuffer())

    const lerLinhas = (wb: XLSX.WorkBook): unknown[][] => {
      for (const nome of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, raw: true, blankrows: false }) as unknown[][]
        if (rows.length > 0) return rows
      }
      return []
    }

    let rows: unknown[][] = []
    let via: 'normal' | 'reparado' = 'normal'
    try {
      rows = lerLinhas(XLSX.read(buf, { type: 'array', cellDates: false }))
    } catch (e) {
      return NextResponse.json({
        ok: false, codigo: 'abertura',
        erro: `Não consegui ABRIR o arquivo (formato OLE/CFB fora do padrão). Reexporte em .xlsx ou abra/salve no LibreOffice. Detalhe: ${(e as Error).message}`,
      }, { status: 422 })
    }

    // veio vazio → provável BOUNDSHEET com ponteiro errado; repara e relê.
    if (rows.length === 0) {
      const reparado = repararWorkbookDominio(buf)
      if (reparado) {
        try { rows = lerLinhas(XLSX.read(reparado, { type: 'array', cellDates: false })); via = 'reparado' } catch { /* segue vazio */ }
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({
        ok: false, codigo: 'vazio',
        erro: 'O arquivo ABRIU mas veio VAZIO e o reparo do ponteiro (BOUNDSHEET) não recuperou dados. NÃO é problema de competência — confirme que é a planilha "Encargos da Empresa" do Domínio.',
      }, { status: 422 })
    }

    const parsed = parseFolhaDominio(rows)
    if (!parsed.competencia) return NextResponse.json({ ok: false, codigo: 'conteudo', erro: 'Li o conteúdo, mas não achei a competência (MM/YYYY) no topo da planilha.' }, { status: 422 })
    if (parsed.funcionarios.length === 0) return NextResponse.json({ ok: false, codigo: 'conteudo', erro: 'Achei a competência mas nenhum funcionário reconhecido (col 0 deve ser matrícula).' }, { status: 422 })

    // Preview: não grava, só devolve o que leu (RD-38: CEO confere antes).
    if (!confirmar) {
      return NextResponse.json({
        ok: true, preview: true, via, competencia: parsed.competencia, cnpj: parsed.cnpj,
        funcionarios: parsed.funcionarios.length, total_geral: parsed.total_geral,
      })
    }

    // Idempotência: re-upload da mesma competência REGRAVA (cascade limpa verbas).
    await supabaseAdmin.from('folha_competencia').delete().eq('company_id', companyId).eq('competencia', parsed.competencia)

    const compRows = parsed.funcionarios.map((f) => ({
      company_id: companyId, matricula: f.matricula, competencia: parsed.competencia,
      nome: f.nome, remuneracao: f.remuneracao, total_geral: f.total_geral, raw: f.raw, criado_por: sess.userId,
    }))
    const { data: inserted, error: e1 } = await supabaseAdmin.from('folha_competencia').insert(compRows).select('id, matricula')
    if (e1) return NextResponse.json({ ok: false, erro: `falha ao gravar folha: ${e1.message}` }, { status: 502 })

    const idPorMatricula = new Map<number, string>()
    for (const r of (inserted ?? []) as { id: string; matricula: number }[]) idPorMatricula.set(r.matricula, r.id)
    const verbaRows = parsed.funcionarios.flatMap((f) => f.verbas.map((v) => ({
      folha_competencia_id: idPorMatricula.get(f.matricula), company_id: companyId, matricula: f.matricula,
      competencia: parsed.competencia, codigo_verba: v.codigo_verba, descricao: v.descricao, valor: v.valor, tipo: v.tipo,
    })).filter((x) => x.folha_competencia_id))
    if (verbaRows.length > 0) {
      const { error: e2 } = await supabaseAdmin.from('folha_verba').insert(verbaRows)
      if (e2) return NextResponse.json({ ok: false, erro: `folha gravada, mas verbas falharam: ${e2.message}` }, { status: 502 })
    }

    try {
      await supabaseAdmin.from('erp_banco_sync_log').insert({
        company_id: companyId, banco_codigo: '000', provider: 'dominio_folha', tipo: 'folha_upload', status: 'ok',
        qtd: compRows.length, mensagem: `folha ${parsed.competencia}: ${compRows.length} func · total ${parsed.total_geral} · ${verbaRows.length} verbas`,
        payload_resumo: { competencia: parsed.competencia, cnpj: parsed.cnpj },
      })
    } catch { /* log nao derruba */ }

    return NextResponse.json({
      ok: true, via, competencia: parsed.competencia, funcionarios: compRows.length, verbas: verbaRows.length, total_geral: parsed.total_geral,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, erro: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
