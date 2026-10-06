// Fila de merge própria (CEO 06/10; o merge queue do GitHub exige plano pago, RD-42). Roda no workflow fila-merge.yml.
// PR com label "fila-merge" + autorizada + verde → atualiza com a main, espera os checks, mergeia por ordem de chegada,
// UMA por execução (o workflow tem concurrency), e comenta o resultado. Nunca auto-merge (RD-94). REST puro (GraphQL é
// bloqueado na rede das sessões). Env: GH_TOKEN (FILA_MERGE_TOKEN), REPO, AUTORIZADORES (logins, vírgula).
import { spawnSync } from 'node:child_process'
import * as g from './merge-gate-lib.mjs'

const { GH_TOKEN, REPO, AUTORIZADORES = '' } = process.env
if (!GH_TOKEN || !REPO) { console.error('GH_TOKEN/REPO ausentes'); process.exit(1) }
const autorizadores = AUTORIZADORES.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const LABEL = 'fila-merge'

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const txt = await res.text()
  const json = txt ? JSON.parse(txt) : null
  if (!res.ok && !(method !== 'GET' && res.status < 500)) throw new Error(`${method} ${path} → ${res.status} ${txt.slice(0, 200)}`)
  return { status: res.status, json }
}
const pagina = async (path) => {
  const out = []
  for (let p = 1; p <= 10; p++) {
    const { json } = await api(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${p}`)
    const lista = Array.isArray(json) ? json : (json?.check_runs ?? json?.workflow_runs ?? [])
    out.push(...lista)
    if (lista.length < 100) break
  }
  return out
}
const comentar = (n, texto) => api(`issues/${n}/comments`, { method: 'POST', body: { body: `${texto}\n\n---\n_Fila de merge (workflow gratuito)_` } })
const tirarDaFila = (n) => api(`issues/${n}/labels/${LABEL}`, { method: 'DELETE' })

function patchIdDa(pr) {
  const sh = (cmd) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8' })
  sh(`git fetch -q origin ${pr.base.ref} pull/${pr.number}/head`)
  const r = sh(`git diff origin/${pr.base.ref}...FETCH_HEAD | git patch-id --stable | cut -d' ' -f1`)
  return (r.stdout ?? '').trim()
}

async function ultimaMigrationDaMain() {
  const { json } = await api('commits?sha=main&path=supabase/migrations&per_page=1')
  return json?.[0]?.sha ?? null
}

async function mainVerde() {
  const { json } = await api('actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=1')
  const run = json?.workflow_runs?.[0]
  if (!run) return { ok: true }
  if (run.status !== 'completed') return { ok: false, motivo: 'deploy-migrations em andamento na main' }
  return run.conclusion === 'success' || run.conclusion === 'cancelled'
    ? { ok: true }
    : { ok: false, motivo: `deploy-migrations ${run.conclusion} na main` }
}

const fila = []
for (const p of await pagina('pulls?state=open')) {
  if (p.draft || !p.labels.some((l) => l.name === LABEL)) continue
  const ev = await pagina(`issues/${p.number}/events`)
  const desde = ev.filter((e) => e.event === 'labeled' && e.label?.name === LABEL).map((e) => e.created_at).sort().pop() ?? p.created_at
  fila.push({ n: p.number, fila_desde: desde })
}
if (fila.length === 0) { console.log('fila vazia'); process.exit(0) }

// Um merge por vez, entre todos: se a main não está verde, ninguém passa.
const mv = await mainVerde()
if (!mv.ok) { console.log(`main não está verde (${mv.motivo}) — espera`); process.exit(0) }

for (const { n } of fila.sort((a, b) => a.fila_desde.localeCompare(b.fila_desde))) {
  const { json: pr } = await api(`pulls/${n}`)
  const arquivos = (await pagina(`pulls/${n}/files`)).map((f) => f.filename)
  console.log(`#${n}: avaliando (${arquivos.length} arquivos)`)

  // autorização: pelo conteúdo (patch-id), ou RD-94.1 categoria (a)
  const aut = g.somenteWorkflowGatesDocs(arquivos)
    ? { ok: true, motivo: 'RD-94.1 (só workflow/gates/testes/docs)' }
    : g.autorizacaoValida({ comentarios: (await pagina(`issues/${n}/comments`)).map((c) => ({ user: c.user?.login, body: c.body, created_at: c.created_at })), pr: n, autorizadores, patchIdAtual: patchIdDa(pr) })
  if (!aut.ok) { await comentar(n, `⛔ Fora da fila: ${aut.motivo}. Reponha a label \`${LABEL}\` depois da autorização.`); await tirarDaFila(n); continue }

  if (pr.mergeable_state === null || pr.mergeable === null) { console.log(`#${n}: mergeabilidade ainda não calculada — espera`); process.exit(0) }
  if (pr.mergeable_state === 'dirty') { await comentar(n, '⛔ Fora da fila: conflito com a main — resolva e reponha a label.'); await tirarDaFila(n); continue }
  if (pr.mergeable_state === 'behind') {
    const r = await api(`pulls/${n}/update-branch`, { method: 'PUT', body: { expected_head_sha: pr.head.sha } })
    console.log(`#${n}: update-branch → ${r.status}; os checks rodam de novo e a fila volta quando fecharem`)
    process.exit(0)
  }

  const checks = g.estadoChecks(await pagina(`commits/${pr.head.sha}/check-runs`))
  if (checks === 'esperar') { console.log(`#${n}: checks em andamento — espera`); process.exit(0) }
  if (checks === 'vermelho') { await comentar(n, '⛔ Fora da fila: há check vermelho no commit atual. Corrija e reponha a label.'); await tirarDaFila(n); continue }

  const sha = await ultimaMigrationDaMain()
  const runs = sha ? (await pagina('actions/workflows/aceitacao-pos-migration.yml/runs?branch=main')).filter((r) => r.head_sha === sha) : []
  const pos = g.decidirPosMigration({ prTemMigration: g.temMigration(arquivos), runs })
  console.log(`#${n}: @pos-migration → ${pos.acao} (${pos.motivo})`)
  if (pos.acao === 'rerodar') { await api(`actions/runs/${pos.runId}/rerun`, { method: 'POST' }); process.exit(0) }
  if (pos.acao === 'esperar') process.exit(0)
  if (pos.acao === 'bloquear') { await comentar(n, `⛔ Fila parada: ${pos.motivo}. A PR continua na fila; o Eng. Chefe decide.`); process.exit(0) }

  const m = await api(`pulls/${n}/merge`, { method: 'PUT', body: { merge_method: 'squash', sha: pr.head.sha } })
  if (m.status === 200) {
    await comentar(n, `✅ Mergeada pela fila (${aut.motivo}). Pós-merge: veredito @pos-migration e prova nas telas tocadas ficam com o dono da PR.`)
    await tirarDaFila(n)
    console.log(`#${n}: mergeada`)
  } else {
    await comentar(n, `⛔ Merge recusado (${m.status}): ${m.json?.message ?? ''}. Continua na fila.`)
  }
  process.exit(0) // um por vez; o push na main reaciona a fila
}
