import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { aiGuardedCall } from '@/lib/ai/aiGuardedCall'
import { modeloPara } from '@/lib/aiModel'

// Extração da ATA + ações 5W2H a partir da transcrição JÁ feita da reunião. A IA PROPÕE (resumo, decisões,
// pendências e ações sugeridas); quem CONFIRMA cada ação é o humano, na tela (fn_reuniao_ia_proposta_confirmar).
// Anti-alucinação (RD-51): usa SOMENTE o que foi dito. Metering por empresa (feature 'reuniao_ia') + budget global.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const PRIORIDADES = new Set(['alta', 'media', 'baixa'])
const CONF = new Set(['alta', 'media', 'baixa'])

type AcaoIA = {
  o_que: string; por_que: string; quem: string; onde: string
  quando: string | null; como: string; quanto: string
  prioridade: string; confianca: string; evidencia: string; minuto: string
}

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  const auth = req.headers.get('authorization') || ''
  if (!url || !anon || !auth.startsWith('Bearer ')) return NextResponse.json({ error: 'não autenticado' }, { status: 401 })

  let body: { reuniao_id?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }
  const reuniaoId = body?.reuniao_id
  if (!reuniaoId) return NextResponse.json({ error: 'reuniao_id obrigatório' }, { status: 400 })
  if (!apiKey) return NextResponse.json({ ok: false, aviso: 'A geração automática da ata não está configurada. Avise o suporte.' })

  const sb = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  // monta a transcrição a partir dos trechos (RLS garante acesso à reunião)
  const { data: dados, error: errDados } = await sb.rpc('fn_reuniao_ia_obter', { p_reuniao_id: reuniaoId })
  if (errDados) return NextResponse.json({ error: 'reunião não encontrada' }, { status: 404 })
  const reuniao = (dados as { reuniao?: { company_id?: string; titulo?: string } })?.reuniao
  const trechos = ((dados as { trechos?: Array<{ inicio_seg?: number; falante?: string; texto?: string }> })?.trechos) || []
  const companyId = reuniao?.company_id
  if (!companyId) return NextResponse.json({ error: 'reunião sem empresa' }, { status: 400 })
  if (trechos.length === 0) return NextResponse.json({ ok: false, aviso: 'Ainda não há transcrição para gerar a ata. Transcreva a gravação primeiro.' })

  const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const transcricao = trechos
    .map((t) => `[${mmss(Number(t.inicio_seg ?? 0))}] ${(t.falante || 'Voz').toString()}: ${(t.texto || '').toString()}`)
    .join('\n')
    .slice(0, 60000)

  const system = `Você lê a transcrição de uma reunião (português do Brasil) e produz: (1) uma ATA breve e (2) uma lista de AÇÕES no formato 5W2H para um Plano de Ação industrial.
REGRAS (obrigatórias):
- Use SOMENTE o que foi dito na transcrição. NÃO invente responsáveis, prazos, valores, números ou decisões. Se algo não foi dito, deixe o campo vazio ("") e baixe a confiança.
- Cada ação sai de um compromisso/tarefa/decisão REAL da reunião. Se a reunião não gerou ações, devolva "acoes": [].
- Campos de cada ação (strings): "o_que" (a tarefa, verbo no infinitivo), "por_que" (motivo/objetivo dito), "quem" (nome da pessoa citada como responsável, ou ""), "onde" (local/setor/área, ou ""), "quando" (prazo — devolva como data ISO AAAA-MM-DD só se uma data clara foi dita; senão null), "como" (como fazer, se dito), "quanto" (custo/quantidade, se dito), "prioridade" (um de: "alta","media","baixa"), "confianca" (quão explícito foi na reunião: "alta","media","baixa"), "evidencia" (a frase curta da reunião que originou a ação), "minuto" (o carimbo [mm:ss] do trecho de origem).
- "resumo": 3 a 6 linhas do que foi tratado. "decisoes": array de strings (decisões fechadas). "pendencias": array de strings (o que ficou em aberto, sem dono/prazo).
- NÃO copie layout, nomes ou fluxo de nenhum outro produto.
Responda SOMENTE com um JSON válido (sem markdown) com as chaves: "resumo" (string), "decisoes" (array de strings), "pendencias" (array de strings), "acoes" (array de objetos com os campos acima).`

  let guarded
  try {
    guarded = await aiGuardedCall<{ resumo: string; decisoes: string[]; pendencias: string[]; acoes: AcaoIA[] }>(sb, {
      origem: 'reuniao_extracao', custoEstimado: 0.02, companyId, feature: 'reuniao_ia',
      run: async () => {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: modeloPara('industrial'), max_tokens: 4096, system,
            messages: [{ role: 'user', content: `Transcrição da reunião${reuniao?.titulo ? ` "${reuniao.titulo}"` : ''}:\n\n${transcricao}` }],
          }),
          signal: AbortSignal.timeout(110000),
        })
        if (!res.ok) throw new Error(`Claude ${res.status}`)
        const data = await res.json()
        const texto: string = data?.content?.[0]?.text ?? ''
        const u = data?.usage ?? {}
        const custoReal = ((u.input_tokens ?? 0) * 3 + (u.output_tokens ?? 0) * 15) / 1_000_000
        const parsed = JSON.parse(texto.replace(/```json|```/g, '').trim()) as {
          resumo?: unknown; decisoes?: unknown; pendencias?: unknown; acoes?: unknown
        }
        const arrStr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 50) : [])
        const acoes: AcaoIA[] = Array.isArray(parsed.acoes)
          ? (parsed.acoes as Array<Record<string, unknown>>).slice(0, 50).map((a) => {
              const prio = String(a.prioridade ?? 'media').toLowerCase()
              const conf = String(a.confianca ?? 'media').toLowerCase()
              const quando = a.quando ? String(a.quando).trim() : ''
              return {
                o_que: String(a.o_que ?? '').trim().slice(0, 300),
                por_que: String(a.por_que ?? '').trim().slice(0, 500),
                quem: String(a.quem ?? '').trim().slice(0, 120),
                onde: String(a.onde ?? '').trim().slice(0, 120),
                quando: /^\d{4}-\d{2}-\d{2}$/.test(quando) ? quando : null,
                como: String(a.como ?? '').trim().slice(0, 500),
                quanto: String(a.quanto ?? '').trim().slice(0, 120),
                prioridade: PRIORIDADES.has(prio) ? prio : 'media',
                confianca: CONF.has(conf) ? conf : 'media',
                evidencia: String(a.evidencia ?? '').trim().slice(0, 500),
                minuto: String(a.minuto ?? '').trim().slice(0, 12),
              }
            }).filter((a) => a.o_que)
          : []
        return {
          result: {
            resumo: String(parsed.resumo ?? '').trim().slice(0, 8000),
            decisoes: arrStr(parsed.decisoes), pendencias: arrStr(parsed.pendencias), acoes,
          },
          custoReal,
        }
      },
    })
  } catch {
    return NextResponse.json({ ok: false, aviso: 'Não consegui gerar a ata automática agora. Tente de novo em instantes.' })
  }

  if (guarded.desativado) return NextResponse.json({ ok: false, ia_desativada: true, aviso: guarded.motivo || 'A IA está desativada para esta empresa (Configurações de IA).' })
  if (guarded.pausado) return NextResponse.json({ ok: false, budget_pausado: true, aviso: guarded.motivo || 'O limite de IA do dia foi atingido. Tente mais tarde.' })

  const out = guarded.result!
  const ata = [
    out.resumo,
    out.decisoes.length ? `\nDecisões:\n- ${out.decisoes.join('\n- ')}` : '',
    out.pendencias.length ? `\nPendências:\n- ${out.pendencias.join('\n- ')}` : '',
  ].filter(Boolean).join('\n')

  // "quem" → responsavel_nome; "quanto" (texto livre) → custo_estimado numérico quando dá, senão vai pro "como"
  // (o modelo de ação usa custo_estimado numérico; nada se perde).
  const numeroDe = (s: string): number | null => {
    const m = s.replace(/\./g, '').replace(',', '.').match(/-?\d+(\.\d+)?/)
    if (!m) return null
    const n = Number(m[0])
    return Number.isFinite(n) ? n : null
  }
  const propostas = out.acoes.map((a) => {
    const custo = a.quanto ? numeroDe(a.quanto) : null
    const comoBase = a.como
    const como = a.quanto && custo === null ? [comoBase, `Quanto: ${a.quanto}`].filter(Boolean).join(' · ') : comoBase
    return {
      titulo: a.o_que.slice(0, 120),
      o_que: a.o_que, por_que: a.por_que, onde: a.onde,
      responsavel_nome: a.quem || null,
      quando: a.quando, como,
      custo_estimado: custo,
      prioridade: a.prioridade, confianca: a.confianca,
      evidencia: a.evidencia, minuto: a.minuto,
    }
  })

  // grava a ata sugerida + as propostas (status 'proposta'); nada vira ação sem o humano confirmar
  const { error: errGrava } = await sb.rpc('fn_reuniao_ia_resultado_gravar', {
    p_reuniao_id: reuniaoId,
    p_ata_ia: ata,
    p_resumo: { resumo: out.resumo, decisoes: out.decisoes, pendencias: out.pendencias },
    p_propostas: propostas,
  })
  if (errGrava) return NextResponse.json({ ok: false, aviso: 'A ata foi gerada, mas falhou ao salvar. Tente de novo.' })

  return NextResponse.json({ ok: true, ata, propostas: out.acoes.length, resumo: { resumo: out.resumo, decisoes: out.decisoes, pendencias: out.pendencias } })
}
