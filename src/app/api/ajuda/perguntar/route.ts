import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

// Central de Ajuda · F0.2 — resposta conversacional grounded (RAG). Fluxo (RD-51/58 + RD-42):
// 1) RETRIEVE: fn_ajuda_rag_contexto → top-K artigos (já filtrados por papel/tenant — Pilar 2). Vazio → escala
//    (NÃO chama o LLM). 2) AUGMENT: monta o contexto SÓ com esses artigos. 3) CACHE: hit devolve cacheado
//    (custo zero). 4) GENERATE: Claude econômico (Haiku) responde ancorado só nos artigos, citando a tela.
//    Telemetria de custo em toda resposta (hit, miss ou escala). LLM só sob demanda (este endpoint), nunca
//    no debounce da busca (tier-1 FTS segue grátis).

const MODEL = 'claude-haiku-4-5'                 // RD-42: modelo econômico p/ tier-1 (ajuda não precisa do topo)
const PRECO_IN = 1.0 / 1_000_000                 // US$/token (Haiku 4.5: $1/Mtok in)
const PRECO_OUT = 5.0 / 1_000_000                // US$/token (Haiku 4.5: $5/Mtok out)
const K = 5
const ESCALA = 'Não encontrei isso na ajuda — quer falar com o suporte?'

type Fonte = { artigo_id: string; titulo: string; rota_ref: string | null }
type Artigo = { artigo_id: string; titulo: string; resumo: string | null; corpo_md: string | null; rota_ref: string | null; vertical: string | null }

// LGPD: não cacheia pergunta com dado pessoal identificável (CPF/CNPJ/e-mail/telefone).
const TEM_DADO_SENSIVEL = (t: string) =>
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/.test(t) ||                 // CPF
  /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/.test(t) ||         // CNPJ
  /[\w.+-]+@[\w-]+\.[\w.-]+/.test(t) ||                          // e-mail
  /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/.test(t)                         // telefone

// hash da pergunta normalizada (sem acento-fold agressivo; só caixa/espaços/pontuação de borda) — LGPD.
const hashPergunta = (t: string) =>
  createHash('md5').update(t.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[?!.]+$/, '')).digest('hex')

