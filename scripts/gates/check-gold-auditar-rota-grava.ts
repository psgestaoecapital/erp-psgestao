// Gate (P0 Gold 24/10) — o robô Gold (/api/gold/auditar-rota) GRAVA o veredito e abre o Hub na Construtora DEMO.
// Antes: o login do bot (signInWithPassword) rodava no MESMO cliente service_role; o Authorization virava o JWT do
// bot (authenticated) e, desde a 20260928120000 (authenticated sem escrita nas gold_*), todo INSERT em
// gold_camada2_validacoes era recusado em silêncio (último registro 27/09). E o Hub caía na demo Comércio (custo R$ 0).
import { readFileSync } from 'node:fs'
import {
  empresaBotDaRota, EMPRESA_BOT_CONSTRUTORA, EMPRESA_BOT_GE, EMPRESA_BOT_OFICINA, EMPRESA_BOT_PM, EMPRESA_BOT_REVENDA,
} from '../../src/lib/gold/empresaBotDaRota'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const src = readFileSync('src/app/api/gold/auditar-rota/route.ts', 'utf8')

ok(/const authClient = createClient\(/.test(src), 'cliente separado para o login do bot')
ok(/authClient\.auth\.signInWithPassword\(/.test(src), 'login do bot no authClient')
ok(!/supabase\.auth\.signInWithPassword\(/.test(src), 'login do bot NUNCA no cliente service_role que grava')
const inserts = src.match(/\.from\('gold_camada2_validacoes'\)\.insert\(/g) ?? []
const insertsChecados = src.match(/const \{ error: insErr \} = await supabase\.from\('gold_camada2_validacoes'\)\.insert\(/g) ?? []
ok(inserts.length >= 2 && inserts.length === insertsChecados.length, 'todo INSERT em gold_camada2_validacoes confere o erro')
ok(/erros_gravacao/.test(src), 'resumo devolve erros_gravacao (falha de gravação não fica silenciosa)')
ok(/empresaBotDaRota\(rota\)/.test(src), 'empresa do robô vem de empresaBotDaRota')
ok(/empresaPermitidaParaRobo\(supabase, empresaAudit\)/.test(src), 'segue fail-closed: só empresa is_demo')

const casos: Array<[string, string]> = [
  ['/dashboard/projetos', EMPRESA_BOT_CONSTRUTORA],
  ['/dashboard/projetos/calculadora', EMPRESA_BOT_CONSTRUTORA],
  ['/dashboard/projetos/viagens', EMPRESA_BOT_CONSTRUTORA],
  ['/dashboard/projetos/obras/abc/cronograma', EMPRESA_BOT_CONSTRUTORA],
  ['/dashboard/projetosx', EMPRESA_BOT_GE],
  ['/dashboard/oficina/recepcao', EMPRESA_BOT_OFICINA],
  ['/dashboard/pm', EMPRESA_BOT_PM],
  ['/dashboard/pm/leads', EMPRESA_BOT_PM],
  ['/dashboard/producao', EMPRESA_BOT_PM],
  ['/dashboard/revenda/patio', EMPRESA_BOT_REVENDA],
  ['/dashboard/financeiro', EMPRESA_BOT_GE],
]
for (const [rota, esperado] of casos) ok(empresaBotDaRota(rota) === esperado, `${rota} → ${esperado.slice(-3)}`)
ok(EMPRESA_BOT_CONSTRUTORA === 'b0700000-0000-4000-a000-000000000006', 'Hub = Construtora Modelo DEMO (006)')

if (falhas) { console.error(`\n${falhas} falha(s) — check-gold-auditar-rota-grava`); process.exit(1) }
console.log('\ncheck-gold-auditar-rota-grava: OK')
