#!/usr/bin/env node
// Aba Codes · lê o GitHub (só leitura) e grava main/deploy no snapshot via fn_dev_codes_snapshot_github.
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GH_TOKEN, REPO } = process.env
const gh = (p) => fetch(`https://api.github.com/repos/${REPO}/${p}`, { headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' } }).then((r) => (r.ok ? r.json() : null))

export function estadoDoRun(runs) {
  const r = (runs?.workflow_runs ?? []).find((x) => x.status === 'completed' && x.conclusion !== 'cancelled')
  if (!r) return 'desconhecido'
  return r.conclusion === 'success' ? 'verde' : 'vermelho'
}

async function main() {
  const gates = await gh('actions/workflows/gates.yml/runs?branch=main&per_page=5')
  const deploy = await gh('actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=5')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_dev_codes_snapshot_github`, {
    method: 'POST',
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_main: estadoDoRun(gates), p_deploy: estadoDoRun(deploy), p_tempo_autorizacao_min: null }),
  })
  if (!res.ok) { console.error('falhou', res.status, await res.text()); process.exit(1) }
  console.log('snapshot github ok', await res.text())
}
if (import.meta.url === `file://${process.argv[1]}`) main()
