// Importar tabela de preço do cliente (PDF, imagem ou texto de planilha) com IA · Claude.
// Recebe { texto?, arquivo_base64?, media_type? }. Não grava nada: devolve { ok, texto } no formato
// "código;nome;unidade;de;até;preço" que a tela mostra na revisão lado a lado antes de gravar.
// Exige usuário logado (verify_jwt) — a gravação continua pela RPC com guarda da tela.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const JSON_HEADERS = { ...corsHeaders, 'Content-Type': 'application/json' }
const MAX_BASE64 = 12_000_000

// P0 CUSTO (CEO 01/11): bloqueio global de IA paga (anthropic_budget_control, singleton id=1).
// Inline (função MCP-deployable, sem import relativo a _shared). Fail-closed por segurança de custo.
async function iaBloqueadaGlobal(): Promise<{ bloqueado: boolean; motivo: string }> {
  try {
    const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) return { bloqueado: true, motivo: 'Controle de orçamento de IA indisponível; IA bloqueada por segurança de custo.' }
    const sb = createClient(url, key)
    const { data, error } = await sb.from('anthropic_budget_control')
      .select('pausado,motivo_pausa,limite_max_custo_usd_dia,limite_max_custo_usd_mes,custo_usd_hoje,custo_usd_mes_atual')
      .eq('id', 1).maybeSingle()
    if (error || !data) return { bloqueado: true, motivo: 'Controle de orçamento de IA indisponível; IA bloqueada por segurança de custo.' }
    if (data.pausado) return { bloqueado: true, motivo: data.motivo_pausa || 'Gasto de IA pausado pelo controle de orçamento.' }
    const limDia = Number(data.limite_max_custo_usd_dia); const limMes = Number(data.limite_max_custo_usd_mes)
    if (limDia > 0 && Number(data.custo_usd_hoje) >= limDia) return { bloqueado: true, motivo: 'Limite diário de custo de IA atingido.' }
    if (limMes > 0 && Number(data.custo_usd_mes_atual) >= limMes) return { bloqueado: true, motivo: 'Limite mensal de custo de IA atingido.' }
    return { bloqueado: false, motivo: '' }
  } catch { return { bloqueado: true, motivo: 'Falha ao consultar o controle de orçamento de IA; IA bloqueada por segurança de custo.' } }
}

const PROMPT = `Voce le a tabela de precos que um cliente enviou (servicos, unidade, faixas de quantidade e preco).
Converta para linhas, UMA FAIXA POR LINHA, colunas separadas por ";" nesta ordem:
codigo;nome;unidade;de;ate;preco
- codigo: o codigo do item no sistema do cliente (se nao houver, um apelido curto do servico).
- de/ate: faixa de quantidade; "ate" vazio quando a faixa for "em diante". Sem faixas: de=0 e ate vazio.
- preco: numero com virgula decimal (ex.: 98,00), sem simbolo de moeda.
- Nao invente linhas nem valores. Ignore totais, cabecalhos e observacoes.
Responda APENAS as linhas, sem cabecalho e sem texto fora delas.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { texto, arquivo_base64, media_type } = await req.json() as { texto?: string; arquivo_base64?: string; media_type?: string }
    if (!texto?.trim() && !arquivo_base64) {
      return new Response(JSON.stringify({ ok: false, erro: 'Envie o arquivo ou o texto da planilha.' }), { status: 400, headers: JSON_HEADERS })
    }
    if (arquivo_base64 && arquivo_base64.length > MAX_BASE64) {
      return new Response(JSON.stringify({ ok: false, erro: 'Arquivo grande demais (máx. ~9 MB).' }), { status: 413, headers: JSON_HEADERS })
    }
    const content: unknown[] = []
    if (arquivo_base64) {
      const mt = media_type ?? 'application/pdf'
      content.push(mt === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: mt, data: arquivo_base64 } }
        : { type: 'image', source: { type: 'base64', media_type: mt, data: arquivo_base64 } })
    }
    if (texto?.trim()) content.push({ type: 'text', text: `Conteudo da planilha:\n${texto.slice(0, 60000)}` })
    content.push({ type: 'text', text: PROMPT })

    // P0 CUSTO (CEO 01/11): porteiro do bloqueio global antes da chamada paga.
    const _b = await iaBloqueadaGlobal()
    if (_b.bloqueado) return new Response(JSON.stringify({ ok: false, erro: _b.motivo, ia_bloqueada: true }), { status: 503, headers: JSON_HEADERS })

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: Deno.env.get('ANTHROPIC_VISION_MODEL') ?? 'claude-sonnet-4-6', max_tokens: 8000, messages: [{ role: 'user', content }] }),
    })
    const data = await resp.json()
    if (!resp.ok) return new Response(JSON.stringify({ ok: false, erro: `IA indisponível (${resp.status}). Cole as linhas na caixa ao lado.` }), { status: 502, headers: JSON_HEADERS })
    const out = (data.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('\n')
      .replace(/```[a-z]*/g, '').trim()
    return new Response(JSON.stringify({ ok: true, texto: out }), { headers: JSON_HEADERS })
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, erro: String(e) }), { status: 500, headers: JSON_HEADERS })
  }
})
