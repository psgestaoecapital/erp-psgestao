// Simulador da fila de merge para os gates (check-fila-sem-bloqueio, check-fila-sem-etiqueta): roda o
// scripts/merge/fila-merge.sh DE VERDADE contra um `gh` falso (fixtures em JSON), num repositório git temporário.
// Fica fora de scripts/gates/ (o rodar-gates executa todo arquivo daquela pasta como gate).
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const SCRIPT_FILA = resolve('scripts/merge/fila-merge.sh')
export const temFerramentas = () => ['jq', 'git'].every((b) => spawnSync('sh', ['-c', `command -v ${b}`]).status === 0)

export type PrSimulada = {
  n: number
  atras?: number
  checksRodando?: boolean
  migration?: boolean
  migrationCorrige?: boolean   // migration MODIFICADA que o commit do deploy vermelho da main trouxe (conserto, #2542)
  migrationBaixa?: boolean     // versão da migration NÃO maior que a última da main (incidente 08/10)
  draft?: boolean
  labels?: string[]            // padrão: ['fila-merge'] (como antes da etiqueta opcional)
  comentarios?: string[]       // corpos de comentários já existentes na PR
  aceitacao?: 'success' | 'in_progress' | 'failure'
  autorizada?: boolean         // injeta o comentário MERGE AUTORIZADO do revisor com o patch-id correto do conteúdo
  specsProprios?: string[]     // arquivos e2e/*.spec.ts que a PR criou/alterou (vão para pulls/<n>/files)
  arquivos?: string[]          // arquivos extras no diff da PR (regime de construção: testar núcleo × elegível)
  aceitacaoSpecs?: string[]    // specs que FALHARAM na aceitação da PR (anotações do check-run) — regra do teste próprio
  aceitacaoSpecsDesktop?: string[]  // specs que falharam no projeto computador (anotação sem a marca [celular])
  aceitacaoAnotCompleta?: string[]   // linhas da anotação PW-FALHAS-COMPLETAS (publicada pela aceitação; a fila a lê no lugar do log do job)
  aceitacaoTotal?: number      // "N failed" do resumo Playwright da aceitação da PR (p/ a guarda de truncamento); padrão = nº de specs nomeados
  aceitacaoSemLog?: boolean    // log do job da aceitação ilegível/ausente (a lista completa vem do LOG, P3 18/10) → fila bloqueia
  sqlMigration?: string        // SQL da migration da PR (lote de migrations independentes, CEO 16/10); padrão: select 1;
  autorCode?: string           // Code autor em erp_dev_entrega (para o acionamento automático do @pos, Parte 2)
  mergeavel?: boolean          // pulls/<n>.mergeable (CEO 22/10, vazão): atrás-mas-limpa (true) mergeia sem update; false/null = update-first
}
// Estado do @pos-migration da main (janela da linha-de-base, CEO 15/10). Com conclusion='failure', a fila lê o log do
// job falho e compara os specs com a linha-de-base (FILA_POS_BASELINE).
export type PosMain = { conclusion?: 'success' | 'failure' | 'cancelled'; specs?: string[]; headPr?: number }
export type Rodada = { log: string; escritas: string[]; status: number; curl: string[] }

