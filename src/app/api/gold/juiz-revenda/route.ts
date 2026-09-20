// POST /api/gold/juiz-revenda
// Body: { rota: string, tela_num?: number, veiculo_id?: string, empresa_id?: string }
// Header: x-watcher-secret (valida WATCHER_SECRET)
//
// Revenda R1d · O JUIZ (auditor estendido). Por rota, recebe FOTO + inventário do DOM (botões, campos,
// cards/valores, textos) + DADOS REAIS da empresa demo + os requisitos da tela (R1c) + as REGRAS DE
// NEGÓCIO do V7, e devolve por requisito: atendido | parcial | ausente | quebrado + evidência, e notas
// FUNCIONAL · CONTEÚDO · VISUAL PREMIUM. Grava em blueprint_tela_cobertura (uma execução por chamada).
//
// Diferença do juiz antigo (gold_camada2): ele não olhava a RÉGUA. Aqui o veredito é POR REQUISITO do V7,
// então pega o que passava batido — ex.: "botão de entrega em venda sem nota" e "dois preços mínimos
// diferentes" viram requisito 'quebrado'. Só empresa is_demo (RD-69/RD-70), nunca cliente.

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import chromium from '@sparticuz/chromium-min'
import { chromium as playwright } from 'playwright-core'
import type { Browser } from 'playwright-core'
import { chamarClaude } from '@/lib/aiModel'
import { empresaPermitidaParaRobo, MSG_ROBO_SO_DEMO } from '@/lib/gold/roboEmpresaPermitida'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v147.0.0/chromium-v147.0.0-pack.x64.tar'
const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'
const VERTICAL = 'revenda_veiculos'

// Regras de negócio do Documento Vivo V7 que o juiz deve aplicar (não são "opinião visual").
const REGRAS_V7 = [
  'Entrega de venda EXIGE NF-e autorizada — exceção só empresa is_demo (com selo "Demonstração — sem nota fiscal real"). Botão de entregar numa venda sem nota e não-demo é QUEBRADO.',
  'Preço mínimo vem de fonte única (fn_veic_preco_minimo): tem de ser IGUAL na ficha e na precificação. Dois valores diferentes para o mesmo veículo é QUEBRADO.',
  'Abrir a tela de vistoria NÃO pode criar vistoria (só o botão Iniciar). Se ao abrir já existir vistoria criada sem ação, é QUEBRADO.',
  'Verde/amarelo/vermelho só valem como SEMÁFORO (dias no pátio, margem). Cor decorativa fora de semáforo é problema VISUAL.',
  'Contador em 0 quando o DADO REAL também é 0 NÃO é bug (é honesto). Só é bug se o número da tela DIVERGE do banco.',
  'Número exibido na tela que diverge do banco (dados reais abaixo) é bug GRAVE (quebrado).',
  'Um requisito da régua que simplesmente não aparece na tela é "ausente" (gap), não "quebrado".',
]

type Body = { rota?: string; tela_num?: number; veiculo_id?: string; empresa_id?: string }
type Requisito = { id: string; tela_num: number; requisito: string; tipo: string | null; prioridade: string }
type Veredito = { ref: string; status: string; evidencia?: string; nota_funcional?: string; nota_conteudo?: string; nota_visual?: string }

const STATUS_VALIDOS = new Set(['atendido', 'parcial', 'ausente', 'quebrado'])

function normalizarRota(rota: string): string {
  // troca segmentos uuid por [id] para casar com rota_padrao da régua
  return rota.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/[id]')
}

