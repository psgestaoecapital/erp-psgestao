#!/usr/bin/env node
// Aba Codes · painel de desempenho (CEO 09/10): preenche main_estado/deploy_estado no retrato mais recente de
// erp_dev_codes_snapshot. Só LÊ o GitHub (Actions) e atualiza as 2 colunas do último retrato. Código da MAIN.
export function estadoDoRun(run) {
  if (!run) return 'desconhecido'
  if (run.status !== 'completed') return 'desconhecido'
  if (run.conclusion === 'success') return 'verde'
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'vermelho'
  return 'desconhecido' // cancelado/pulado não é vermelho (regra (a) da esteira)
}

// Runs vêm do mais novo para o mais antigo; usa o último run concluído que não foi cancelado/pulado.
export function ultimoEstado(runs) {
  for (const r of runs ?? []) {
    const e = estadoDoRun(r)
    if (e !== 'desconhecido') return e
  }
  return 'desconhecido'
}

async function gh(caminho) {
  const r = await fetch(`https://api.github.com/repos/${process.env.REPO}/${caminho}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' },
  })
  if (!r.ok) throw new Error(`GitHub ${r.status} ${caminho}`)
  return r.json()
}

async function main() {
  const [gates, deploy] = await Promise.all([
    gh('actions/workflows/gates.yml/runs?branch=main&per_page=5'),
    gh('actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=5'),
  ])
  const main_estado = ultimoEstado(gates.workflow_runs)
  const deploy_estado = ultimoEstado(deploy.workflow_runs)
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes')
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const base = `${url.replace(/\/$/, '')}/rest/v1/erp_dev_codes_snapshot`
  const ult = await (await fetch(`${base}?select=id&order=capturado_em.desc&limit=1`, { headers: h })).json()
  if (!ult?.[0]) { console.log('sem retrato ainda'); return }
  const r = await fetch(`${base}?id=eq.${ult[0].id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ main_estado, deploy_estado }) })
  if (!r.ok) throw new Error(`Supabase ${r.status}`)
  console.log(`retrato ${ult[0].id}: main=${main_estado} deploy=${deploy_estado}`)
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) main().catch((e) => { console.error(e); process.exit(1) })
