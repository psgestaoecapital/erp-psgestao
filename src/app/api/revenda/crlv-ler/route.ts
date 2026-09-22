import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// R7b-2 (parte b) · Leitura ASSISTIDA do CRLV por IA (visão). ASSISTIVA, NÃO grava: a IA sugere os campos
// (placa/Renavam/chassi/marca/modelo/ano/cor/combustível) com um nível de confiança; a pessoa confere e
// confirma na tela (o salvar continua sendo o fn_veic_atualizar_dados — autoria por auth.uid()).
// LGPD: a imagem vai ao modelo só no processamento; NÃO persistimos o documento nem o prompt em log.
// Padrão reaproveitado do odonto/raiox-analise: aiGuardedCall (teto de custo global da PS) + signed URL
// curta → base64. Bucket privado revenda-veiculos.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const MODELO = 'claude-haiku-4-5'   // visão-capaz e econômico; custo real vem do usage
const BUCKET = 'revenda-veiculos'

type Sugestao = {
  placa: string | null; renavam: string | null; chassi: string | null
  marca: string | null; modelo: string | null; cor: string | null
  ano_fabricacao: number | null; ano_modelo: number | null; combustivel: string | null
  confianca: string; observacao: string
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ ok: false, erro: 'não autenticado' }, { status: 401 })

  let body: { companyId?: string; veiculoId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, erro: 'bad json' }, { status: 400 }) }
  const companyId = body?.companyId
  const veiculoId = body?.veiculoId
  if (!companyId || !veiculoId) return NextResponse.json({ ok: false, erro: 'companyId e veiculoId obrigatórios' }, { status: 400 })

  // sessão do usuário → RLS por empresa garante que só lê veículo da própria empresa
  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: veic } = await sb.from('veic_veiculo')
    .select('crlv_storage_path').eq('id', veiculoId).eq('company_id', companyId).is('deleted_at', null).maybeSingle()
  const crlvPath = (veic as { crlv_storage_path: string | null } | null)?.crlv_storage_path ?? null
  if (!crlvPath) return NextResponse.json({ ok: false, erro: 'Este veículo não tem CRLV anexado. Anexe o documento na ficha primeiro.' }, { status: 404 })
  if (!apiKey) return NextResponse.json({ ok: false, erro: 'ANTHROPIC_API_KEY não configurada' }, { status: 500 })

  // baixa o documento (signed URL curta) → base64; nunca expõe o arquivo ao modelo por URL
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(crlvPath, 120)
  const signedUrl = signed?.signedUrl
  if (!signedUrl) return NextResponse.json({ ok: false, erro: 'não foi possível abrir o CRLV' }, { status: 502 })
  const ehPdf = crlvPath.toLowerCase().endsWith('.pdf')
  let b64 = '', mediaType = ehPdf ? 'application/pdf' : 'image/jpeg'
  try {
    const r = await fetch(signedUrl)
    if (!r.ok) throw new Error('download')
    mediaType = r.headers.get('content-type') || mediaType
    b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
  } catch { return NextResponse.json({ ok: false, erro: 'falha ao carregar o CRLV' }, { status: 502 }) }

  const prompt = `Você ajuda a CADASTRAR um veículo lendo o CRLV (Certificado de Registro e Licenciamento de Veículo) do Brasil. Extraia SOMENTE o que o documento mostra — NUNCA invente. Campo ilegível/ausente → null. Não é laudo; a pessoa confere antes de salvar.
Devolva os campos: "placa" (7 caracteres, sem máscara), "renavam" (só dígitos), "chassi" (17 caracteres), "marca", "modelo", "cor", "ano_fabricacao" (aaaa) e "ano_modelo" (aaaa) como números, "combustivel" (um de: gasolina|etanol|flex|diesel|gnv|elétrico|híbrido, ou null), "confianca" (baixa|media|alta) da leitura como um todo, e "observacao" curta (ex.: "documento borrado no campo do chassi").
Responda SOMENTE com JSON válido (sem markdown): {"placa":string|null,"renavam":string|null,"chassi":string|null,"marca":string|null,"modelo":string|null,"cor":string|null,"ano_fabricacao":number|null,"ano_modelo":number|null,"combustivel":string|null,"confianca":string,"observacao":string}`

  const bloco = ehPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } }

  let guarded
  try {
    guarded = await aiGuardedCall<Sugestao>(sb, {
      origem: 'revenda_crlv', custoEstimado: 0.02, companyId, feature: 'ia_crlv',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: MODELO, max_tokens: 700, messages: [{ role: 'user', content: [bloco, { type: 'text', text: prompt }] }] }),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 1 + (u.output_tokens ?? 0) * 5) / 1_000_000
        const p = JSON.parse(texto.replace(/```json|```/g, '').trim()) as Record<string, unknown>
        const COMB = ['gasolina', 'etanol', 'flex', 'diesel', 'gnv', 'elétrico', 'híbrido']
        const CONF = ['baixa', 'media', 'alta']
        const ano = (x: unknown) => { const n = parseInt(String(x ?? '').replace(/\D/g, ''), 10); return n >= 1900 && n <= 2100 ? n : null }
        const txt = (x: unknown, max: number) => { const s = String(x ?? '').trim(); return s ? s.slice(0, max) : null }
        const result: Sugestao = {
          placa: txt(p.placa, 8)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
          renavam: (String(p.renavam ?? '').replace(/\D/g, '') || null),
          chassi: txt(p.chassi, 20)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null,
          marca: txt(p.marca, 40), modelo: txt(p.modelo, 60), cor: txt(p.cor, 30),
          ano_fabricacao: ano(p.ano_fabricacao), ano_modelo: ano(p.ano_modelo),
          combustivel: COMB.includes(String(p.combustivel)) ? String(p.combustivel) : null,
          confianca: CONF.includes(String(p.confianca)) ? String(p.confianca) : 'baixa',
          observacao: txt(p.observacao, 300) ?? '',
        }
        return { result, custoReal }
      },
    })
  } catch {
    return NextResponse.json({ ok: false, erro: 'falha ao ler o CRLV' }, { status: 502 })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: 'Leitura de CRLV por IA está desativada para esta empresa.' })
  if (guarded.pausado || !guarded.result) return NextResponse.json({ ok: false, budget_pausado: true, aviso: 'Leitura por IA pausada hoje por limite de custo. Preencha os campos manualmente.' })

  // NÃO grava — devolve sugestões pra pessoa conferir e confirmar na tela.
  return NextResponse.json({ ok: true, sugestao: guarded.result })
}
