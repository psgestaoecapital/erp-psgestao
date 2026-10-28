/**
 * Gate (Jordana 20/10, PR #2914 — revisor 27/10, RD-55): o lote OFX da Proplay importado por engano na SICREDI PRIGOL
 * da Pdois é ARQUIVADO, nunca apagado: zero DELETE, guarda 7/7/7, backup ANTES de alterar, e só dois UPDATEs presos ao
 * lote/empresa (movimentos pendentes → 'ignorado'; lote → 'arquivado'), sem tocar título (erp_pagar/erp_receber).
 * A migration é achada pelo SUFIXO do nome (a fila pode renumerar a versão).
 *   tsx scripts/gates/check-pdois-arquivar-ofx-proplay.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error(`✘ ${m}`) } else console.log(`✓ ${m}`) }

const DIR = join('supabase', 'migrations')
ok(readdirSync(DIR).filter((f) => f.endsWith('_pdois_excluir_ofx_proplay_por_engano.sql')).length === 0,
  'a versão com DELETE (*_pdois_excluir_ofx_proplay_por_engano.sql) não existe mais')
const arqs = readdirSync(DIR).filter((f) => f.endsWith('_pdois_arquivar_ofx_proplay_por_engano.sql'))
ok(arqs.length === 1, `uma única migration *_pdois_arquivar_ofx_proplay_por_engano.sql (achou ${arqs.length})`)
if (arqs.length !== 1) process.exit(1)

// Sem comentários: a prova vale para o SQL que roda, não para o texto explicativo.
const sql = readFileSync(join(DIR, arqs[0]), 'utf8').replace(/--[^\n]*/g, '')
const norm = sql.replace(/\s+/g, ' ')
const pos = (re: RegExp) => { const m = re.exec(norm); return m ? m.index : -1 }

const LOTE = '0baaa231-090b-40af-8f0f-0d2b2bf950b7'
const PDOIS = '36b69d77-b4ea-414b-8519-2ff6621c8de7'
const PROPLAY = 'b2b96eef-0ad9-4588-85c1-a4e9f2cd7490'

// 1) Nada apagado; só os dois UPDATEs esperados, presos ao lote e à empresa.
ok(!/\bDELETE\b/i.test(norm), 'nenhum DELETE (RD-55: zero perda de dado)')
ok(!/\b(TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE)\b/i.test(norm), 'nenhum TRUNCATE/DROP TABLE/ALTER TABLE')
ok(!/\bINSERT\s+INTO\s+public\./i.test(norm), 'nenhum INSERT em public')
ok(!/erp_pagar|erp_receber|erp_lancamento/i.test(norm), 'não toca erp_pagar/erp_receber/erp_lancamento')
const updates = norm.match(/\bUPDATE\s+[\w.]+\s+SET\b[^;]*;/gi) ?? []
ok(updates.length === 2, `exatamente dois UPDATEs (achou ${updates.length})`)
const updMov = updates.find((u) => /^UPDATE public\.conciliacao_movimento SET/i.test(u)) ?? ''
const updLote = updates.find((u) => /^UPDATE public\.conciliacao_lote SET/i.test(u)) ?? ''
ok(/SET status = 'ignorado', motivo_status = 'ofx_de_outra_empresa'/.test(updMov), 'movimentos → ignorado com motivo próprio')
ok(/WHERE lote_id = c_lote AND company_id = c_pdois AND status = 'pendente' AND match_aplicado_em IS NULL AND lancamento_id IS NULL;$/.test(updMov),
  'UPDATE dos movimentos preso ao lote, à empresa e só pendente sem match/lançamento')
ok(/SET status = 'arquivado', updated_at = now\(\) WHERE id = c_lote AND company_id = c_pdois;$/.test(updLote), 'lote → arquivado, preso ao id e à empresa')
const iUpdMov = pos(/\bUPDATE public\.conciliacao_movimento\b/i)
const iUpdLote = pos(/\bUPDATE public\.conciliacao_lote\b/i)
ok(iUpdMov >= 0 && iUpdMov < iUpdLote, 'lote arquivado DEPOIS dos movimentos (o gatilho de recálculo não desfaz o arquivado)')
ok(norm.includes(`c_lote CONSTANT uuid := '${LOTE}'`), 'lote fixo 0baaa231')
ok(norm.includes(`c_pdois CONSTANT uuid := '${PDOIS}'`), 'empresa fixa Pdois')
ok(norm.includes(`c_proplay CONSTANT uuid := '${PROPLAY}'`), 'empresa de comparação fixa Proplay')

// 2) Backup do lote e dos movimentos ANTES de alterar, filtrado pelo mesmo lote/empresa, em esquema sem acesso público.
const iBkLote = pos(/CREATE TABLE IF NOT EXISTS rls2_backup\.conciliacao_lote_bkp_\w+ AS SELECT l\.\*/i)
const iBkMov = pos(/CREATE TABLE IF NOT EXISTS rls2_backup\.conciliacao_movimento_bkp_\w+ AS SELECT m\.\*/i)
ok(iBkLote >= 0 && iBkLote < iUpdMov, 'backup do lote antes de alterar')
ok(iBkMov >= 0 && iBkMov < iUpdMov, 'backup dos movimentos antes de alterar')
ok(norm.includes(`WHERE l.id = '${LOTE}' AND l.company_id = '${PDOIS}'`), 'backup do lote filtra lote + empresa')
ok(norm.includes(`WHERE m.lote_id = '${LOTE}' AND m.company_id = '${PDOIS}'`), 'backup dos movimentos filtra lote + empresa')
ok(/REVOKE ALL ON SCHEMA rls2_backup FROM PUBLIC, anon, authenticated/i.test(norm), 'esquema de backup sem acesso de anon/authenticated')

// 3) Guarda 7/7/7 antes de alterar, com RETURN; banco sem o lote é no-op.
const iGuarda = pos(/IF v_total <> 7 OR v_livres <> 7 OR v_dup <> 7 THEN RAISE NOTICE '[^']*'; RETURN; END IF;/i)
ok(iGuarda >= 0 && iGuarda < iUpdMov, 'guarda 7/7/7 com RETURN antes de alterar')
const iSemLote = pos(/IF NOT EXISTS \(SELECT 1 FROM public\.conciliacao_lote WHERE id = c_lote AND company_id = c_pdois\) THEN [^;]*; RETURN;/i)
ok(iSemLote >= 0 && iSemLote < iUpdMov, 'banco sem o lote (testes) é no-op')

// 4) "Livre": sem lançamento, sem match aplicado, sem vínculo, sem transferência, e só pendente/ignorado.
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
console.log('\ncheck-pdois-arquivar-ofx-proplay: ok')
