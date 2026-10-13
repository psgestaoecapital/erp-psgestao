// Revenda R1e · varredura do juiz nas 9 rotas da Demonstração Revenda, com TETO de custo.
// Consulta fn_juiz_orcamento ANTES e a cada rota; para quando não couber (US$ 5/dia · US$ 50/mês).
// Cada execução do juiz é registrada em blueprint_juiz_execucao (fn_juiz_registrar_execucao).
// Uso: tsx scripts/juiz-revenda-sweep.ts   (env: PROD_BASE_URL, WATCHER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const BASE = process.env.PROD_BASE_URL || 'https://erp-psgestao.vercel.app'
const WATCHER = process.env.WATCHER_SECRET || ''
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const ORIGEM = process.env.JUIZ_ORIGEM || 'semanal' // 'gatilho' no push, 'semanal' no cron
const DEMO_REVENDA = 'b0700000-0000-4000-a000-000000000003'

if (!WATCHER || !SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltam env: WATCHER_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const restHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }

// As 9 rotas da Demonstração Revenda (tela da régua × rota concreta). [id] recebe um veículo da demo.
const ROTAS: { tela: number; rota: string; precisaVeiculo?: boolean }[] = [
  { tela: 1, rota: '/dashboard/revenda' },
  { tela: 3, rota: '/dashboard/revenda/patio' },
  { tela: 5, rota: '/dashboard/revenda/completar' },
  { tela: 10, rota: '/dashboard/revenda/vendas' },
  { tela: 13, rota: '/dashboard/revenda/preparacao' },
  { tela: 15, rota: '/dashboard/revenda/demanda' },
  { tela: 4, rota: '/dashboard/revenda/veiculo/[id]', precisaVeiculo: true },
  { tela: 6, rota: '/dashboard/revenda/veiculo/[id]/vistoria', precisaVeiculo: true },
  { tela: 8, rota: '/dashboard/revenda/veiculo/[id]/precificacao', precisaVeiculo: true },
]

async function orcamento(): Promise<{ ok: boolean; gasto_dia_usd: number; gasto_mes_usd: number }> {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_juiz_orcamento`, {
    method: 'POST', headers: restHeaders, body: JSON.stringify({}),
  })
  if (!resp.ok) throw new Error(`fn_juiz_orcamento: ${resp.status} ${await resp.text()}`)
  return resp.json()
}


async function veiculoDemo(): Promise<string | null> {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/veic_veiculo?company_id=eq.${DEMO_REVENDA}&deleted_at=is.null&select=id&limit=1`,
    { headers: restHeaders })
  const rows = (await resp.json()) as { id: string }[]
  return rows[0]?.id ?? null
}

async function main(): Promise<void> {
  const veh = await veiculoDemo()
  let processadas = 0, puladas = 0
  const resumo: Record<string, unknown>[] = []

  for (const r of ROTAS) {
    const orc = await orcamento()
    if (!orc.ok) {
      console.log(`⛔ teto de custo atingido (dia US$ ${orc.gasto_dia_usd} · mês US$ ${orc.gasto_mes_usd}) — parando`)
      break
    }
    if (r.precisaVeiculo && !veh) { console.log(`↷ ${r.rota}: sem veículo demo, pulada`); puladas++; continue }

    const resp = await fetch(`${BASE}/api/gold/juiz-revenda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-watcher-secret': WATCHER },
      body: JSON.stringify({ rota: r.rota, tela_num: r.tela, empresa_id: DEMO_REVENDA, veiculo_id: r.precisaVeiculo ? veh : undefined, origem: ORIGEM }),
    })
    const body = await resp.json().catch(() => ({})) as { ok?: boolean; execucao_id?: string; custo_usd?: number; pct_tela?: number; error?: string }
    if (resp.ok && body.ok) {
      // o próprio juiz registra a execução no ledger (fn_juiz_registrar_execucao) — não duplicar aqui.
      processadas++
      console.log(`✓ tela ${r.tela} ${r.rota} · ${body.pct_tela}% · US$ ${(body.custo_usd || 0).toFixed(4)}`)
      resumo.push({ tela: r.tela, rota: r.rota, pct: body.pct_tela, custo_usd: body.custo_usd })
    } else {
      console.error(`✗ tela ${r.tela} ${r.rota}: ${resp.status} ${body.error || ''}`)
      resumo.push({ tela: r.tela, rota: r.rota, erro: body.error || resp.status })
    }
  }

  const orcFim = await orcamento().catch(() => null)
  console.log(`\nVarredura do juiz concluída · ${processadas} rotas · ${puladas} puladas · gasto mês US$ ${orcFim?.gasto_mes_usd ?? '?'}`)
  console.log(JSON.stringify({ processadas, puladas, resumo }, null, 2))
}

main().catch((e) => { console.error('sweep falhou:', e); process.exit(1) })
