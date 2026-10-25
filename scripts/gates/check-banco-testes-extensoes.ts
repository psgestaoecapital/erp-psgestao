// Gate (25/10, gilberto-desenv, msg 3e5e6c6a): extensões e rotinas dos agentes no banco de testes. A aceitação da main #818
// (run 40134440043) deu 106 falhas iguais no [computador] e no [celular]: os 3 bancos de teste não tinham o pg_trgm
// ("function similarity(text, text) does not exist" em conciliação/inbox/P&M) e a erp_agente_rotina estava vazia (23503
// em erp_agente_dono/erp_agente_mensagem). Regras: pg_trgm e unaccent em public (como na produção), garantidos antes de
// todo `db push` das vagas (via garantir-org-demo.sh), idempotente, só no banco de TESTES; erp_agente_rotina na whitelist.
// Sem rede, banco ou variável.
import { readFileSync, statSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗ ' + msg) } else console.log('✓ ' + msg) }
const ler = (f: string) => readFileSync(f, 'utf8')
const SCRIPT = 'scripts/banco-testes/garantir-extensoes.sh'

const sh = ler(SCRIPT)
const corpo = sh.replace(/^#[^\n]*$/gm, '')
ok((statSync(SCRIPT).mode & 0o111) !== 0, 'garantir-extensoes.sh é executável')
ok(/\*horsymhsinqcimflrtjo\*\) echo "::error::[^"]*PRODUÇÃO[^"]*"; exit 1/.test(sh), 'script: aborta se a URL for a produção')
ok(/\*pooler\.supabase\.com\*\) ;;/.test(sh), 'script: só Session pooler de teste')
ok(/CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;/.test(corpo), 'script: pg_trgm em public (como na produção)')
ok(/CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;/.test(corpo), 'script: unaccent em public (como na produção)')
ok(!/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/i.test(corpo), 'script: não apaga nem altera nada')
ok(/SET statement_timeout = '15s';[\s\S]*SET lock_timeout = '5s';/.test(corpo), 'script: statement_timeout e lock_timeout curtos')
ok(/public\.similarity\(/.test(corpo) && /\[ "\$s" = t \] \|\| \{ echo "::error::/.test(sh), 'script: falha explícito se similarity não responder')

// roda antes de todo db push: garantir-org-demo.sh (que o gate check-banco-testes-org-demo prende antes de cada push) chama
const org = ler('scripts/banco-testes/garantir-org-demo.sh')
ok(/^TEST_DATABASE_URL="\$TEST_DATABASE_URL" "\$\(dirname "\$0"\)\/garantir-extensoes\.sh"$/m.test(org), 'garantir-org-demo.sh chama garantir-extensoes.sh')

// montagem do zero cria o pg_trgm no mesmo schema
ok(/CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;/.test(ler('scripts/banco-testes/montar-do-zero.sh')), 'montar-do-zero: pg_trgm em public')

// rotinas dos agentes na whitelist de catálogos (FK de erp_agente_dono/erp_agente_mensagem)
const cat = ler('scripts/banco-testes/catalogos.txt').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
ok(cat.includes('erp_agente_rotina'), 'catalogos.txt: erp_agente_rotina na whitelist')
ok(!cat.includes('erp_agente_mensagem'), 'catalogos.txt: mensagens de agentes seguem fora')

if (falhas) { console.error(`\n${falhas} falha(s) no gate check-banco-testes-extensoes`); process.exit(1) }
console.log('\ncheck-banco-testes-extensoes: ok')
