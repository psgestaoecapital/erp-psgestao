import { NextRequest, NextResponse } from 'next/server'
import { exigirLogin, exigirEmpresas } from '@/lib/auth/guardaApi'
import { createClient } from '@supabase/supabase-js'

// IMPORT-ESTOQUE server-side (#8621 parte B) — orquestra o lote INTEIRO no servidor, em UMA requisição.
// Antes: o navegador fazia o loop de chunks (N chamadas RPC); se a aba perdia o foco / era descartada no meio,
// a importação parava parcial (caso do Diego: 1.519 de 3.403). Aqui o front manda TODAS as linhas de uma vez e
// o servidor percorre os chunks chamando a MESMA fn_estoque_importar_lote (idempotente: reimportar não duplica),
// então não há dezenas de idas-e-vindas presas ao foco da aba.
// Guarda: exigirLogin + exigirEmpresas (o usuário logado precisa ter acesso à empresa) — a RPC roda via service_role
// e sua guarda interna é pulada para serviço, por isso a checagem de empresa é feita AQUI (mesmo padrão de /api/produtos).
// Aditivo: reusa a RPC viva, não altera schema, RLS nem dado de cliente além do que o fluxo atual já grava.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CHUNK = 1500

type Erro = { linha: number; codigo: string; motivo: string }
type ResultadoRpc = {
  novos?: number
  atualizados?: number
  saldos_ajustados?: number
  sem_mudanca?: number
  erros?: Erro[]
  erro?: string
} | null

export const POST = exigirLogin(async (req: NextRequest, u) => {
  let body: { company_id?: string; rows?: unknown[]; arquivo?: string | null; dry_run?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const companyId = typeof body?.company_id === 'string' ? body.company_id : ''
  const rows = Array.isArray(body?.rows) ? (body!.rows as Record<string, unknown>[]) : []
  if (!companyId) return NextResponse.json({ ok: false, error: 'company_id obrigatório' }, { status: 400 })

  const negado = await exigirEmpresas(u, [companyId])
  if (negado) return negado

  if (rows.length === 0) return NextResponse.json({ ok: false, error: 'rows vazias' }, { status: 400 })

  const dryRun = body?.dry_run === true
  const arquivo = typeof body?.arquivo === 'string' ? body.arquivo : null

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Histórico (RD-52 · rastro): 1 linha por importação, só na gravação real. Fica 'processando' até o fim —
  // como o loop todo é server-side, o status final é sempre gravado (não fica preso em 'processando' por perda de foco).
  let importId: string | null = null
  if (!dryRun) {
    const { data: imp } = await supabase
      .from('erp_importacoes')
      .insert({
        company_id: companyId,
        user_id: u.userId,
        sistema_origem: 'planilha_padrao',
        tipo_dado: 'estoque',
        registros_total: rows.length,
        status: 'processando',
        arquivo_nome: arquivo,
        iniciado_em: new Date().toISOString(),
      })
      .select('id')
      .maybeSingle()
    importId = (imp as { id?: string } | null)?.id ?? null
  }

  let novos = 0
  let atualizados = 0
  let comSaldo = 0
  let semMudanca = 0
  const erros: Erro[] = []

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { data, error } = await supabase.rpc('fn_estoque_importar_lote', {
      p_company_id: companyId,
      p_rows: chunk,
      p_dry_run: dryRun,
      p_user_id: u.userId,
      p_arquivo: arquivo,
    })
    if (error) {
      for (const r of chunk) erros.push({ linha: Number(r.n) || 0, codigo: String(r.codigo ?? ''), motivo: error.message })
    } else {
      const j = data as ResultadoRpc
      if (j?.erro) for (const r of chunk) erros.push({ linha: Number(r.n) || 0, codigo: String(r.codigo ?? ''), motivo: j.erro! })
      novos += j?.novos ?? 0
      atualizados += j?.atualizados ?? 0
      comSaldo += j?.saldos_ajustados ?? 0
      semMudanca += j?.sem_mudanca ?? 0
      if (j?.erros?.length) erros.push(...j.erros)
    }
  }

  if (importId) {
    await supabase
      .from('erp_importacoes')
      .update({
        registros_novos: novos + atualizados,
        registros_atualizados: comSaldo,
        registros_erro: erros.length,
        status: erros.length && !(novos + atualizados) ? 'falhou' : erros.length ? 'parcial' : 'concluido',
        concluido_em: new Date().toISOString(),
      })
      .eq('id', importId)
  }

  return NextResponse.json({ ok: true, novos, atualizados, comSaldo, semMudanca, erros })
})
