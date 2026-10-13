import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'
import { validarFiltroIA } from '@/lib/pm/pauta'

// Pauta P&M · P2 · "Descreva o que quer ver" (SPEC P&M · Pauta, seções 5 e 8). A IA traduz a frase em FILTROS para a
// pessoa conferir antes de aplicar — nunca aplica sozinha. LGPD/seção 8: vai para a API só o texto digitado e os NOMES
// de clientes, responsáveis e tipos de peça da empresa (com ids); nenhum dado de job sai. Custo só quando usado (RD-42),
// dentro do teto de IA da empresa (aiGuardedCall).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'

type Nome = { id: string; nome: string }

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })

  let body: { companyId?: string; texto?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'bad json' }, { status: 400 }) }
  const companyId = body?.companyId
  const texto = String(body?.texto ?? '').trim().slice(0, 300)
  if (!companyId || !texto) return NextResponse.json({ ok: false, erro: 'companyId e texto obrigatórios' }, { status: 400 })

  // sessão do usuário: a RLS garante que só lê nomes da própria empresa
  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const [cli, eq, srv] = await Promise.all([
    sb.from('agency_clientes').select('id, nome, nome_fantasia').eq('company_id', companyId).limit(500),
    // Bloco 1 (CEO 02/10): responsáveis = usuários ativos da empresa (agency_equipe da Pdois não tem usuário ligado)
    sb.rpc('fn_usuarios_da_empresa', { p_company_id: companyId }),
    sb.from('agency_servico').select('id, nome').eq('company_id', companyId).limit(300),
  ])
  if (cli.error) return NextResponse.json({ ok: false, erro: 'sem acesso a esta empresa' }, { status: 403 })
  const clientes: Nome[] = ((cli.data ?? []) as { id: string; nome: string; nome_fantasia: string | null }[]).map((c) => ({ id: c.id, nome: c.nome_fantasia || c.nome }))
  const responsaveis: Nome[] = ((eq.data ?? []) as { id: string; full_name: string | null; email: string | null; is_active: boolean }[])
    .filter((u) => u.is_active).map((u) => ({ id: u.id, nome: u.full_name || u.email || 'usuário' }))
  const servicos: Nome[] = ((srv.data ?? []) as Nome[])
  if (!apiKey) return NextResponse.json({ ok: false, erro: 'IA não configurada' }, { status: 500 })

  const hoje = new Date().toISOString().slice(0, 10)
  const prompt = `Você traduz um pedido em português para FILTROS de uma lista de jobs de agência. Hoje é ${hoje}.
Use SOMENTE ids das listas abaixo. Se o pedido citar algo que não está nas listas, ignore. Não invente.
Clientes: ${JSON.stringify(clientes)}
Responsáveis: ${JSON.stringify(responsaveis)}
Tipos de peça: ${JSON.stringify(servicos)}
Atalhos possíveis: meus, atrasados, hoje, esperando_cliente, estourando_escopo, margem_negativa (no máximo um).
"aguardando_de" pode ter: cliente, planejamento, fornecedor, interno.
Datas no formato aaaa-mm-dd; "data_tipo" é prazo, criacao, entrega ou conclusao.
Pedido: ${JSON.stringify(texto)}
Responda SOMENTE com JSON (sem markdown) com as chaves que se aplicam: {"clientes":[ids],"responsaveis":[ids],"servicos":[ids],"titulo":string,"atalho":string,"aguardando_de":[...],"data_tipo":string,"data_de":string,"data_ate":string,"explicacao":string curta}`

  let guarded
  try {
    guarded = await aiGuardedCall<{ filtros: unknown; explicacao: string }>(sb, {
      origem: 'pm_pauta_filtro', custoEstimado: 0.005, companyId, feature: 'ia_pauta_filtro',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const bruto = JSON.parse(String(data?.content?.[0]?.text ?? '{}').replace(/```json|```/g, '').trim()) as Record<string, unknown>
        return { result: { filtros: bruto, explicacao: String(bruto.explicacao ?? '').slice(0, 200) }, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'Não consegui entender o pedido. Tente com outras palavras ou use o filtro.' }, { status: 502 })
  }
  if (guarded.desativado) return NextResponse.json({ ok: false, aviso: 'O filtro por frase está desativado para esta empresa.' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, aviso: 'Filtro por frase pausado hoje pelo limite de custo de IA. Use o filtro.' })

  // só passa o que aponta para ids que existem na empresa (a pessoa confere antes de aplicar)
  const filtros = validarFiltroIA(guarded.result.filtros, {
    clientes: new Set(clientes.map((c) => c.id)), responsaveis: new Set(responsaveis.map((p) => p.id)), servicos: new Set(servicos.map((s) => s.id)),
  })
  return NextResponse.json({ ok: true, filtros, explicacao: guarded.result.explicacao })
}
