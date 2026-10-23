// Gate (Eng. Chefe 17/10 · P1): o segredo do robô (x-watcher-secret) não pode voltar a ser literal no código.
// Vem do cofre (fn_watcher_secret) no banco e de WATCHER_SECRET/WATCHER_SECRET_NOVO na Vercel/edge. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261017230000_watcher_secret_para_o_cofre.sql', 'utf8')
ok(/REVOKE ALL ON FUNCTION public\.fn_watcher_secret\(\) FROM PUBLIC, anon, authenticated/.test(mig), 'fn_watcher_secret não é executável por anon/authenticated')
ok(/vault\.decrypted_secrets WHERE name = 'screen_watcher_secret'/.test(mig), 'lê do cofre screen_watcher_secret')
ok(!/'x-watcher-secret'\s*,\s*'[A-Za-z0-9]/.test(mig.replace(/\$re\$.*?\$re\$/gs, '')), 'migration não carrega valor do segredo')

const edges = ['auditoria-gold-jornada', 'sugestao-analisar']
for (const e of edges) {
  const s = readFileSync(`supabase/functions/${e}/index.ts`, 'utf8')
  ok(!/ps-watcher-\d/.test(s) && /Deno\.env\.get\("WATCHER_SECRET"\)/.test(s), `edge ${e} sem segredo fixo (fail-closed sem env)`)
}

const rotas = ['screen-watcher/playwright', 'gold/auditar-rota', 'gold/trace-rota', 'gold/juiz-revenda', 'screen-watcher/remover-fotos', 'demo/revenda/fotos', 'demo/revenda/logo-crlv', 'cron/screen-watcher']
for (const r of rotas) {
  const s = readFileSync(`src/app/api/${r}/route.ts`, 'utf8')
  ok(s.includes('watcherSecretValido('), `rota ${r} valida pelo helper (aceita o segredo novo)`)
}

function varre(dir: string, acha: string[]) {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name)
    if (d.isDirectory()) varre(p, acha)
    else if (/\.(ts|tsx)$/.test(d.name) && /ps-watcher-\d{4}/.test(readFileSync(p, 'utf8'))) acha.push(p)
  }
}
const achados: string[] = []
varre('src', achados); varre('supabase/functions', achados)
ok(achados.length === 0, `nenhum segredo fixo em src/ e supabase/functions/ ${achados.join(', ')}`)

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
