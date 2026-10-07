#!/usr/bin/env node
// Aba "Codes" da Central de Desenvolvimento (CEO 07/10 14:30) · grava os eventos das PRs em erp_dev_entrega.
// Rodado pelo .github/workflows/registrar-entrega.yml (código da MAIN; nunca o da PR):
//   pull_request_target opened → "aberta" (+ "pronta" se já abriu Ready) · ready_for_review → "pronta"
//   closed + merged → "publicada" (ocorrido_em = merged_at) · closed sem merge → "fechada" (ocorrido_em = closed_at)
//   workflow_dispatch → carga inicial: PRs publicadas e abertas dos últimos N dias (API REST do GitHub).
// Code da PR: linha "Code: <nome>" no corpo; sem ela, o campo `para` da mensagem da caixa com pr_numero = N; sem nada,
// "não identificado". Via: etiqueta revisao-eng-chefe → "revisada"; senão "rapida".
// Grava pela REST do Supabase com a service_role (upsert em (pr_numero, evento, sha)). Só fetch nativo, sem dependências.

export const SEM_CODE = 'não identificado'

export function codeDoCorpo(corpo) {
  const m = /^[ \t>*_-]*Code:[ \t*_]*([A-Za-z0-9][A-Za-z0-9._-]*)/m.exec(String(corpo ?? ''))
  return m ? m[1].toLowerCase() : null
}

export function viaDaPr(pr) {
  return (pr?.labels ?? []).some((l) => (typeof l === 'string' ? l : l?.name) === 'revisao-eng-chefe') ? 'revisada' : 'rapida'
}

function base(pr, code) {
  return { pr_numero: pr.number, titulo: String(pr.title ?? ''), code: code || SEM_CODE, via: viaDaPr(pr), url: pr.html_url ?? null }
}

// Linhas a gravar para um evento do webhook (pull_request_target). `code` já resolvido.
export function linhasDoEvento(acao, pr, code) {
  const b = base(pr, code)
  const head = pr?.head?.sha ?? ''
  if (acao === 'opened') {
    const l = [{ ...b, evento: 'aberta', sha: head, ocorrido_em: pr.created_at }]
    if (!pr.draft) l.push({ ...b, evento: 'pronta', sha: head, ocorrido_em: pr.created_at })
    return l
  }
  if (acao === 'ready_for_review') return [{ ...b, evento: 'pronta', sha: head, ocorrido_em: pr.updated_at ?? new Date().toISOString() }]
  if (acao === 'closed') {
    if (pr.merged || pr.merged_at) return [{ ...b, evento: 'publicada', sha: pr.merge_commit_sha || head, ocorrido_em: pr.merged_at }]
    return [{ ...b, evento: 'fechada', sha: head, ocorrido_em: pr.closed_at ?? new Date().toISOString() }]
  }
  return []
}

// Carga inicial: PR (da listagem REST) dentro da janela → linhas. Publicadas e abertas; fechadas sem merge ficam fora.
export function linhasDaCarga(pr, code, desde) {
  const b = base(pr, code)
  const head = pr?.head?.sha ?? ''
  if (pr.merged_at) {
    return new Date(pr.merged_at) >= desde ? [{ ...b, evento: 'publicada', sha: pr.merge_commit_sha || head, ocorrido_em: pr.merged_at }] : []
  }
  if (pr.state !== 'open') return []
  const l = [{ ...b, evento: 'aberta', sha: head, ocorrido_em: pr.created_at }]
  if (!pr.draft) l.push({ ...b, evento: 'pronta', sha: head, ocorrido_em: pr.created_at })
  return l
}

async function supa(caminho, init = {}) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes')
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${caminho}`, {
    ...init, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!r.ok) throw new Error(`Supabase ${init.method ?? 'GET'} ${caminho.split('?')[0]}: HTTP ${r.status} ${await r.text()}`)
  return r
}

export async function resolverCode(pr) {
  const doCorpo = codeDoCorpo(pr.body)
  if (doCorpo) return doCorpo
  try {
    const r = await supa(`erp_agente_mensagem?pr_numero=eq.${Number(pr.number)}&select=para&order=atualizado_em.desc&limit=1`)
    const [m] = await r.json()
    if (m?.para) return String(m.para)
  } catch (e) { console.log(`::warning::caixa dos agentes ilegível para #${pr.number}: ${e.message}`) }
  return SEM_CODE
}

export async function gravar(linhas) {
  if (!linhas.length) return 0
  await supa('erp_dev_entrega?on_conflict=pr_numero,evento,sha', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas),
  })
  return linhas.length
}

async function gh(caminho) {
  const r = await fetch(`https://api.github.com/${caminho}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  })
  if (!r.ok) throw new Error(`GitHub ${caminho}: HTTP ${r.status}`)
  return r.json()
}

async function carga() {
  const dias = Math.max(1, Number(process.env.DIAS || 7))
  const desde = new Date(Date.now() - dias * 864e5)
  let total = 0
  for (let pagina = 1; pagina <= 20; pagina++) {
    const prs = await gh(`repos/${process.env.REPO}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${pagina}`)
    for (const pr of prs) {
      const linhas = linhasDaCarga(pr, null, desde)
      if (!linhas.length) continue
      const code = await resolverCode(pr)
      total += await gravar(linhas.map((l) => ({ ...l, code })))
    }
    if (prs.length < 100 || new Date(prs[prs.length - 1].updated_at) < desde) break
  }
  console.log(`carga inicial (${dias} dias): ${total} evento(s) gravado(s)`)
}

async function main() {
  const { readFileSync } = await import('node:fs')
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') return carga()
  const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const pr = ev.pull_request
  if (!pr) { console.log('evento sem pull_request: nada a gravar'); return }
  const code = await resolverCode(pr)
  const n = await gravar(linhasDoEvento(ev.action, pr, code))
  console.log(`#${pr.number} (${ev.action}) · Code ${code} · ${n} evento(s) gravado(s)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1) })
}
