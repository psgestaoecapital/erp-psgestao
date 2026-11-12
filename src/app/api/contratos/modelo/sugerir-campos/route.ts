import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { chamarClaude, IABloqueadaError } from '@/lib/aiModel'

// Chamado #5452 (Pdois/P&M) · Modelos de contrato — F1 (fatia): "Sugerir campos com IA".
// ASSISTIVO, NÃO grava nada: recebe o TEXTO que a pessoa escreveu/colou no editor de modelo e
// devolve uma sugestão de onde entram os campos variáveis ({{chave}}), usando SOMENTE as chaves
// válidas (fn_contrato_modelo_variaveis). A pessoa confere e aplica na tela; salvar continua sendo
// o fn_contrato_modelo_salvar (autoria por auth.uid()). Fallback manual (RD-102): se a IA estiver
// indisponível/bloqueada por orçamento, a tela avisa e os botões de inserir campo seguem valendo.
// Custo: passa pelo porteiro único de orçamento (assertIAPermitida dentro de chamarClaude) — gasto
// bloqueado por segurança = resposta honesta, nunca erro cru.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_TEXTO = 24000 // limita o tamanho enviado ao modelo (controle de custo)

type Campo = { chave: string; rotulo: string }

function extrairJson(txt: string): any | null {
  if (!txt) return null
  // tira cercas de markdown e pega o primeiro bloco { ... }
  const limpo = txt.replace(/```json/gi, '').replace(/```/g, '').trim()
  const ini = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (ini < 0 || fim <= ini) return null
  try { return JSON.parse(limpo.slice(ini, fim + 1)) } catch { return null }
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) {
    return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })
  }

  let body: { companyId?: string; texto?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'requisição inválida' }, { status: 400 }) }
  const companyId = (body?.companyId || '').trim() || null
  const texto = (body?.texto || '').trim()
  if (!companyId) return NextResponse.json({ ok: false, erro: 'Selecione a empresa antes de sugerir os campos.' }, { status: 400 })
  if (texto.length < 20) return NextResponse.json({ ok: false, erro: 'Escreva ou cole o texto do modelo antes de pedir a sugestão.' }, { status: 400 })

  // sessão do usuário → RLS/guarda de empresa nas RPCs SECURITY DEFINER
  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // chaves válidas (mesma fonte da tela) — a IA só pode usar estas
  const { data: vars, error: errVars } = await sb.rpc('fn_contrato_modelo_variaveis')
  if (errVars) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })
  const campos = (Array.isArray(vars) ? vars : []) as Campo[]
  const chavesValidas = new Set(campos.map((c) => c.chave))
  const listaChaves = campos.map((c) => `- {{${c.chave}}}: ${c.rotulo}`).join('\n')

  const prompt = `Você ajuda a montar um MODELO de contrato reutilizável. Recebe o TEXTO de um contrato e deve marcar, no próprio texto, onde entram os CAMPOS VARIÁVEIS (os dados que mudam a cada contrato), trocando o dado concreto pelo marcador {{chave}}.

Regras:
- Use SOMENTE estas chaves (não invente outras; se um dado não casar com nenhuma, deixe o texto como está):
${listaChaves}
- Troque apenas DADOS que variam por contrato (nome/CNPJ/endereço do cliente, valores, datas, número de parcelas, periodicidade). NÃO mexa em cláusulas, texto fixo, pontuação ou formatação.
- Preserve todo o restante do texto EXATAMENTE como veio.
- Não invente dados nem acrescente campos que não aparecem no texto.

Responda SOMENTE com JSON válido (sem markdown), no formato:
{"texto_sugerido": "<o texto com os {{marcadores}} inseridos>", "campos": [{"chave":"<chave usada>","trecho":"<o dado original que virou marcador>"}]}

TEXTO DO CONTRATO:
"""
${texto.slice(0, MAX_TEXTO)}
"""`

  let resp: any
  try {
    resp = await chamarClaude({
      finalidade: 'geral',
      endpoint: '/api/contratos/modelo/sugerir-campos',
      companyId,
      timeoutMs: 45000,
      payload: { max_tokens: 4096, messages: [{ role: 'user', content: prompt }] },
    })
  } catch (err: any) {
    if (err instanceof IABloqueadaError) {
      return NextResponse.json({ ok: false, bloqueada: true, erro: err.motivo || 'Sugestão por IA indisponível no momento. Marque os campos manualmente pelos botões de campos variáveis.' }, { status: 503 })
    }
    return NextResponse.json({ ok: false, erro: 'Não consegui gerar a sugestão agora. Marque os campos manualmente pelos botões de campos variáveis.' }, { status: 502 })
  }

  const txt = Array.isArray(resp?.content) ? resp.content.map((b: any) => (b?.type === 'text' ? b.text : '')).join('') : ''
  const parsed = extrairJson(txt)
  const textoSugerido = typeof parsed?.texto_sugerido === 'string' && parsed.texto_sugerido.trim() ? parsed.texto_sugerido : null
  if (!textoSugerido) {
    return NextResponse.json({ ok: false, erro: 'A sugestão não veio em um formato que eu pudesse ler. Marque os campos manualmente pelos botões de campos variáveis.' }, { status: 502 })
  }

  // só devolve campos cuja chave é válida (defesa contra chave inventada)
  const camposUsados = (Array.isArray(parsed?.campos) ? parsed.campos : [])
    .filter((c: any) => c && typeof c.chave === 'string' && chavesValidas.has(c.chave))
    .map((c: any) => {
      const rotulo = campos.find((v) => v.chave === c.chave)?.rotulo || c.chave
      return { chave: c.chave as string, rotulo, trecho: typeof c.trecho === 'string' ? c.trecho.slice(0, 200) : '' }
    })

  return NextResponse.json({ ok: true, texto_sugerido: textoSugerido, campos: camposUsados })
}
