// POST /api/relatorios/fila — #3281 etapa 2: o GERADOR dos relatórios em segundo plano ("Meus relatórios").
// Pega os pedidos da fila erp_relatorio_pedido (fn_relatorio_fila_pegar, SKIP LOCKED), monta o arquivo e grava no
// bucket privado "relatorios" em {empresa}/{solicitante}/{pedido}.xlsx; a fila marca pronto (validade 7 dias) ou erro.
//
// Quem chama: o pg_cron (fn_relatorio_fila_dispatch, a cada 2 min e SÓ quando há pedido na fila) com a service key, e a
// própria tela logo depois do pedido (usuário logado) — para começar na hora. Qualquer chamada só processa a fila: a
// empresa e o solicitante vêm do pedido gravado (conferidos na entrada por fn_relatorio_pedir), nunca do corpo.
import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { comGuarda } from '@/lib/auth/guardaApi'
import { montarPlanilhaMovimentacao, type LinhaMovimentacao } from '@/lib/relatorios/movimentacaoExcel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PAGINA = 1000
const MAX_LINHAS = 200000
const ORCAMENTO_MS = 240000 // para de pegar pedido novo depois de 4 min (o limite da função é 5)

type Pedido = {
  id: string
  company_id: string
  solicitante: string
  tipo: string
  formato: string
  parametros: { data_inicio?: string; data_fim?: string }
  titulo: string
}

async function atualizar(supa: SupabaseClient, id: string, campos: Record<string, unknown>) {
  await supa.rpc('fn_relatorio_fila_atualizar', { p_id: id, ...campos })
}

async function gerarMovimentacao(supa: SupabaseClient, p: Pedido): Promise<{ caminho: string; bytes: number; linhas: number }> {
  const ini = String(p.parametros?.data_inicio ?? '').slice(0, 10)
  const fim = String(p.parametros?.data_fim ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new Error('período inválido no pedido')

  const linhas: LinhaMovimentacao[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supa
      .rpc('fn_relatorio_movimentacao_linhas', { p_company_id: p.company_id, p_data_inicio: ini, p_data_fim: fim })
      .order('data', { ascending: true })
      .order('chave', { ascending: true })
      .range(de, de + PAGINA - 1)
    if (error) throw new Error('falha ao ler a movimentação')
    const lote = (data ?? []) as LinhaMovimentacao[]
    linhas.push(...lote)
    if (linhas.length > MAX_LINHAS) throw new Error('relatório grande demais: reduza o período')
    if (lote.length < PAGINA) break
    await atualizar(supa, p.id, { p_status: 'gerando', p_progresso: Math.min(80, 10 + Math.floor(linhas.length / 500)) })
  }

  const { data: emp } = await supa.from('companies').select('razao_social, nome_fantasia').eq('id', p.company_id).maybeSingle()
  const e = emp as { razao_social: string | null; nome_fantasia: string | null } | null
  const empresa = e?.nome_fantasia || e?.razao_social || 'Empresa'

  await atualizar(supa, p.id, { p_status: 'gerando', p_progresso: 85 })
  const buf = await montarPlanilhaMovimentacao(linhas, { empresa, titulo: p.titulo, dataInicio: ini, dataFim: fim, geradoEm: new Date() })

  const caminho = `${p.company_id}/${p.solicitante}/${p.id}.xlsx`
  const { error: eUp } = await supa.storage.from('relatorios').upload(caminho, buf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  })
  if (eUp) throw new Error('falha ao gravar o arquivo')
  return { caminho, bytes: buf.length, linhas: linhas.length }
}

export const POST = comGuarda({ cron: true, servico: true }, async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ ok: false, erro: 'configuração ausente' }, { status: 500 })
  const supa = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const inicio = Date.now()
  const feitos: Array<{ id: string; status: string; linhas?: number }> = []
  while (Date.now() - inicio < ORCAMENTO_MS) {
    const { data, error } = await supa.rpc('fn_relatorio_fila_pegar')
    if (error) return NextResponse.json({ ok: false, erro: 'falha ao ler a fila', feitos }, { status: 500 })
    const p = (data as { ok: boolean; pedido: Pedido | null } | null)?.pedido
    if (!p) break

    if (p.tipo !== 'financeiro_movimentacao' || p.formato !== 'excel') {
      await atualizar(supa, p.id, {
        p_status: 'erro',
        p_erro: 'Este relatório ainda não é gerado em segundo plano. Por enquanto, peça a Movimentação financeira em Excel.',
      })
      feitos.push({ id: p.id, status: 'erro' })
      continue
    }
    try {
      const r = await gerarMovimentacao(supa, p)
      await atualizar(supa, p.id, { p_status: 'pronto', p_arquivo_path: r.caminho, p_tamanho_bytes: r.bytes, p_linhas: r.linhas })
      feitos.push({ id: p.id, status: 'pronto', linhas: r.linhas })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'erro ao gerar'
      await atualizar(supa, p.id, { p_status: 'erro', p_erro: `Não foi possível gerar: ${msg}. Peça de novo.` })
      feitos.push({ id: p.id, status: 'erro' })
    }
  }
  return NextResponse.json({ ok: true, feitos })
})