export async function POST(req: Request) {
  const expected = process.env.WATCHER_SECRET
  if (!expected || req.headers.get('x-watcher-secret') !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: Body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const rota = (body.rota || '').trim()
  if (!rota.startsWith('/')) return NextResponse.json({ error: 'rota deve começar com /' }, { status: 400 })

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const SAAS_BASE_URL = process.env.SAAS_BASE_URL || 'https://erp-psgestao.vercel.app'
  const BOT_EMAIL = process.env.PLAYWRIGHT_USER_EMAIL!
  const BOT_PASSWORD = process.env.PLAYWRIGHT_USER_PASSWORD!
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !BOT_EMAIL || !BOT_PASSWORD) {
    return NextResponse.json({ error: 'env faltando (Supabase/bot)' }, { status: 500 })
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY ausente' }, { status: 500 })

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const empresaId = (body.empresa_id || DEMO_REVENDA).trim()
  if (!(await empresaPermitidaParaRobo(supabase, empresaId))) {
    return NextResponse.json({ error: MSG_ROBO_SO_DEMO, empresa_id: empresaId }, { status: 403 })
  }

  // rota concreta (troca [id] pelo veiculo informado) e tela da régua
  const rotaConcreta = body.veiculo_id ? rota.replace('[id]', body.veiculo_id) : rota
  const rotaPadrao = normalizarRota(rota)
  let telaNum = body.tela_num ?? null
  const { data: reqRows, error: reqErr } = await supabase
    .from('blueprint_tela_requisito')
    .select('id, tela_num, requisito, tipo, prioridade, rota_padrao')
    .eq('vertical', VERTICAL)
    .order('tela_num')
  if (reqErr) return NextResponse.json({ error: 'régua indisponível: ' + reqErr.message }, { status: 500 })
  const todos = (reqRows ?? []) as (Requisito & { rota_padrao: string | null })[]
  if (telaNum == null) {
    const match = todos.find((r) => (r.rota_padrao || '') === rotaPadrao)
    telaNum = match?.tela_num ?? null
  }
  if (telaNum == null) return NextResponse.json({ error: 'tela não encontrada na régua para a rota', rota_padrao: rotaPadrao }, { status: 404 })
  const requisitos = todos.filter((r) => r.tela_num === telaNum)
  if (!requisitos.length) return NextResponse.json({ error: 'sem requisitos para a tela', tela_num: telaNum }, { status: 404 })

  const dadosReais = await snapshotReal(supabase, empresaId)

  let browser: Browser | null = null
  try {
    const { data: signIn, error: signErr } = await supabase.auth.signInWithPassword({ email: BOT_EMAIL, password: BOT_PASSWORD })
    if (signErr || !signIn?.session) throw new Error(`login bot: ${signErr?.message || 'sem session'}`)
    const s = signIn.session
    const sessionPayload = JSON.stringify({
      access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in,
      expires_at: s.expires_at, token_type: s.token_type, user: s.user, provider_token: null, provider_refresh_token: null,
    })
    const storageKey = `sb-${SUPABASE_URL.replace('https://', '').split('.')[0]}-auth-token`

    const executablePath = await chromium.executablePath(CHROMIUM_PACK_URL)
    browser = await playwright.launch({ args: chromium.args, executablePath, headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true })
    await context.addInitScript(({ sk, sv, ek, ev }: { sk: string; sv: string; ek: string; ev: string }) => {
      try { window.localStorage.setItem(sk, sv); window.localStorage.setItem(ek, ev) } catch { /* */ }
    }, { sk: storageKey, sv: sessionPayload, ek: 'ps_empresa_sel', ev: empresaId })

    const page = await context.newPage()
    await page.goto(`${SAAS_BASE_URL}${rotaConcreta}`, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(1200)
    const urlFinal = page.url()
    if (urlFinal.includes('/login')) {
      return NextResponse.json({ error: 'bot caiu no login', url_final: urlFinal }, { status: 502 })
    }

    // inventário do DOM: botões, campos, cards/valores, textos
    const dom = await page.evaluate(() => {
      const txt = (document.body?.innerText || '')
      const botoes = Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 60)
      const campos = Array.from(document.querySelectorAll('input,select,textarea')).map((el) => {
        const e = el as HTMLInputElement
        return (e.getAttribute('placeholder') || e.getAttribute('name') || e.getAttribute('id') || e.getAttribute('aria-label') || '').trim()
      }).filter(Boolean).slice(0, 60)
      return {
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim() || null,
        botoes, campos,
        valores_brl: (txt.match(/R\$\s*[\d.,]+/g) || []).slice(0, 40),
        tem_tabela: !!document.querySelector('table'),
        tem_grafico: !!document.querySelector('canvas, svg'),
        texto: txt.replace(/\s+/g, ' ').slice(0, 4000),
        possui_erro: /erro|error|404|não encontrad/i.test(txt.slice(0, 800)),
      }
    })

    const buffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false, clip: { x: 0, y: 0, width: 1280, height: 900 } })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const fotoPath = `juiz-revenda/tela-${telaNum}/${ts}.jpg`
    await supabase.storage.from('system-screenshots').upload(fotoPath, buffer, { contentType: 'image/jpeg', upsert: true })
    const { data: pub } = supabase.storage.from('system-screenshots').getPublicUrl(fotoPath)
    const fotoUrl = pub?.publicUrl ?? null

    await page.close().catch(() => {})

    // pergunta ao juiz (visão + régua + regras + dados reais)
    const reqParaPrompt = requisitos.map((r, i) => ({ ref: `R${i + 1}`, requisito: r.requisito, tipo: r.tipo, prioridade: r.prioridade }))
    const prompt = `Você é o JUIZ da Revenda de Veículos (ERP PS Gestão). Julgue a tela pela RÉGUA (V7), não por opinião.
ROTA: ${rotaConcreta} · tela ${telaNum}. URL final: ${urlFinal}
REGRAS DE NEGÓCIO (V7) — aplique ao julgar:
${REGRAS_V7.map((r) => '- ' + r).join('\n')}
DADOS REAIS DA EMPRESA (banco): ${JSON.stringify(dadosReais)}
INVENTÁRIO DO DOM: ${JSON.stringify(dom)}
REQUISITOS A JULGAR (devolva o "ref" de cada um):
${JSON.stringify(reqParaPrompt)}

Para CADA requisito devolva: status ∈ atendido|parcial|ausente|quebrado; evidencia (o que viu na tela/dado que justifica); nota_funcional, nota_conteudo, nota_visual (1 frase cada).
"quebrado" = existe mas contraria uma regra de negócio ou diverge do banco. "ausente" = a régua pede e a tela não tem.
Contador 0 com dado real 0 = atendido (honesto), não bug.
Responda APENAS JSON sem markdown: {"vereditos":[{"ref":"R1","status":"...","evidencia":"...","nota_funcional":"...","nota_conteudo":"...","nota_visual":"..."}]}`

    const claude = await chamarClaude({
      finalidade: 'auditoria_jornada',
      endpoint: '/api/gold/juiz-revenda',
      companyId: empresaId,
      payload: {
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } },
            { type: 'text', text: prompt },
          ],
        }],
      },
    })

    const usage = claude?.usage
    const custoUsd = usage ? (usage.input_tokens * 2 + usage.output_tokens * 10) / 1_000_000 : 0
    const textBlock = (claude?.content || []).find((c: { type: string }) => c.type === 'text') as { text?: string } | undefined
    let vereditos: Veredito[] = []
    if (textBlock?.text) {
      try {
        const parsed = JSON.parse(textBlock.text.replace(/```json|```/g, '').trim())
        vereditos = Array.isArray(parsed?.vereditos) ? parsed.vereditos : []
      } catch { /* parse falho → vereditos vazio, tratado abaixo */ }
    }
    if (!vereditos.length) return NextResponse.json({ error: 'juiz não retornou vereditos', tela_num: telaNum }, { status: 502 })

    // grava a cobertura (uma execução por chamada)
    const execucaoId = crypto.randomUUID()
    const linhas: Record<string, unknown>[] = []
    let atendido = 0, parcial = 0
    for (let i = 0; i < requisitos.length; i++) {
      const v = vereditos.find((x) => x.ref === `R${i + 1}`)
      const status = v && STATUS_VALIDOS.has(v.status) ? v.status : 'ausente'
      if (status === 'atendido') atendido++; else if (status === 'parcial') parcial++
      const notas = v ? [v.nota_funcional && `FUNCIONAL: ${v.nota_funcional}`, v.nota_conteudo && `CONTEÚDO: ${v.nota_conteudo}`, v.nota_visual && `VISUAL: ${v.nota_visual}`].filter(Boolean).join(' · ') : ''
      linhas.push({
        requisito_id: requisitos[i].id, status,
        evidencia: [v?.evidencia, notas].filter(Boolean).join(' — ').slice(0, 2000) || null,
        foto_url: fotoUrl, execucao_id: execucaoId,
      })
    }
    const { error: insErr } = await supabase.from('blueprint_tela_cobertura').insert(linhas)
    if (insErr) return NextResponse.json({ error: 'falha ao gravar cobertura: ' + insErr.message }, { status: 500 })

    const score = (atendido + parcial * 0.5) / requisitos.length
    return NextResponse.json({
      ok: true, rota: rotaConcreta, tela_num: telaNum, execucao_id: execucaoId,
      requisitos: requisitos.length, atendido, parcial,
      pct_tela: Math.round(1000 * score) / 10, foto_url: fotoUrl, custo_usd: custoUsd,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: 'falha geral', detalhe: e instanceof Error ? e.message : String(e) }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => {})
  }
}

