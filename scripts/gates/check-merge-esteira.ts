// Gate · regras de merge da esteira (CEO 06/10, "destravar a esteira"). Sem rede: testa as regras puras de scripts/merge/lib.ts.
import { readFileSync } from 'node:fs'
import { decidirPosMigration, exigencias, areasDaPr, autorizada, proximoPasso } from '../merge/lib'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const run = (id: number, status: string, conclusion: string | null, t: string) => ({ id, head_sha: 'a'.repeat(40), status, conclusion, created_at: t })

// (1) cancelado ≠ vermelho
ok(decidirPosMigration([run(1, 'completed', 'cancelled', '2026-10-06T10:00:00Z')]).acao === 'rerodar', '1) último run CANCELADO e nenhum verde → re-roda')
ok(decidirPosMigration([run(1, 'completed', 'cancelled', '2026-10-06T10:00:00Z')]).runId === 1, '1) re-roda o run cancelado certo')
ok(decidirPosMigration([run(1, 'completed', 'success', '2026-10-06T09:00:00Z'), run(2, 'completed', 'cancelled', '2026-10-06T10:00:00Z')]).acao === 'liberado', '1) já teve verde → libera')
ok(decidirPosMigration([run(1, 'completed', 'failure', '2026-10-06T10:00:00Z')]).acao === 'vermelho', '1) falha de verdade continua vermelha')
ok(decidirPosMigration([run(1, 'in_progress', null, '2026-10-06T10:00:00Z')]).acao === 'aguardar', '1) em andamento → aguarda')

// (2) PR sem migration não espera a janela de produção
ok(!exigencias(['src/app/pm/page.tsx', 'supabase/migrations/README.md']).esperaPosMigration, '2) sem .sql em supabase/migrations → não espera @pos-migration')
ok(exigencias(['supabase/migrations/20261006200000_x.sql']).esperaPosMigration, '2) com migration → espera @pos-migration')
ok(areasDaPr(['src/app/(app)/pm/jobs/page.tsx', 'src/lib/pm/social.ts']).join() === 'pm', '2) área inferida do caminho')

// (3) autorização por conteúdo (patch-id), não por SHA
const P = 'b'.repeat(40)
const c = [{ login: 'chefe', body: `MERGE AUTORIZADO #12\npatch-id: ${P}`, created_at: '2026-10-06T10:00:00Z' }]
ok(autorizada(12, P, c, ['chefe']).ok, '3) mesmo patch-id (atualizou com a main) → vale')
ok(!autorizada(12, 'c'.repeat(40), c, ['chefe']).ok, '3) código mudou → nova revisão')
ok(!autorizada(12, P, c, ['outro']).ok, '3) comentário de quem não é autorizador não vale')
ok(!autorizada(13, P, c, ['chefe']).ok, '3) autorização de outra PR não vale')

// CLIs presentes e sem token no código
for (const f of ['pos-migration.ts', 'patch-id.ts', 'gh.ts']) ok(readFileSync(`scripts/merge/${f}`, 'utf8').length > 0, `CLI ${f} existe`)
ok(!/ghp_|github_pat_/.test(readFileSync('scripts/merge/gh.ts', 'utf8')), 'nenhum token no código')
void proximoPasso
if (falhas) process.exit(1)
