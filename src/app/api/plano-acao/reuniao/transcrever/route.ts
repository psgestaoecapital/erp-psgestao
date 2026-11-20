import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'

// Transcrição de um segmento de áudio da reunião (IA). O navegador subiu o áudio para o Storage privado e registrou o
// segmento; aqui baixamos, transcrevemos (Google Gemini), gravamos os trechos, APAGAMOS o áudio e somamos o custo.
// Custo guardado pelo porteiro global + teto por empresa (aiGuardedCall, feature 'reuniao_ia').
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Modelo de transcrição. 'gemini-2.5-flash' (generateContent com áudio) é o caminho confiável/documentado; se a chave
// tiver acesso a um modelo de transcrição dedicado, troque aqui. O prompt pede 1 linha por fala no formato [mm:ss].
const MODELO_TRANSCRICAO = process.env.GEMINI_TRANSCRICAO_MODEL || 'gemini-2.5-flash'
const USD_POR_MINUTO = 0.005

type Trecho = { inicio_seg: number; fim_seg: number | null; falante: string; texto: string }

// "[mm:ss] Falante N: texto" (uma por linha) → trechos, somando o offset do segmento.
function parsearTranscricao(texto: string, offsetSeg: number): Trecho[] {
  const out: Trecho[] = []
  for (const linhaRaw of texto.split(/\r?\n/)) {
    const linha = linhaRaw.trim()
    if (!linha) continue
    const m = linha.match(/^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*([^:]{1,40}?)\s*:\s*(.+)$/)
    if (m) {
      const h = m[3] !== undefined ? Number(m[1]) : 0
      const mm = m[3] !== undefined ? Number(m[2]) : Number(m[1])
      const ss = m[3] !== undefined ? Number(m[3]) : Number(m[2])
      out.push({ inicio_seg: offsetSeg + h * 3600 + mm * 60 + ss, fim_seg: null, falante: m[4].trim().slice(0, 40), texto: m[5].trim() })
    } else {
      // linha sem carimbo: anexa ao último trecho ou cria um sem falante
      if (out.length) out[out.length - 1].texto += ' ' + linha
      else out.push({ inicio_seg: offsetSeg, fim_seg: null, falante: 'Voz 1', texto: linha })
    }
  }
  for (let i = 0; i < out.length - 1; i++) out[i].fim_seg = out[i + 1].inicio_seg
  return out
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const googleKey = process.env.GOOGLE_AI_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { reuniao_id?: string; segmento_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const reuniaoId = body?.reuniao_id
  const segmentoId = body?.segmento_id
  if (!reuniaoId || !segmentoId) return NextResponse.json({ error: 'reuniao_id e segmento_id obrigatórios' }, { status: 400 })
  if (!googleKey) return NextResponse.json({ ok: false, aviso: 'A transcrição automática não está configurada. Avise o suporte.' })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // segmento + empresa (RLS garante acesso)
  const { data: seg, error: segErr } = await sb
    .from('erp_plano_acao_reuniao_segmento')
    .select('storage_path, mime, duracao_seg, inicio_offset_seg, company_id, reuniao_id, status')
    .eq('id', segmentoId).single()
  if (segErr || !seg) return NextResponse.json({ error: 'segmento não encontrado' }, { status: 404 })
  if (seg.status === 'transcrito') return NextResponse.json({ ok: true, ja: true })
  if (!seg.storage_path) return NextResponse.json({ error: 'segmento sem áudio' }, { status: 400 })
  const companyId = seg.company_id as string
  const offset = Number(seg.inicio_offset_seg ?? 0)
  const minutos = Math.max(Number(seg.duracao_seg ?? 0) / 60, 0)

  await sb.rpc('fn_reuniao_ia_segmento_status', { p_segmento_id: segmentoId, p_status: 'transcrevendo', p_erro: null, p_apagado: false })

  // baixa o áudio
  const { data: blob, error: dlErr } = await sb.storage.from('reuniao-audio').download(seg.storage_path as string)
  if (dlErr || !blob) {
    await sb.rpc('fn_reuniao_ia_segmento_status', { p_segmento_id: segmentoId, p_status: 'erro', p_erro: 'falha ao baixar o áudio', p_apagado: false })
    return NextResponse.json({ ok: false, aviso: 'Não consegui ler o áudio deste trecho. Tente de novo.' })
  }
  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
  const mime = (seg.mime as string) || 'audio/webm'

  const sys = 'Você transcreve áudio de reuniões em português do Brasil. Transcreva LITERALMENTE o que foi dito, sem resumir e sem inventar. Uma linha por fala, no formato "[mm:ss] Voz N: texto", separando falantes diferentes como Voz 1, Voz 2 etc. Não adicione comentários seus.'

  let guarded
  try {
    guarded = await aiGuardedCall<string>(sb, {
      origem: 'reuniao_transcricao', custoEstimado: minutos * USD_POR_MINUTO, companyId, feature: 'reuniao_ia',
      run: async () => {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_TRANSCRICAO}:generateContent?key=${googleKey}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: sys }] },
            contents: [{ parts: [{ text: 'Transcreva este áudio.' }, { inlineData: { mimeType: mime, data: base64 } }] }],
            generationConfig: { maxOutputTokens: 8192, temperature: 0 },
          }),
          signal: AbortSignal.timeout(280000),
        })
        if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error(`Gemini ${res.status}: ${e.slice(0, 200)}`) }
        const data = await res.json()
        const txt: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p?.text || '').join('') ?? ''
        return { result: txt, custoReal: minutos * USD_POR_MINUTO }
      },
    })
  } catch {
    await sb.rpc('fn_reuniao_ia_segmento_status', { p_segmento_id: segmentoId, p_status: 'erro', p_erro: 'falha na transcrição', p_apagado: false })
    return NextResponse.json({ ok: false, aviso: 'A transcrição automática falhou neste trecho. Toque em "Tentar de novo".' })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: guarded.motivo || 'A IA está desativada para esta empresa.' })
  if (guarded.pausado) return NextResponse.json({ ok: false, budget_pausado: true, aviso: guarded.motivo || 'O limite de IA do dia foi atingido. Tente mais tarde.' })

  const trechos = parsearTranscricao(guarded.result || '', offset)
  if (trechos.length === 0) {
    await sb.rpc('fn_reuniao_ia_segmento_status', { p_segmento_id: segmentoId, p_status: 'erro', p_erro: 'transcrição vazia', p_apagado: false })
    return NextResponse.json({ ok: false, aviso: 'Não consegui entender a fala neste trecho (áudio baixo?). Tente de novo.' })
  }

  await sb.rpc('fn_reuniao_ia_trechos_gravar', { p_segmento_id: segmentoId, p_trechos: trechos })
  await sb.rpc('fn_reuniao_ia_custo_somar', { p_reuniao_id: reuniaoId, p_usd: minutos * USD_POR_MINUTO, p_min: minutos })
  // apaga o áudio do storage (fica só o texto) e marca o segmento
  await sb.storage.from('reuniao-audio').remove([seg.storage_path as string])
  await sb.rpc('fn_reuniao_ia_segmento_status', { p_segmento_id: segmentoId, p_status: 'transcrito', p_erro: null, p_apagado: true })

  return NextResponse.json({ ok: true, trechos: trechos.length })
}
