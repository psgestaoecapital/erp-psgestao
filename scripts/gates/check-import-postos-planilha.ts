// Gate (CEO 08/11, c1e941c5) — Importar quadro por planilha em /dashboard/produtividade/importar.
// Garante que a tela só CONSOME a RPC já guardada fn_rh_importar_postos (RD-26: sem alterar backend), que a
// migration é aditiva (só ajuda + system_screens) e que a tela tem modelo (download) + upload + "?" (RD-95).
// Sem rede, só leitura estática.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const ler = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

// ── migration: aditiva (só ajuda + system_screens), sem mexer em função/tabela/RLS ───────────────────
const dir = 'supabase/migrations'
const arq = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('_prod_import_postos_planilha_ajuda_screen.sql')) : undefined
ok(!!arq, `migration prod_import_postos_planilha presente (${arq ?? '—'})`)
const sql = (arq ? ler(join(dir, arq)) : '').replace(/--[^\n]*/g, '')
ok(/INSERT INTO public\.erp_ajuda_campo/.test(sql), 'insere ajuda RD-95')
ok(/INSERT INTO public\.system_screens/.test(sql) && /\/dashboard\/produtividade\/importar/.test(sql), 'registra a rota em system_screens')
ok(!/CREATE OR REPLACE FUNCTION|CREATE FUNCTION/.test(sql), 'NÃO cria/altera função (RD-26: reusa fn_rh_importar_postos)')
ok(!/\b(DROP|DELETE|TRUNCATE|ALTER TABLE|CREATE POLICY|ALTER POLICY|USING \(true\))\b/i.test(sql), 'aditiva (sem DROP/DELETE/TRUNCATE/ALTER TABLE/policy)')
for (const chave of ['prod.import.modelo', 'prod.import.arquivo']) ok(sql.includes(`'${chave}'`), `ajuda RD-95 cadastrada: ${chave}`)

// ── componente + página + link ───────────────────────────────────────────────────────────────────────
const comp = ler('src/components/produtividade/ImportarPostosView.tsx')
ok(comp.includes('fn_rh_importar_postos'), 'componente chama a RPC guardada fn_rh_importar_postos')
ok(/from 'xlsx'/.test(comp), 'usa xlsx (planilha de verdade)')
ok(/XLSX\.writeFile/.test(comp) && /XLSX\.read/.test(comp), 'baixa o modelo (writeFile) e lê o upload (read)')
ok(/chave="prod\.import\.arquivo"/.test(comp) && /chave="prod\.import\.modelo"/.test(comp), 'RD-95 "?" no modelo e no arquivo')
ok(/Fictícia|Fictício|DEMO/.test(comp), 'modelo pré-preenchido com exemplo fictício (RD-69)')
ok(existsSync('src/app/dashboard/produtividade/importar/page.tsx'), 'página /dashboard/produtividade/importar existe')

const page = ler('src/app/dashboard/produtividade/page.tsx')
ok(/href="\/dashboard\/produtividade\/importar"/.test(page), 'link "Importar por planilha" na tela de postos (descoberta)')

if (falhas) { console.error(`\n${falhas} falha(s) no gate Importar quadro por planilha.`); process.exit(1) }
console.log('✓ Importar quadro por planilha: reusa a RPC guardada, migration aditiva, modelo+upload com "?"')
