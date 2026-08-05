import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Confirma que o chamador é admin ANTES de gastar token de LLM (Pilar 2 + RD-42). Usa o token do
// usuário e uma RPC admin-gated barata; se não for admin, a RPC devolve ok=false.
async function ehAdmin(req: NextRequest): Promise<boolean> {
  const auth = req.headers.get('authorization') || ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!auth.startsWith('Bearer ') || !url || !anon) return false
  try {
    const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
    const { data } = await sb.rpc('fn_ajuda_curadoria_fila', { p_limite: 1, p_incluir_gaps: false })
    return (data as { ok?: boolean } | null)?.ok === true
  } catch { return false }
}

// Central de Ajuda · F0 Fatia 4 — curadoria IA (batch OFFLINE, disparado pelo curador na tela, não por
// request de usuário final · RD-42). Transformador puro: recebe a fila (já vinda das RPCs admin-gated),
// reescreve com linguagem do operador + sinônimos, ANCORADO no material da tela. NUNCA inventa: onde
// falta info → [VERIFICAR] (RD-51/58). Não escreve no banco — a tela aplica via fn_ajuda_curar_aplicar.

type Contexto = {
  descricao_funcional?: string | null
  rpcs_chamadas?: unknown
  views_consumidas?: unknown
  componentes_principais?: unknown
}
type Item = { artigo_id: string; titulo?: string; rota?: string; area?: string; corpo_atual?: string | null; is_gap?: boolean; contexto?: Contexto | null }

const MODEL = 'claude-sonnet-4-20250514'
const MAX_LOTE = 25

function temMaterial(c?: Contexto | null): boolean {
  if (!c) return false
  const s = (c.descricao_funcional ?? '').toString().trim()
  const extra = JSON.stringify([c.rpcs_chamadas, c.views_consumidas, c.componentes_principais])
  return s.length > 0 || (extra !== '[null,null,null]' && extra.length > 12)
}

async function curarUm(item: Item, apiKey: string): Promise<{ artigo_id: string; corpo_novo: string; needs_human: boolean; erro?: string }> {
  const c = item.contexto ?? {}
  const material = [
    `TÍTULO DA TELA: ${item.titulo ?? '—'}`,
    `ROTA: ${item.rota ?? '—'} · ÁREA: ${item.area ?? '—'}`,
    `DESCRIÇÃO FUNCIONAL: ${(c.descricao_funcional ?? '').toString().trim() || '(vazia — sem material)'}`,
    c.rpcs_chamadas ? `RPCS: ${JSON.stringify(c.rpcs_chamadas).slice(0, 800)}` : '',
    c.views_consumidas ? `VIEWS: ${JSON.stringify(c.views_consumidas).slice(0, 400)}` : '',
    c.componentes_principais ? `COMPONENTES: ${JSON.stringify(c.componentes_principais).slice(0, 400)}` : '',
    item.corpo_atual ? `TEXTO ATUAL DO ARTIGO:\n${item.corpo_atual}` : '',
  ].filter(Boolean).join('\n')

  const system = `Você reescreve artigos de AJUDA de um ERP para o OPERADOR final (linguagem simples).
Baseie-se SÓ no material fornecido. Estruture: "O que é" / "Quando usar" / "Como usar" (passos curtos).
Inclua SINÔNIMOS que o usuário digitaria (ex.: nota fiscal / NF-e; boleto / cobrança; "como recebo").
REGRAS DURAS:
- NUNCA invente funcionalidade, botão ou campo que não esteja no material.
- Se faltar informação para afirmar algo, escreva [VERIFICAR] no lugar — não preencha com suposição.
- Se o material for insuficiente, faça um rascunho mínimo e conservador (só o que o nome/rota indicam) e use [VERIFICAR].
- Responda só o markdown do artigo, sem preâmbulo. Português. Máx 180 palavras.`

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages: [{ role: 'user', content: material }] }),
    })
    if (!resp.ok) return { artigo_id: item.artigo_id, corpo_novo: '', needs_human: true, erro: 'API ' + resp.status }
    const data = await resp.json()
    const corpo = (data.content?.map((x: { text?: string }) => x.text || '').join('') || '').trim()
    const needs_human = corpo.includes('[VERIFICAR]') || (!!item.is_gap && !temMaterial(c))
    return { artigo_id: item.artigo_id, corpo_novo: corpo, needs_human }
  } catch (e) {
    return { artigo_id: item.artigo_id, corpo_novo: '', needs_human: true, erro: e instanceof Error ? e.message : 'erro' }
  }
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })
  if (!(await ehAdmin(req))) return NextResponse.json({ error: 'Restrito à equipe PS (curadoria).' }, { status: 403 })
  let body: { itens?: Item[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const itens = Array.isArray(body?.itens) ? body.itens.slice(0, MAX_LOTE) : []
  if (!itens.length) return NextResponse.json({ error: 'nenhum item' }, { status: 400 })

  // sequencial (batch pequeno) pra não estourar rate limit; custo pontual e logável.
  const resultados: Array<{ artigo_id: string; corpo_novo: string; needs_human: boolean; erro?: string }> = []
  for (const it of itens) resultados.push(await curarUm(it, apiKey))
  return NextResponse.json({ ok: true, resultados })
}
