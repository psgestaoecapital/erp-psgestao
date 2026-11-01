// Gate (Eng. Chefe 18/10) — audit_log_global é APPEND-ONLY (RD-54): fica FORA da foto e da restauração da vaga.
// Antes, uma migration da PR com INSERT INTO audit_log_global entrava em pr_insert_tables e a restauração fazia DELETE
// nela (o trigger recusa) → vaga re-suja a cada teste. Sem bypass de trigger. Estático (extrai a função do script).
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

const src = readFileSync('scripts/banco-testes/vaga-snapshot.sh', 'utf8')
ok(/APPEND_ONLY_RE='[^']*audit_log_global[^']*'/.test(src), 'vaga-snapshot: audit_log_global declarado como append-only')
ok(/fn_bloqueia_delete_fisico/.test(src) && /guarded/.test(src), 'vaga-snapshot: tabela com trava de DELETE físico (RD-30) fica fora da foto de catálogo')
ok(!/disable trigger|session_replication_role/i.test(src), 'vaga-snapshot: sem bypass de trigger')

const m = src.match(/^APPEND_ONLY_RE=.*$/m)
const f = src.match(/pr_insert_tables\(\) \{[\s\S]*?\n\}/)
ok(!!m && !!f, 'vaga-snapshot: função pr_insert_tables localizada')
if (m && f) {
  const dir = mkdtempSync(join(tmpdir(), 'vaga-'))
  mkdirSync(join(dir, 'm'))
  writeFileSync(join(dir, 'm', '20261018000000_x.sql'),
    "insert into public.erp_ajuda_campo(a) values (1);\ninsert into audit_log_global(a) values (1);\nINSERT INTO public.\"audit_log_global\" (a) values (2);\n")
  const out = execFileSync('bash', ['-c', `${m[0]}\nMAIN_MIGR_DIR=${dir}/vazio\nCHECKOUT_MIGR_DIR=${dir}/m\npr_migr_files() { ls ${dir}/m/*.sql; }\n${f[0]}\npr_insert_tables`], { encoding: 'utf8' }).trim().split('\n')
  ok(out.length === 1 && out[0] === 'erp_ajuda_campo', `catálogo da PR exclui audit_log_global (obtido: ${out.join(',')})`)
}
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