export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { company_id?: string | null; pergunta?: string; rota_atual?: string | null; papel?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const pergunta = (body?.pergunta ?? '').trim()
  const companyId = body?.company_id ?? null
  const rota = body?.rota_atual ?? null
  const papel = Number.isFinite(body?.papel) ? Number(body?.papel) : 1
  if (pergunta.length < 2) return NextResponse.json({ error: 'pergunta muito curta' }, { status: 400 })

  // client com o JWT do usuário → as RPCs (SECURITY DEFINER) resolvem tenant/papel por auth.uid() (Pilar 2).
  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const sensivel = TEM_DADO_SENSIVEL(pergunta)
  const hash = hashPergunta(pergunta)

  // ── 1. RETRIEVE grounded ────────────────────────────────────────────────────────────────────
  const { data: ctxData } = await sb.rpc('fn_ajuda_rag_contexto', {
    p_company_id: companyId, p_termo: pergunta, p_rota_atual: rota, p_papel: papel, p_k: K,
  })
  const ctx = ctxData as { ok?: boolean; erro?: string; resultados?: Artigo[] } | null
  if (ctx?.ok === false) return NextResponse.json({ error: ctx.erro ?? 'sem acesso' }, { status: 403 })
  const artigos = ctx?.resultados ?? []
  const fontes: Fonte[] = artigos.map((a) => ({ artigo_id: a.artigo_id, titulo: a.titulo, rota_ref: a.rota_ref }))

  // Sem cobertura → escala (RD-51: não inventa; não chama o LLM). Telemetria com escalou=true.
  if (artigos.length === 0) {
    void sb.rpc('fn_ajuda_llm_registrar', {
      p_company_id: companyId, p_pergunta: pergunta, p_cache_hit: false, p_escalou: true,
      p_modelo: null, p_tokens_in: null, p_tokens_out: null, p_custo: null, p_artigos_ref: null, p_rota: rota, p_papel: papel,
    })
    return NextResponse.json({ ok: true, resposta: ESCALA, fontes: [], escalar: true, cache: false })
  }

  // ── 2. CACHE (RD-42) — hit devolve cacheado, custo zero. Pula cache se pergunta tem dado sensível (LGPD).
  if (!sensivel) {
    const { data: cData } = await sb.rpc('fn_ajuda_cache_obter', { p_company_id: companyId, p_hash: hash, p_papel: papel })
    const c = cData as { hit?: boolean; resposta?: string; artigos_ref?: Fonte[] } | null
    if (c?.hit) {
      void sb.rpc('fn_ajuda_llm_registrar', {
        p_company_id: companyId, p_pergunta: pergunta, p_cache_hit: true, p_escalou: false,
        p_modelo: MODEL, p_tokens_in: null, p_tokens_out: null, p_custo: 0, p_artigos_ref: c.artigos_ref ?? fontes, p_rota: rota, p_papel: papel,
      })
      return NextResponse.json({ ok: true, resposta: c.resposta, fontes: c.artigos_ref ?? fontes, escalar: false, cache: true })
    }
  }

  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

  // ── 3. AUGMENT — contexto SÓ com os artigos recuperados (grounding rígido) ─────────────────────
  const contexto = artigos.map((a, i) => [
    `--- ARTIGO ${i + 1} ---`,
    `Título: ${a.titulo}`,
    a.rota_ref ? `Tela (rota): ${a.rota_ref}` : '',
    `Conteúdo:\n${(a.corpo_md ?? a.resumo ?? '').trim() || '(sem detalhes)'}`,
  ].filter(Boolean).join('\n')).join('\n\n')

  const system = `Você é o assistente da Central de Ajuda de um ERP. Responda à pergunta do usuário USANDO SOMENTE o conteúdo dos artigos fornecidos abaixo.
REGRAS DURAS (RD-51/58):
- Se os artigos NÃO contêm a resposta, responda exatamente: "${ESCALA}"
- NUNCA invente passos, campos, botões, telas ou dados que não estejam nos artigos.
- Cite a tela relevante pelo título quando fizer sentido.
- Seja curto, direto e em linguagem do operador (português). Sem preâmbulo.

ARTIGOS:
${contexto}`

  // ── 4. GENERATE (Claude econômico) ────────────────────────────────────────────────────────────
  let resposta = ''
  let tin: number | null = null
  let tout: number | null = null
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system, messages: [{ role: 'user', content: pergunta }] }),
    })
    if (!resp.ok) return NextResponse.json({ error: 'Falha ao gerar resposta (API ' + resp.status + ')' }, { status: 502 })
    const data = await resp.json()
    resposta = (data.content?.map((x: { text?: string }) => x.text || '').join('') || '').trim()
    tin = data.usage?.input_tokens ?? null
    tout = data.usage?.output_tokens ?? null
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'erro' }, { status: 502 })
  }
  if (!resposta) resposta = ESCALA
  const escalou = resposta.startsWith(ESCALA)
  const custo = tin != null && tout != null ? Number((tin * PRECO_IN + tout * PRECO_OUT).toFixed(6)) : null

  // grava cache (só se respondeu de fato e sem dado sensível — LGPD)
  if (!sensivel && !escalou) {
    void sb.rpc('fn_ajuda_cache_gravar', {
      p_company_id: companyId, p_hash: hash, p_papel: papel, p_resposta: resposta,
      p_artigos_ref: fontes, p_modelo: MODEL,
    })
  }
  // telemetria de custo (RD-42)
  void sb.rpc('fn_ajuda_llm_registrar', {
    p_company_id: companyId, p_pergunta: pergunta, p_cache_hit: false, p_escalou: escalou,
    p_modelo: MODEL, p_tokens_in: tin, p_tokens_out: tout, p_custo: custo, p_artigos_ref: fontes, p_rota: rota, p_papel: papel,
  })

  return NextResponse.json({ ok: true, resposta, fontes: escalou ? [] : fontes, escalar: escalou, cache: false })
}
