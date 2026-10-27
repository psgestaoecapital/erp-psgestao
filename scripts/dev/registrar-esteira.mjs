#!/usr/bin/env node
// Aba "Codes" (CEO 08/10): grava em erp_dev_esteira_status o último resultado da aceitação da main ('main') e a
// quantidade de runs esperando no grupo aceitacao-testes ('fila'). Rodado pelo registrar-esteira.yml (código da MAIN).
// Cancelado não é vermelho: 'main' só muda com success/failure. Só fetch nativo.

export function veredito(runs) {
  const r = (runs ?? []).find((x) => x.status === 'completed' && (x.conclusion === 'success' || x.conclusion === 'failure'))
  return r ? { verde: r.conclusion === 'success', run_url: r.html_url ?? null, ocorrido_em: r.updated_at ?? new Date().toISOString() } : null
}

async function gh(caminho) {
  const r = await fetch(`https://api.github.com/${caminho}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!r.ok) throw new Error(`GitHub ${caminho}: HTTP ${r.status}`)
  return r.json()
}

async function gravar(linhas) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes')
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/erp_dev_esteira_status?on_conflict=chave`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  })
  if (!r.ok) throw new Error(`Supabase erp_dev_esteira_status: HTTP ${r.status} ${await r.text()}`)
}

async function principal() {
  const repo = process.env.REPO
  const agora = new Date().toISOString()
  const linhas = []
  const main = await gh(`repos/${repo}/actions/workflows/aceitacao-main.yml/runs?status=completed&per_page=20`)
  const v = veredito(main.workflow_runs)
  if (v) linhas.push({ chave: 'main', verde: v.verde, run_url: v.run_url, ocorrido_em: v.ocorrido_em, atualizado_em: agora })
  let n = 0
  for (const wf of ['aceitacao-main.yml', 'aceitacao-pr.yml']) {
    for (const st of ['queued', 'waiting', 'pending']) {
      n += (await gh(`repos/${repo}/actions/workflows/${wf}/runs?status=${st}&per_page=1`)).total_count ?? 0
    }
  }
  linhas.push({ chave: 'fila', quantidade: n, ocorrido_em: agora, atualizado_em: agora })
  await gravar(linhas)
  console.log(`esteira gravada: main=${v ? (v.verde ? 'verde' : 'vermelho') : 'sem dado'} · fila=${n}`)
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  principal().catch((e) => { console.log(`::warning::${e.message}`); process.exit(0) })
}