// Snapshot compacto de dados REAIS da demo — base para "número da tela ≠ banco = bug grave".
async function snapshotReal(supabase: SupabaseClient, empresaId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  try {
    const { count: veiculos } = await supabase.from('veic_veiculo').select('id', { count: 'exact', head: true })
      .eq('company_id', empresaId).is('deleted_at', null)
    out.veiculos_no_patio = veiculos ?? null
    const { data: vendas } = await supabase.from('veic_venda').select('situacao').eq('company_id', empresaId).is('deleted_at', null)
    const porSit: Record<string, number> = {}
    ;(vendas ?? []).forEach((v: { situacao: string }) => { porSit[v.situacao] = (porSit[v.situacao] || 0) + 1 })
    out.vendas_por_situacao = porSit
    const { count: vistorias } = await supabase.from('insp_vistoria').select('id', { count: 'exact', head: true })
      .eq('company_id', empresaId).eq('alvo_tabela', 'veic_veiculo')
    out.vistorias = vistorias ?? null
    const { count: procuras } = await supabase.from('veic_procura').select('id', { count: 'exact', head: true }).eq('company_id', empresaId)
    out.procuras_crm = procuras ?? null
  } catch (e) {
    out.aviso = 'snapshot parcial: ' + (e instanceof Error ? e.message : String(e))
  }
  return out
}
