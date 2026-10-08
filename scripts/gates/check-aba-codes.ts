// Gate (CEO 07/10 14:30) — aba "Codes" em tempo real na Central de Desenvolvimento. Sem rede externa (o "Supabase" da
// parte 3 é um servidor HTTP simulado em 127.0.0.1, dentro deste processo).
//  (1) migration: erp_dev_entrega com RLS (SELECT só equipe PS, grava só service_role, nada ao anon), leitura da caixa só
//      pela equipe PS e SEM o corpo das tarefas, as 3 tabelas na publicação do Realtime, rota em system_screens (RD-50);
//  (2) workflow registrar-entrega.yml: pull_request_target (opened, ready_for_review, closed) sem checkout da PR + carga;
//  (3) o script REAL contra o Supabase simulado: PR mergeada → "publicada" (ocorrido_em = merged_at), fechada sem merge →
//      "fechada", aberta Ready → aberta + pronta; Code pelo corpo, pela caixa ou "não identificado";
//  (4) regras puras do painel (sessão ativa/encerrada/expirada, fila, em teste, faixa verde/vermelha);
//  (5) tela: aba na Central (rota própria), assina as 3 tabelas no Realtime; AGENTS.md com a regra "Code: <nome>".
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage } from 'node:http'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CODES_LINHA_FINAL, CODES_PRINCIPAIS, emTeste, esteira, resumoCode, estadoSessao, faixa, fila, intervaloDia,
  type Entrega, type Lease, type Mensagem,
} from '../../src/lib/dev/painelCodes'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => readFileSync(p, 'utf8')

