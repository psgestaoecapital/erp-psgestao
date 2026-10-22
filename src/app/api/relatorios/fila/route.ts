// POST /api/relatorios/fila — #3281 etapa 2: o GERADOR dos relatórios em segundo plano ("Meus relatórios").
// Pega os pedidos da fila erp_relatorio_pedido (fn_relatorio_fila_pegar, SKIP LOCKED), monta o arquivo e grava no
// bucket privado "relatorios" em {empresa}/{solicitante}/{pedido}.xlsx; a fila marca pronto (validade 7 dias) ou erro.
//
// Quem chama: o pg_cron (fn_relatorio_fila_dispatch, a cada 2 min e SÓ quando há pedido na fila) com a service key, e a
// própria tela logo depois do pedido (usuário logado) — para começar na hora.
// Etapa 4: também gera "Contas a pagar" e "Contas a receber" (mesmo recorte da listagem: vencimento no período). Qualquer chamada só processa a fila: a
// empresa e o solicitante vêm do pedido gravado (conferidos na entrada por fn_relatorio_pedir), nunca do corpo.
import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { comGuarda } from '@/lib/auth/guardaApi'
import { montarPlanilhaMovimentacao, type LinhaMovimentacao } from '@/lib/relatorios/movimentacaoExcel'
import { montarPlanilhaTitulos, type LinhaTitulo } from '@/lib/relatorios/titulosExcel'

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

// Tipos que o gerador já monta (todos em Excel); os demais do pedido voltam com erro explicado.
const GERADOS = new Set(['financeiro_movimentacao', 'financeiro_pagar', 'financeiro_receber'])

function periodo(p: Pedido): { ini: string; fim: string } {
  const ini = String(p.parametros?.data_inicio ?? '').slice(0, 10)
  const fim = String(p.parametros?.data_fim ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ini) || !/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new Error('período inválido no pedido')
  return { ini, fim }
}

async function nomeEmpresa(supa: SupabaseClient, companyId: string): Promise<string> {
  const { data: emp } = await supa.from('companies').select('razao_social, nome_fantasia').eq('id', companyId).maybeSingle()
  const e = emp as { razao_social: string | null; nome_fantasia: string | null } | null
  return e?.nome_fantasia || e?.razao_social || 'Empresa'
}

async function gravar(supa: SupabaseClient, p: Pedido, buf: Buffer): Promise<string> {
  const caminho = `${p.company_id}/${p.solicitante}/${p.id}.xlsx`
  const { error: eUp } = await supa.storage.from('relatorios').upload(caminho, buf, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true,
  })
  if (eUp) throw new Error('falha ao gravar o arquivo')
  return caminho
}

// Contas a pagar / a receber: títulos não excluídos com vencimento no período (o recorte da tela de listagem).
async function gerarTitulos(supa: SupabaseClient, p: Pedido): Promise<{ caminho: string; bytes: number; linhas: number }> {
  const { ini, fim } = periodo(p)
  const pagar = p.tipo === 'financeiro_pagar'
  const tabela = pagar ? 'erp_pagar' : 'erp_receber'
  const pessoa = pagar ? 'fornecedor_nome' : 'cliente_nome'
  const colunas = `id, ${pessoa}, descricao, categoria, numero_documento, numero_nf, parcela, data_emissao, data_vencimento, data_pagamento, status, forma_pagamento, valor, valor_pago`

  const linhas: LinhaTitulo[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supa
      .from(tabela)
      .select(colunas)
      .eq('company_id', p.company_id)
      .is('deleted_at', null)
      .gte('data_vencimento', ini)
      .lte('data_vencimento', fim)
      .order('data_vencimento', { ascending: true })
      .order('id', { ascending: true })
      .range(de, de + PAGINA - 1)
    if (error) throw new Error('falha ao ler os títulos')
    const lote = (data ?? []) as unknown as Array<Record<string, unknown>>
    for (const r of lote) {
      linhas.push({
        id: String(r.id), pessoa: (r[pessoa] as string | null) ?? null, descricao: (r.descricao as string | null) ?? null,
        categoria: (r.categoria as string | null) ?? null, documento: (r.numero_documento as string | null) ?? null,
        numero_nf: (r.numero_nf as string | null) ?? null, parcela: (r.parcela as string | null) ?? null,
        data_emissao: (r.data_emissao as string | null) ?? null, data_vencimento: String(r.data_vencimento),
        data_pagamento: (r.data_pagamento as string | null) ?? null, status: String(r.status ?? ''),
        forma_pagamento: (r.forma_pagamento as string | null) ?? null,
        valor: r.valor == null ? null : Number(r.valor), valor_pago: r.valor_pago == null ? null : Number(r.valor_pago),
      })
    }
    if (linhas.length > MAX_LINHAS) throw new Error('relatório grande demais: reduza o período')
    if (lote.length < PAGINA) break
    await atualizar(supa, p.id, { p_status: 'gerando', p_progresso: Math.min(80, 10 + Math.floor(linhas.length / 500)) })
  }

  // categoria vem como código do plano de contas: mostra "código · nome", como a tela
  const { data: pc } = await supa.from('erp_plano_contas').select('codigo, descricao').eq('company_id', p.company_id)
  const nomes = new Map(((pc ?? []) as { codigo: string; descricao: string | null }[]).filter((c) => c.codigo && c.descricao).map((c) => [c.codigo, c.descricao as string]))
  for (const l of linhas) if (l.categoria && nomes.has(l.categoria)) l.categoria = `${l.categoria} · ${nomes.get(l.categoria)}`

  const empresa = await nomeEmpresa(supa, p.company_id)
  await atualizar(supa, p.id, { p_status: 'gerando', p_progresso: 85 })
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
  const buf = await montarPlanilhaTitulos(linhas, { tipo: pagar ? 'pagar' : 'receber', empresa, titulo: p.titulo, dataInicio: ini, dataFim: fim, geradoEm: new Date(), hoje })
  const caminho = await gravar(supa, p, buf)
  return { caminho, bytes: buf.length, linhas: linhas.length }
}

async function gerarMovimentacao(supa: SupabaseClient, p: Pedido): Promise<{ caminho: string; bytes: number; linhas: number }> {
  const { ini, fim } = periodo(p)

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

  const empresa = await nomeEmpresa(supa, p.company_id)
  await atualizar(supa, p.id, { p_status: 'gerando', p_progresso: 85 })
  const buf = await montarPlanilhaMovimentacao(linhas, { empresa, titulo: p.titulo, dataInicio: ini, dataFim: fim, geradoEm: new Date() })
  const caminho = await gravar(supa, p, buf)
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

    if (!GERADOS.has(p.tipo) || p.formato !== 'excel') {
      await atualizar(supa, p.id, {
        p_status: 'erro',
        p_erro: 'Este relatório ainda não é gerado em segundo plano. Por enquanto: Movimentação financeira, Contas a pagar e Contas a receber, em Excel.',
      })
      feitos.push({ id: p.id, status: 'erro' })
      continue
    }
    try {
      const r = p.tipo === 'financeiro_movimentacao' ? await gerarMovimentacao(supa, p) : await gerarTitulos(supa, p)
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