export function comFilaSimulada<T>(fn: (rodar: (prs: PrSimulada[], mainOcupada?: boolean, cota?: number, env?: Record<string, string>, posMain?: PosMain) => Rodada) => T): T {
  const raiz = mkdtempSync(join(tmpdir(), 'fila-gate-'))
  try {
    const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim()
    const o = join(raiz, 'o'); const w = join(raiz, 'w')
    execFileSync('git', ['init', '-q', '-b', 'main', o])
    for (const [k, v] of [['user.email', 'g@g'], ['user.name', 'gate']]) git(o, 'config', k, v)
    writeFileSync(join(o, 'a'), 'a\n'); git(o, 'add', '.'); git(o, 'commit', '-qm', 'base')
    const sha: Record<number, string> = {}
    const pid: Record<number, string> = {}   // patch-id do conteúdo de cada PR (igual ao que a fila calcula: diff do merge-base)
    for (const n of [1, 2, 3, 4]) {
      git(o, 'checkout', '-q', '-b', `pr${n}`, 'main'); writeFileSync(join(o, `f${n}`), `${n}\n`)
      git(o, 'add', '.'); git(o, 'commit', '-qm', `pr${n}`); sha[n] = git(o, 'rev-parse', 'HEAD')
      git(o, 'update-ref', `refs/pull/${n}/head`, 'HEAD')
      const base = git(o, 'merge-base', 'main', `pr${n}`)
      const diff = execFileSync('git', ['diff', base, `pr${n}`], { cwd: o })
      pid[n] = execFileSync('git', ['patch-id', '--stable'], { cwd: o, input: diff, encoding: 'utf8' }).trim().split(/\s+/)[0]
    }
    git(o, 'checkout', '-q', 'main'); execFileSync('git', ['clone', '-q', o, w])
    const main0 = git(o, 'rev-parse', 'main')   // main do início da rodada (= $MAIN0 na fila): o `atras` é medido contra ela

    // gh simulado: GET lê <fx>/<caminho normalizado>.json (com --jq aplicado); escrita é registrada e responde {}
    const bin = join(raiz, 'bin'); const fx = join(raiz, 'fx')
    execFileSync('mkdir', ['-p', bin, fx])
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env bash
shift; m=GET; jqe=; path=; campos=()
while [ $# -gt 0 ]; do case "$1" in -X) m=$2; shift 2;; -H) shift 2;; --paginate) shift;; --jq) jqe=$2; shift 2;; -f|-F) campos+=("$2"); shift 2;; *) path=$1; shift;; esac; done
echo "$m $path \${campos[*]}" >> "$FX/chamadas.log"
[ "$m" = GET ] || { echo '{}'; exit 0; }
f="$FX/$(echo "$path" | sed 's/[^A-Za-z0-9]/_/g').json"
[ -f "$f" ] || { echo "SEM FIXTURE: $path" >&2; exit 1; }
if [ -n "$jqe" ]; then jq -r "$jqe" "$f"; else cat "$f"; fi
`)
    chmodSync(join(bin, 'gh'), 0o755)

    // curl simulado: a fila usa curl só com SUPABASE_URL (flush_estado e acionar_autor_pos). Loga cada chamada e responde:
    //  - GET erp_dev_entrega?pr_numero=eq.N → <fx>/autor_N.json (o Code autor) ou [];
    //  - POST rpc/fn_agente_mensagem_enviar → {ok:true} (acionamento do Code); o resto → {}.
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
m=GET; url=; data=
while [ $# -gt 0 ]; do case "$1" in -X) m=$2; shift 2;; -H) shift 2;; -d|--data) data=$2; shift 2;; http*) url=$1; shift;; -*) shift;; *) shift;; esac; done
echo "$m $url $data" >> "$FX/curl.log"
case "$url" in
  *rest/v1/erp_dev_entrega*) pr=$(sed -nE 's/.*pr_numero=eq\\.([0-9]+).*/\\1/p' <<< "$url"); [ -f "$FX/autor_$pr.json" ] && cat "$FX/autor_$pr.json" || echo '[]';;
  *rpc/fn_agente_mensagem_enviar*) echo '{"ok":true,"id":"00000000-0000-0000-0000-000000000000"}';;
  *) echo '{}';;
esac
`)
    chmodSync(join(bin, 'curl'), 0o755)

    const R = 'repos/o/r'
    const rodar = (prs: PrSimulada[], mainOcupada = false, cota = 5000, envExtra: Record<string, string> = {}, posMain: PosMain = {}): Rodada => {
      rmSync(fx, { recursive: true, force: true }); execFileSync('mkdir', ['-p', fx])
      const put = (p: string, v: unknown) => writeFileSync(join(fx, `${p.replace(/[^A-Za-z0-9]/g, '_')}.json`), JSON.stringify(v))
      // aceitação da main sem run (mesmo efeito de antes, quando faltava a fixture): sem ela o `api` repetia 3x com
      // sleep 2+4 s em cada leitura e os gates da fila com FILA_ACEITACAO_BLOQUEIA=1 estouravam os 180 s (23/10).
      put(`${R}/actions/workflows/aceitacao-main.yml/runs?branch=main&status=completed&per_page=10`, { workflow_runs: [] })
      put(`${R}/pulls?state=open&base=main&per_page=100`, prs.map((p, i) => ({
        number: p.n, title: `PR ${p.n}`, draft: !!p.draft, created_at: `2026-10-07T09:0${i}:00Z`, base: { ref: 'main' },
        head: { ref: `pr${p.n}`, sha: sha[p.n], repo: { full_name: 'o/r' } }, labels: (p.labels ?? ['fila-merge']).map((name) => ({ name })) })))
      prs.forEach((p, i) => {
        const labels = p.labels ?? ['fila-merge']
        put(`${R}/issues/${p.n}/events?per_page=100`, labels.includes('fila-merge')
          ? [{ event: 'labeled', label: { name: 'fila-merge' }, created_at: `2026-10-07T10:0${i}:00Z` }] : [])
        const coments = [...(p.comentarios ?? [])]
        if (p.autorizada) coments.push(`MERGE AUTORIZADO #${p.n} — gilberto-revisor · patch-id ${pid[p.n]}`)
        put(`${R}/issues/${p.n}/comments`, coments.map((body) => ({ body })))
        put(`${R}/pulls/${p.n}`, { number: p.n, title: `PR ${p.n}`, draft: !!p.draft, mergeable: p.mergeavel ?? true, base: { ref: 'main' },
          head: { sha: sha[p.n], repo: { full_name: 'o/r' } }, labels: labels.map((name) => ({ name })) })
        const arq = p.migration ? `${(p.migrationBaixa ? 20261001000000 : 20261009000000) + p.n}_m.sql` : ''
        const files: unknown[] = [{ status: p.migrationCorrige ? 'modified' : 'added', filename: p.migration ? `supabase/migrations/${arq}` : `src/${p.n}.ts` }]
        for (const s of p.specsProprios ?? []) files.push({ status: 'added', filename: s })
        for (const f of p.arquivos ?? []) files.push({ status: 'added', filename: f })   // arquivos extras (regime de construção: núcleo × elegível)
        put(`${R}/pulls/${p.n}/files`, files)
        if (arq) put(`${R}/contents/supabase/migrations/${arq}?ref=pr${p.n}`, { content: 'c2VsZWN0IDE7Cg==', sha: 'abc123' })
        if (arq) put(`${R}/contents/supabase/migrations/${arq}?ref=${sha[p.n]}`, { content: Buffer.from(p.sqlMigration ?? 'select 1;\n').toString('base64'), sha: 'abc123' })
        put(`${R}/git/trees/main:supabase/migrations`, { tree: [{ path: '20261008150005_ultima.sql' }, { path: 'README.md' }] })
        put(`${R}/compare/main...${sha[p.n]}`, { behind_by: p.atras ?? 0 })
        put(`${R}/compare/${main0}...${sha[p.n]}`, { behind_by: p.atras ?? 0 })   // a fila compara contra MAIN0 (constante na rodada)
        if (p.autorCode) put(`autor_${p.n}`, [{ code: p.autorCode }])   // vira autor_N.json no fx (lido pelo curl simulado)
        const acc = p.aceitacao ?? 'in_progress'
        const accCompleta = acc === 'success' || acc === 'failure'
        // regra do teste próprio (CEO 16/10): aceitação falha com specs → o check aponta p/ um run cujas anotações têm os specs
        const accRun = 70000 + p.n, accJob = 97000 + p.n
        const accUrl = (p.aceitacaoSpecs?.length || p.aceitacaoSpecsDesktop?.length) ? `https://github.com/o/r/actions/runs/${accRun}/job/${accJob}` : ''
        if (p.aceitacaoSpecs?.length || p.aceitacaoSpecsDesktop?.length) {
          put(`${R}/actions/runs/${accRun}/jobs`, { jobs: [{ id: accJob, conclusion: 'failure' }] })
          const nomeados = (p.aceitacaoSpecs?.length ?? 0) + (p.aceitacaoSpecsDesktop?.length ?? 0)
          const total = p.aceitacaoTotal ?? nomeados
          // LOG do job (P3, 18/10): relatório "list" do Playwright com TODAS as falhas numeradas + resumo "N failed", com o
          // prefixo de data e ANSI do log real. As anotações abaixo são cortadas em 10 (teto real do GitHub).
          if (!p.aceitacaoSemLog) {
            const nomes = [...(p.aceitacaoSpecs ?? []).map((s) => `[celular] › ${s}`), ...(p.aceitacaoSpecsDesktop ?? []).map((s) => `[computador] › ${s}`)]
            const linhas = ['Running 208 tests using 2 workers', ...nomes.map((nm, i) => `\u001b[31m  ${i + 1}) ${nm}:10:7 › x ─────\u001b[39m`), `  ${total} failed`, ...nomes.map((nm) => `    ${nm}:10:7 › x`), '  197 passed']
            writeFileSync(join(fx, `${`${R}/actions/jobs/${accJob}/logs`.replace(/[^A-Za-z0-9]/g, '_')}.json`),
              linhas.map((l) => `2026-10-19T00:00:00.0000000Z ${l}`).join('\n') + '\n')
          }
          put(`${R}/check-runs/${accJob}/annotations`, [
            ...[...(p.aceitacaoSpecs ?? []).map((s) => ({ annotation_level: 'failure', path: s, title: `[celular] › ${s}:10:7`, message: `  [celular] › ${s}:10:7 › x` })),
              ...(p.aceitacaoSpecsDesktop ?? []).map((s) => ({ annotation_level: 'failure', path: s, title: `[computador] › ${s}:10:7`, message: `  [computador] › ${s}:10:7 › x` }))].slice(0, 10),
            // resumo Playwright da aceitação (guarda de truncamento, Eng. Chefe 18/10): o "N failed" é a verdade do total
            { annotation_level: 'notice', path: '.github', title: '🎭 Playwright Run Summary', message: `  ${total} failed\n  197 passed` },
            ...(p.aceitacaoAnotCompleta ? [{ annotation_level: 'failure', path: '.github', title: 'PW-FALHAS-COMPLETAS', message: p.aceitacaoAnotCompleta.join('\n') }] : [])])
        }
        put(`${R}/commits/${sha[p.n]}/check-runs?per_page=100`, { check_runs: [
          { name: 'check_menu', status: p.checksRodando ? 'in_progress' : 'completed', conclusion: p.checksRodando ? null : 'success', details_url: '' },
          { name: 'aceitacao', status: accCompleta ? 'completed' : 'in_progress', conclusion: accCompleta ? acc : null, details_url: accUrl },
          { name: 'gates', status: 'completed', conclusion: 'success', details_url: '' }] })
        put(`${R}/commits/${sha[p.n]}/status`, { statuses: [{ context: 'Vercel', state: 'success', description: 'Deployment has completed' }] })
      })
      put('rate_limit', { resources: { core: { remaining: cota } } })
      const vermelho = prs.some((p) => p.migrationCorrige)   // deploy da main vermelho: o commit dele trouxe a migration do conserto
      put(`${R}/actions/workflows/deploy-migrations.yml/runs?branch=main&per_page=1`,
        { workflow_runs: [{ id: 1, head_sha: 'dead0001', status: mainOcupada ? 'in_progress' : 'completed', conclusion: mainOcupada ? null : vermelho ? 'failure' : 'success' }] })
      put(`${R}/commits/dead0001`, { files: prs.filter((p) => p.migrationCorrige).map((p) => ({ filename: `supabase/migrations/${20261009000000 + p.n}_m.sql` })) })
      const posConc = posMain.conclusion ?? 'success'
      put(`${R}/actions/workflows/aceitacao-pos-migration.yml/runs?branch=main&per_page=1`, { workflow_runs: [{ id: 2, head_sha: 'deadpos1', status: 'completed', conclusion: posConc }] })
      if (posConc === 'failure') {
        // job falho + ANOTAÇÕES do check-run (id do job == id do check-run) + head e PR do head (a que entrou por último)
        put(`${R}/actions/runs/2/jobs`, { jobs: [{ id: 9002, conclusion: 'failure' }] })
        const specs = posMain.specs ?? []
        const ann: unknown[] = specs.map((s) => ({ annotation_level: 'failure', path: s, title: `[celular] › ${s}:10:7`, message: `  [celular] › ${s}:10:7 › x @pos-migration` }))
        ann.push({ annotation_level: 'notice', path: '.github', title: '🎭 Playwright Run Summary', message: `  ${specs.length} failed\n${specs.map((s) => `    [celular] › ${s}:10:7 › x`).join('\n')}\n  197 passed` })
        put(`${R}/check-runs/9002/annotations`, ann)
        put(`${R}/actions/runs/2`, { head_sha: 'deadpos1', run_attempt: 1 })
        put(`${R}/commits/deadpos1/pulls`, [{ number: posMain.headPr ?? prs[0]?.n ?? 1 }])
      }
      // Padrão: agora DEPOIS da janela da via revisada (reaberta CEO 22/10 até 2026-10-23T20:00:00Z) e sem publicações na
      // última hora, para os gates existentes verem o comportamento normal. Os testes da janela/ritmo passam FILA_AGORA_EPOCH / FILA_PUB_HORA em envExtra.
      const envPadrao = { FILA_AGORA_EPOCH: String(Math.floor(Date.UTC(2026, 9, 25) / 1000)), FILA_PUB_HORA: '0' }
      const r = spawnSync('bash', [SCRIPT_FILA], { cwd: w, encoding: 'utf8',
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FX: fx, GH_TOKEN: 'x', REPO: 'o/r', GITHUB_STEP_SUMMARY: '', ...envPadrao, ...envExtra } })
      const log = `${r.stdout}${r.stderr}`
      if (r.status !== 0) console.error(log)
      const escritas = readFileSync(join(fx, 'chamadas.log'), 'utf8').split('\n').filter((l) => l && !l.startsWith('GET '))
      let curl: string[] = []
      try { curl = readFileSync(join(fx, 'curl.log'), 'utf8').split('\n').filter(Boolean) } catch { /* sem curl nesta rodada */ }
      return { log, escritas, status: r.status ?? 1, curl }
    }
    return fn(rodar)
  } finally {
    rmSync(raiz, { recursive: true, force: true })
  }
}

export const merges = (e: string[]) => e.filter((l) => /\/merge merge_method/.test(l)).map((l) => Number(l.match(/pulls\/(\d+)\/merge/)?.[1]))
export const updates = (e: string[]) => e.filter((l) => /update-branch/.test(l)).map((l) => Number(l.match(/pulls\/(\d+)\/update-branch/)?.[1]))
export const comentariosEm = (e: string[], n: number) => e.filter((l) => l.startsWith(`POST repos/o/r/issues/${n}/comments`))
// Parte 2 (CEO 16/10): acionamentos automáticos de Code via fn_agente_mensagem_enviar (linhas do curl simulado).
export const acionamentos = (c: string[]) => c.filter((l) => /rpc\/fn_agente_mensagem_enviar/.test(l))
