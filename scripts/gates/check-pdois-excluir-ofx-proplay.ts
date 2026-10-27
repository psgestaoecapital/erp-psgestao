/**
 * Gate (Jordana 20/10, PR #2914 — revisor 27/10): a migration que apaga o lote OFX da Proplay importado por engano na
 * SICREDI PRIGOL da Pdois só pode apagar com a guarda 7/7/7, com backup ANTES do DELETE e sem tocar título
 * (erp_pagar/erp_receber) nem outro dado. A migration é achada pelo SUFIXO do nome (a fila pode renumerar a versão).
 *   tsx scripts/gates/check-pdois-excluir-ofx-proplay.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const DIR = join('supabase', 'migrations')
const arqs = readdirSync(DIR).filter((f) => f.endsWith('_pdois_excluir_ofx_proplay_por_engano.sql'))
ok(arqs.length === 1, `uma única migration *_pdois_excluir_ofx_proplay_por_engano.sql (achou ${arqs.length})`)
if (arqs.length !== 1) process.exit(1)

// Sem comentários: a prova vale para o SQL que roda, não para o texto explicativo.
const sql = readFileSync(join(DIR, arqs[0]), 'utf8').replace(/--[^\n]*/g, '')
const norm = sql.replace(/\s+/g, ' ')
const pos = (re: RegExp) => { const m = re.exec(norm); return m ? m.index : -1 }

const LOTE = '0baaa231-090b-40af-8f0f-0d2b2bf950b7'
const PDOIS = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
const PROPLAY = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'

// 1) Só UM comando que apaga/altera dado, e é o DELETE do lote certo, na empresa certa.
const deletes = norm.match(/\bDELETE\s+FROM\s+[\w.]+[^;]*;/gi) ?? []
ok(deletes.length === 1, `exatamente um DELETE (achou ${deletes.length})`)
ok(/^DELETE FROM public\.conciliacao_lote WHERE id = c_lote AND company_id = c_pdois;$/i.test(deletes[0] ?? ''),
  `o DELETE é só do lote, preso ao id e à empresa: ${deletes[0] ?? '(nenhum)'}`)
ok(!/\bUPDATE\s+[\w.]+\s+SET\b/i.test(norm), 'nenhum UPDATE')
ok(!/\bINSERT\s+INTO\s+public\./i.test(norm), 'nenhum INSERT em public')
ok(!/\b(TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i.test(norm), 'nenhum TRUNCATE/DROP TABLE/ALTER TABLE')
ok(!/erp_pagar|erp_receber|erp_lancamento/i.test(norm), 'não toca erp_pagar/erp_receber/erp_lancamento')
ok(norm.includes(`c_lote CONSTANT uuid := '${LOTE}'`), 'lote fixo 0baaa231')
ok(norm.includes(`c_pdois CONSTANT uuid := '${PDOIS}'`), 'empresa fixa Pdois')
ok(norm.includes(`c_proplay CONSTANT uuid := '${PROPLAY}'`), 'empresa de comparação fixa Proplay')

// 2) Backup do lote e dos movimentos ANTES do DELETE, filtrado pelo mesmo lote/empresa, em esquema sem acesso público.
const iDel = pos(/\bDELETE FROM public\.conciliacao_lote\b/i)
const iBkLote = pos(/CREATE TABLE IF NOT EXISTS rls2_backup\.conciliacao_lote_bkp_\w+ AS SELECT l\.\*/i)
const iBkMov = pos(/CREATE TABLE IF NOT EXISTS rls2_backup\.conciliacao_movimento_bkp_\w+ AS SELECT m\.\*/i)
ok(iBkLote >= 0 && iBkLote < iDel, 'backup do lote antes do DELETE')
ok(iBkMov >= 0 && iBkMov < iDel, 'backup dos movimentos antes do DELETE')
ok(norm.includes(`WHERE l.id = '${LOTE}' AND l.company_id = '${PDOIS}'`), 'backup do lote filtra lote + empresa')
ok(norm.includes(`WHERE m.lote_id = '${LOTE}' AND m.company_id = '${PDOIS}'`), 'backup dos movimentos filtra lote + empresa')
ok(/REVOKE ALL ON SCHEMA rls2_backup FROM PUBLIC, anon, authenticated/i.test(norm), 'esquema de backup sem acesso de anon/authenticated')

// 3) Guarda 7/7/7 antes do DELETE, com RETURN (não apaga nada se a condição mudou).
const iGuarda = pos(/IF v_total <> 7 OR v_livres <> 7 OR v_dup <> 7 THEN RAISE NOTICE '[^']*'; RETURN; END IF;/i)
ok(iGuarda >= 0 && iGuarda < iDel, 'guarda 7/7/7 com RETURN antes do DELETE')
const iSemLote = pos(/IF NOT EXISTS \(SELECT 1 FROM public\.conciliacao_lote WHERE id = c_lote AND company_id = c_pdois\) THEN [^;]*; RETURN;/i)
ok(iSemLote >= 0 && iSemLote < iDel, 'banco sem o lote (testes) é no-op')

// 4) O que conta como "livre": sem lançamento, sem match aplicado, sem vínculo de conciliação, sem transferência
//    (as duas tabelas com FK para conciliacao_movimento), e só pendente/ignorado.
const livres = /SELECT count\(\*\) INTO v_livres (.*?);/i.exec(norm)?.[1] ?? ''
ok(/m\.company_id = c_pdois/.test(livres), 'livres: só movimentos da Pdois')
ok(/m\.status = 'pendente' AND m\.match_aplicado_em IS NULL OR m\.status = 'ignorado'/.test(livres), 'livres: pendente sem match ou ignorado')
ok(/m\.lancamento_id IS NULL/.test(livres), 'livres: sem lançamento')
ok(/NOT EXISTS \(SELECT 1 FROM public\.conciliacao_vinculo v WHERE v\.movimento_id = m\.id\)/.test(livres), 'livres: sem conciliacao_vinculo')
ok(/NOT EXISTS \(SELECT 1 FROM public\.erp_transferencia t WHERE t\.movimento_id = m\.id\)/.test(livres), 'livres: sem erp_transferencia')

// 5) Duplicata na Proplay pelo FITID + data + valor + natureza.
const dup = /SELECT count\(\*\) INTO v_dup (.*?);/i.exec(norm)?.[1] ?? ''
for (const c of ['p.company_id = c_proplay', 'p.id_externo = m.id_externo', 'p.data_transacao = m.data_transacao', 'p.valor = m.valor', 'p.natureza = m.natureza'])
  ok(dup.includes(c), `duplicata na Proplay confere ${c}`)

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-pdois-excluir-ofx-proplay: ok')