async function main() {
  // ── (1) migration ───────────────────────────────────────────────────────────────────────────────────────────────
  const dir = 'supabase/migrations'
  const arq = readdirSync(dir).find((f) => f.endsWith('_dev_codes_tempo_real.sql'))
  ok(!!arq && /^\d{12}60_/.test(arq), `migration na faixa 60 (${arq ?? '—'})`)
  const sql = (arq ? ler(join(dir, arq)) : '').replace(/--[^\n]*/g, '')
  ok(/CREATE TABLE IF NOT EXISTS public\.erp_dev_entrega/.test(sql)
    && /evento\s+text\s+NOT NULL CHECK \(evento IN \('aberta','pronta','publicada','fechada'\)\)/.test(sql)
    && /via\s+text\s+CHECK \(via IN \('rapida','revisada'\)\)/.test(sql), 'erp_dev_entrega: eventos e vias do CEO')
  ok(/UNIQUE \(pr_numero, evento, sha\)/.test(sql), 'único por (pr_numero, evento, sha)')
  ok(/ALTER TABLE public\.erp_dev_entrega ENABLE ROW LEVEL SECURITY/.test(sql), 'RLS ligada')
  ok(/REVOKE ALL ON TABLE public\.erp_dev_entrega FROM PUBLIC, anon, authenticated/.test(sql)
    && /GRANT SELECT ON TABLE public\.erp_dev_entrega TO authenticated;/.test(sql)
    && !/GRANT[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*erp_dev_entrega TO (anon|authenticated)/.test(sql)
    && !/GRANT[^;]*TO[^;]*\banon\b/.test(sql), 'sem GRANT ao anon (RD-79); logado só SELECT; grava só a service_role')
  const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON public\.(\w+)\s+FOR (\w+) TO (\w+) USING \(([^;]*)\);/g)]
  ok(policies.length === 4 && policies.every((p) => p[3] === 'SELECT' && p[4] === 'authenticated' && p[5].trim() === 'public.fn_dev_painel_pode_ver()'),
    `4 policies, todas SELECT da equipe PS (fn_dev_painel_pode_ver) — nenhuma de escrita (${policies.length})`)
  // CEO 07/10: equipe PS = SOMENTE ps_equipe_acesso ativo. is_admin() olha users.role (adm/acesso_total), que usuário de
  // cliente pode ter — não entra em nenhuma regra de acesso desta migration.
  ok(/FUNCTION public\.fn_equipe_ps_ativa\(\) RETURNS boolean[\s\S]*?SELECT auth\.uid\(\) IS NOT NULL AND EXISTS \(SELECT 1 FROM ps_equipe_acesso e WHERE e\.user_id = auth\.uid\(\) AND e\.ativo\)\s*\$function\$;/.test(sql)
    && /FUNCTION public\.fn_dev_painel_pode_ver\(\) RETURNS boolean[\s\S]*?AS \$function\$\s*SELECT public\.fn_equipe_ps_ativa\(\)\s*\$function\$;/.test(sql),
    'equipe PS = SOMENTE ps_equipe_acesso ativo (fn_dev_painel_pode_ver → fn_equipe_ps_ativa)')
  ok(!/is_admin\s*\(/.test(sql), 'sem is_admin() (users.role pode ser de usuário de cliente)')
  ok(/REVOKE ALL ON FUNCTION public\.fn_equipe_ps_ativa\(\) FROM PUBLIC, anon;/.test(sql), 'fn_equipe_ps_ativa fechada ao anon')
  ok(/REVOKE ALL ON FUNCTION public\.fn_dev_painel_pode_ver\(\) FROM PUBLIC, anon;/.test(sql), 'fn_dev_painel_pode_ver fechada ao anon')
  const colsMsg = sql.match(/GRANT SELECT \(([^)]*)\)\s*ON TABLE public\.erp_agente_mensagem TO authenticated/)?.[1] ?? ''
  ok(!!colsMsg && !/\bcorpo\b|\bacionamento\b/.test(colsMsg) && /\bassunto\b/.test(colsMsg) && /\bpr_numero\b/.test(colsMsg),
    'caixa: só as colunas do painel (corpo e acionamento seguem fechados)')
  ok(!/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*erp_agente_/.test(sql), 'caixa: nenhuma escrita aberta (canal protegido)')
  ok(/ARRAY\['erp_dev_entrega','erp_agente_mensagem','erp_agente_sessao_lease'\]/.test(sql) && /ALTER PUBLICATION supabase_realtime ADD TABLE/.test(sql),
    'Realtime: as 3 tabelas na publicação supabase_realtime')
  ok(/INSERT INTO public\.system_screens[\s\S]*'\/dashboard\/dev\/codes'/.test(sql), 'rota /dashboard/dev/codes em system_screens (RD-50)')

  // ── (2) workflow ────────────────────────────────────────────────────────────────────────────────────────────────
  const wf = ler('.github/workflows/registrar-entrega.yml')
  ok(/pull_request_target:\s*\n\s*types: \[opened, ready_for_review, closed\]/.test(wf), 'workflow: opened, ready_for_review, closed')
  ok(/workflow_dispatch:/.test(wf) && /dias:/.test(wf), 'workflow: carga inicial manual (dias)')
  ok(/ref: \$\{\{ github\.event\.repository\.default_branch \}\}/.test(wf) && !/pull_request\.head|head_ref|refs\/pull/.test(wf),
    'workflow: checkout só da main — nunca o código da PR')
  ok(/secrets\.SUPABASE_URL/.test(wf) && /secrets\.SUPABASE_SERVICE_ROLE_KEY/.test(wf) && /node scripts\/dev\/registrar-entrega\.mjs/.test(wf),
    'workflow: grava com os segredos que já existem, pelo script')

  // ── (3) script real × Supabase simulado ─────────────────────────────────────────────────────────────────────────
  type Req = { metodo: string; url: string; corpo: unknown }
  const reqs: Req[] = []
  let caixa: { para: string }[] = []
  const lerCorpo = (r: IncomingMessage) => new Promise<string>((res) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => res(b)) })
  const srv = createServer(async (rq, rs) => {
    const corpo = await lerCorpo(rq)
    reqs.push({ metodo: rq.method ?? '', url: rq.url ?? '', corpo: corpo ? JSON.parse(corpo) : null })
    if (rq.headers.authorization !== 'Bearer chave-servico') { rs.writeHead(401); rs.end('{}'); return }
    if (rq.method === 'GET' && rq.url?.startsWith('/rest/v1/erp_agente_mensagem')) { rs.writeHead(200); rs.end(JSON.stringify(caixa)); return }
    rs.writeHead(201); rs.end('')
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const porta = (srv.address() as { port: number }).port
  const tmp = mkdtempSync(join(tmpdir(), 'aba-codes-'))
  const rodar = (acao: string, pr: Record<string, unknown>) => new Promise<number>((res) => {
    const ev = join(tmp, `${acao}-${Date.now()}.json`)
    writeFileSync(ev, JSON.stringify({ action: acao, pull_request: pr }))
    const p = spawn(process.execPath, ['scripts/dev/registrar-entrega.mjs'], {
      env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_PATH: ev,
        SUPABASE_URL: `http://127.0.0.1:${porta}`, SUPABASE_SERVICE_ROLE_KEY: 'chave-servico' }, stdio: 'inherit' })
    p.on('exit', (c) => res(c ?? 1))
  })
  type Linha = { pr_numero: number; evento: string; code: string; via: string; sha: string; ocorrido_em: string; titulo: string; url: string }
  const gravadas = () => reqs.filter((r) => r.metodo === 'POST').flatMap((r) => r.corpo as Linha[])
  const prBase = { number: 4242, title: 'feat: aba Codes', html_url: 'https://github.com/x/y/pull/4242', created_at: '2026-10-07T17:00:00Z',
    head: { sha: 'aaa111' }, labels: [{ name: 'revisao-eng-chefe' }], draft: false }
  try {
    reqs.length = 0
    let c = await rodar('closed', { ...prBase, body: 'Resumo\n\nCode: gilberto-desenv\n', merged: true, merged_at: '2026-10-07T18:05:00Z', merge_commit_sha: 'mmm999' })
    let g = gravadas()
    ok(c === 0 && g.length === 1 && g[0].evento === 'publicada' && g[0].ocorrido_em === '2026-10-07T18:05:00Z' && g[0].sha === 'mmm999',
      'PR mergeada → grava "publicada" com ocorrido_em = merged_at (sha do merge)')
    ok(g[0]?.code === 'gilberto-desenv' && g[0]?.via === 'revisada' && g[0]?.pr_numero === 4242 && g[0]?.url === prBase.html_url,
      'publicada: Code da linha "Code:" do corpo, via revisada pela etiqueta, número e link')
    ok(reqs.some((r) => r.metodo === 'POST' && r.url === '/rest/v1/erp_dev_entrega?on_conflict=pr_numero,evento,sha'),
      'grava por upsert em (pr_numero, evento, sha) — re-run não duplica')

    reqs.length = 0; caixa = [{ para: 'jordana-code' }]
    c = await rodar('closed', { ...prBase, body: 'sem a linha', labels: [], merged: false, merged_at: null, closed_at: '2026-10-07T18:10:00Z' })
    g = gravadas()
    ok(c === 0 && g.length === 1 && g[0].evento === 'fechada' && g[0].ocorrido_em === '2026-10-07T18:10:00Z' && g[0].via === 'rapida',
      'fechada sem merge → "fechada" (ocorrido_em = closed_at), via rápida sem a etiqueta')
    ok(g[0]?.code === 'jordana-code' && reqs.some((r) => r.metodo === 'GET' && /erp_agente_mensagem\?pr_numero=eq\.4242&select=para/.test(r.url)),
      'sem "Code:" no corpo → Code = campo para da mensagem da caixa com pr_numero = N')

    reqs.length = 0; caixa = []
    c = await rodar('opened', { ...prBase, body: null })
    g = gravadas()
    ok(c === 0 && g.map((l) => l.evento).join(',') === 'aberta,pronta' && g.every((l) => l.code === 'não identificado' && l.sha === 'aaa111'),
      'aberta já Ready → "aberta" + "pronta"; sem Code em lugar nenhum → "não identificado"')

    reqs.length = 0
    c = await rodar('opened', { ...prBase, draft: true, body: '> **Code:** rodrigo-code' })
    g = gravadas()
    ok(c === 0 && g.map((l) => l.evento).join(',') === 'aberta' && g[0].code === 'rodrigo-code', 'rascunho → só "aberta"; "Code:" em negrito/citação vale')
  } finally {
    srv.close(); rmSync(tmp, { recursive: true, force: true })
  }

  // ── (4) regras puras ────────────────────────────────────────────────────────────────────────────────────────────
  const agora = new Date('2026-10-07T18:00:00Z')
  const min = (m: number) => new Date(agora.getTime() - m * 60_000).toISOString()
  const lease = (agente: string, ini: number, ren: number): Lease => ({ agente, sessao_ref: 's', iniciada_em: min(ini), renovada_em: min(ren) })
  const s1 = estadoSessao(lease('a', 30, 5), agora)
  ok(s1.ativa, 'sessão renovada há 5 min → ativa')
  const s2 = estadoSessao(lease('a', 30, 13), agora)
  ok(!s2.ativa && s2.paradoDesde?.toISOString() === min(13), 'renovada há 13 min → parada desde a última renovação')
  const s3 = estadoSessao({ agente: 'a', sessao_ref: 's', iniciada_em: min(60), renovada_em: min(20 + 24 * 60) }, agora)
  ok(!s3.ativa && s3.paradoDesde?.toISOString() === min(20), 'encerrada (renovada_em = fim − 1 dia) → parado desde renovada_em + 1 dia')
  ok(!estadoSessao(undefined, agora).ativa, 'sem lease → parado')

  const msg = (id: string, para: string, status: string, criado: number, extra: Partial<Mensagem> = {}): Mensagem =>
    ({ id, para, assunto: id, status, pr_numero: null, resposta: null, arquivada: false, criado_em: min(criado), atualizado_em: min(criado), ...extra })
  const msgs = [msg('m2', 'jordana-code', 'nova', 10), msg('m1', 'jordana-code', 'nova', 50), msg('m3', 'jordana-code', 'em_andamento', 5),
    msg('m4', 'jordana-code', 'nova', 70, { arquivada: true }), msg('m5', 'jordana-code', 'recebida', 30)]
  ok(fila(msgs, 'jordana-code').map((m) => m.id).join(',') === 'm1,m5,m2', 'fila: novas/recebidas não arquivadas, da mais antiga para a mais nova')

  const ent = (id: number, pr: number, evento: Entrega['evento'], m: number, code = 'gilberto-desenv'): Entrega =>
    ({ id, pr_numero: pr, titulo: `PR ${pr}`, code, evento, via: 'rapida', sha: `s${id}`, url: null, ocorrido_em: min(m) })
  const ents = [ent(1, 10, 'aberta', 300), ent(2, 10, 'pronta', 200), ent(3, 11, 'aberta', 100), ent(4, 12, 'aberta', 90), ent(5, 12, 'publicada', 30)]
  const et = emTeste(ents, 'gilberto-desenv')
  ok(et.map((p) => `${p.pr_numero}:${p.pronta}`).join(',') === '10:true,11:false', 'em teste: abertas sem publicada/fechada (pronta x rascunho)')

  const leases = [lease('gilberto-desenv', 30, 2)]
  const verde = faixa({ entregas: ents, msgs: [], leases, agora })
  ok(verde.cor === 'verde', `faixa VERDE: publicou na última hora e ninguém parado com fila (${verde.frase})`)
  const semPub = faixa({ entregas: ents.filter((e) => e.evento !== 'publicada'), msgs: [], leases, agora })
  ok(semPub.cor === 'vermelha' && /^Nada publicado nos últimos 7 dias com 1 PR pronta$/.test(semPub.frase), `faixa VERMELHA sem publicação (${semPub.frase})`)
  const velha = faixa({ entregas: [ent(6, 13, 'publicada', 125), ent(7, 14, 'pronta', 10), ent(8, 15, 'pronta', 10)], msgs: [], leases, agora })
  ok(velha.cor === 'vermelha' && velha.frase === 'Nada publicado há 2 h com 2 PRs prontas', `faixa: "nada publicado há 2 h com 2 PRs prontas" (${velha.frase})`)
  const parado = faixa({ entregas: ents, msgs, leases, agora })
  ok(parado.cor === 'vermelha' && /^jordana-code parado com 3 tarefas na fila$/.test(parado.frase), `faixa VERMELHA: Code parado com fila (${parado.frase})`)
  const ativo = faixa({ entregas: ents, msgs, leases: [...leases, lease('jordana-code', 40, 1)], agora })
  ok(ativo.cor === 'verde', 'Code com fila mas com sessão ativa não trava a faixa')
  ok(intervaloDia('2026-10-07').de === '2026-10-07T03:00:00.000Z' && intervaloDia('2026-10-07').ate === '2026-10-08T03:00:00.000Z',
    'filtro por data: o dia de São Paulo (00:00−03:00 a 24:00−03:00)')
  ok(CODES_PRINCIPAIS.join(',') === 'gilberto-desenv,gilberto-chamados,gilberto-produto,jordana-code,rodrigo-code'
    && CODES_LINHA_FINAL.join(',') === 'gilberto-revisor,eng-chefe-auto', 'cartões: os 5 Codes + linha final (revisor e eng-chefe-auto)')

  // ── (5) tela e AGENTS.md ────────────────────────────────────────────────────────────────────────────────────────
  const painel = ler('src/components/dev/PainelCodes.tsx')
  for (const t of ['erp_dev_entrega', 'erp_agente_mensagem', 'erp_agente_sessao_lease']) {
    ok(new RegExp(`postgres_changes', \\{ event: '\\*', schema: 'public', table: '${t}' \\}`).test(painel), `tela assina ${t} no Realtime`)
  }
  ok(/rpc\('fn_dev_painel_pode_ver'\)/.test(painel) && /codes-acesso-negado/.test(painel), 'tela: só a equipe PS (mesma regra da RLS)')
  ok(!/\bcorpo\b/.test(painel.match(/COLS_MSG = '([^']*)'/)?.[1] ?? 'corpo'), 'tela não pede o corpo das tarefas')
  const ordem = ['card-agora-', 'card-entregue-', 'card-teste-', 'card-fila-'].map((k) => painel.indexOf(k))
  ok(ordem.every((i, k) => i > 0 && (k === 0 || i > ordem[k - 1])), 'cartão na ordem: trabalhando agora, entregue 24 h, em teste, fila')
  ok(/grid-cols-1 md:grid-cols-2/.test(painel), 'grade de 2 colunas (1 no celular)')
  const dev = ler('src/app/dashboard/dev/page.tsx')
  ok(/import PainelCodes from '@\/components\/dev\/PainelCodes'/.test(dev) && /view==='codes' && <div style=\{\{ padding:16 \}\}><PainelCodes\/>/.test(dev),
    'aba Codes dentro da Central de Desenvolvimento (não é tela solta)')
  ok(existsSync('src/app/dashboard/dev/codes/page.tsx') && /export \{ default \} from '\.\.\/page'/.test(ler('src/app/dashboard/dev/codes/page.tsx')),
    'rota /dashboard/dev/codes é a mesma Central')
  ok(/Code: <nome da rotina>/.test(ler('AGENTS.md')), 'AGENTS.md: toda PR leva a linha "Code: <nome da rotina>"')

  // (6) topo da aba (CEO 08/10): faixa da esteira e resumo por Code — RD-83
  {
    const ag = new Date('2026-10-08T15:00:00-03:00')
    const min = (m: number) => new Date(ag.getTime() - m * 60_000).toISOString()
    const msg = (id: string, para: string, status: string, m: number): Mensagem =>
      ({ id, para, assunto: `assunto ${id}`, status, pr_numero: null, resposta: null, criado_em: min(m), atualizado_em: min(m) })
    const lease = (agente: string, m: number): Lease => ({ agente, sessao_ref: 's', iniciada_em: min(m + 5), renovada_em: min(m) })
    const base = { entregas: [] as Entrega[], agora: ag }
    const r = (code: string, msgs: Mensagem[], leases: Lease[]) => resumoCode({ ...base, code, msgs, leases })
    ok(r('gilberto-desenv', [], [lease('gilberto-desenv', 2)]).status === 'trabalhando', 'RD-83: sessão ativa → Trabalhando')
    ok(r('jordana-code', [msg('a', 'jordana-code', 'nova', 20)], []).status === 'travado', 'RD-83: nova não lida há 20 min → Travado')
    const antiga = r('rodrigo-code', [msg('b', 'rodrigo-code', 'recebida', 30 * 60)], [])
    ok(antiga.status === 'dormindo' && antiga.filaAntiga === 1 && antiga.fila === 0, 'RD-83: recebida > 24 h vira fila antiga, nunca Travado')
    ok(r('gilberto-produto', [msg('c', 'gilberto-produto', 'nova', 5)], []).status === 'dormindo', 'nova há 5 min ainda não é Travado')
    ok(esteira({ ...base, entregas: [{ id: 1, pr_numero: 1, titulo: 't', code: 'x', evento: 'publicada', via: 'rapida', sha: 'a', url: null, ocorrido_em: min(10) }] }).cor === 'verde', 'esteira verde: publicou na última hora')
    ok(esteira({ ...base }).cor === 'amarela', 'esteira amarela: sem publicação há mais de 1 h')
    ok(esteira({ ...base, mainVerde: false }).cor === 'vermelha' && esteira({ ...base, testeParadoMin: 100 }).cor === 'vermelha', 'esteira vermelha: main vermelha ou teste parado > 90 min')
  }

  await esteiraChecks()
  if (falhas) { console.error(`\ncheck-aba-codes: ${falhas} falha(s)`); process.exit(1) }
  console.log('\nAba Codes: ok')
}

main().catch((e) => { console.error(e); process.exit(1) })

// ── (6) esteira: teste da main e fila de testes (CEO 08/10) ──────────────────────────────────────────────────────────
async function esteiraChecks() {
  const mig = readdirSync('supabase/migrations').find((f) => f.endsWith('_dev_esteira_status.sql'))
  const q = (mig ? ler(join('supabase/migrations', mig)) : '').replace(/--[^\n]*/g, '')
  ok(!!mig && /^\d{12}05_/.test(mig), 'esteira: migration na faixa 05')
  ok(/ENABLE ROW LEVEL SECURITY/.test(q) && /REVOKE ALL ON TABLE public\.erp_dev_esteira_status FROM PUBLIC, anon, authenticated/.test(q)
    && /FOR SELECT TO authenticated USING \(public\.fn_dev_painel_pode_ver\(\)\)/.test(q) && !/TO anon/.test(q), 'esteira: RLS, sem anon, leitura só equipe PS')
  const wf = existsSync('.github/workflows/registrar-esteira.yml') ? ler('.github/workflows/registrar-esteira.yml') : ''
  ok(/workflow_run:/.test(wf) && !/pull_request_target/.test(wf) && !/ref: \$\{\{ github\.event\.workflow_run/.test(wf), 'esteira: workflow_run, checkout só da main')
  const { veredito } = await import('../dev/registrar-esteira.mjs')
  ok(veredito([{ status: 'completed', conclusion: 'cancelled' }, { status: 'completed', conclusion: 'failure', html_url: 'u' }])?.verde === false, 'esteira: cancelado é ignorado, failure = vermelho')
  ok(veredito([{ status: 'completed', conclusion: 'success' }])?.verde === true && veredito([]) === null, 'esteira: success = verde; sem run = sem dado')
  ok(esteira({ entregas: [], agora: new Date(), mainVerde: false, filaTestes: 3 }).cor === 'vermelha', 'esteira: main vermelha deixa a faixa vermelha')
  const pt = ler('src/components/dev/PainelCodes.tsx')
  ok(pt.indexOf('<LinhaDoTempo') < pt.indexOf('CartaoCode key') && /erp_dev_esteira_status/.test(pt) && /ver todas/.test(pt), 'tela: publicações do dia acima dos cartões, assina a esteira, "ver todas" no celular')
}
