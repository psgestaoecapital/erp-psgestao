// Gate · Indústria › Compra × abate — contagem de cabeças (RD-38, erp_contexto_projeto 54cda9a1, Eng. Chefe 27/11).
// Sem rede. Confere na migration:
//  1) abate: o animal é a chave COD_DOCTO, NUM_DOCTO, SERIE_SEQ, SEQ_ABATE — sem COD_PRODUTO no DISTINCT ON;
//  2) compra: T255 entra, mas só sem contra-nota T231 do mesmo produtor em ±3 dias e sem linha de ajuste (<= 10 kg);
//     cabeças estimadas pelo peso ficam marcadas (cabecas_estimadas);
//  3) porta: compara só dias fechados (fuso de Brasília) e devolve as 3 parcelas; tradutores sem EXECUTE para a tela;
//  4) tela: cada parcela tem "?" com chave cadastrada na migration.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const arq = readdirSync('supabase/migrations').filter((f) => f.endsWith('_contagem_cabecas_compra_abate.sql'))
if (arq.length !== 1) { console.error(`✗ esperava 1 migration *_contagem_cabecas_compra_abate.sql, achei ${arq.length}`); process.exit(1) }
const mig = readFileSync(`supabase/migrations/${arq[0]}`, 'utf8')
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
const tela = readFileSync('src/app/dashboard/inteligencia/recepcao/page.tsx', 'utf8')

const don = sql.match(/DISTINCT ON \(([^)]*)\)/)?.[1] ?? ''
ok(/SEQ_ABATE/.test(don) && !/COD_PRODUTO/.test(don), 'abate: DISTINCT ON sem COD_PRODUTO (um animal = uma linha)')
ok(/f\.imported_at DESC, f\.raw->>'COD_PRODUTO'/.test(sql), 'abate: desempate determinístico (mais recente, depois menor produto)')
ok(/IN \('T231', 'T234', 'T255'\)/.test(sql), 'compra: lê T255 (compra de PJ)')
ok(/b\.qpri > 10/.test(sql), 'compra: linha de ajuste (<= 10 kg) fora')
ok(/NOT EXISTS \(SELECT 1 FROM cn WHERE cn\.cf = b\.cf AND cn\.dt BETWEEN b\.dt - 3 AND b\.dt \+ 3\)/.test(sql), 'compra: nota do produtor sobre lote com contra-nota T231 não entra de novo')
ok(/cabecas_estimadas boolean/.test(sql) && /BETWEEN 120 AND 450/.test(sql), 'compra: cabeças estimadas pelo peso ficam marcadas')
ok(/AND \(p_company_id IN \(SELECT public\.get_user_company_ids\(\)\) OR public\.is_admin\(\)\)/.test(sql), 'compra: guarda de empresa')
for (const f of ['fn_ind_abate_animal', 'fn_ind_compra_gado_item'])
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${f}\\(uuid, date, date\\) FROM PUBLIC, anon, authenticated`).test(sql), `tradutor fora do alcance da tela: ${f}`)
ok(/AT TIME ZONE 'America\/Sao_Paulo'/.test(sql) && /v_fech := least\(v_ate, v_hoje - 1\)/.test(sql), 'porta: só dias fechados (até ontem, Brasília)')
for (const k of ['notas_pendentes_cab', 'compra_pj_cab', 'sem_nota_cab', 'fechado_ate']) ok(sql.includes(`'${k}'`), `porta devolve ${k}`)
ok(/IF v_uid IS NULL THEN RAISE EXCEPTION/.test(sql) && /'sem_acesso_compra_gado'/.test(sql), 'porta: login e direção mantidos')
for (const k of ['compra.abate', 'compra.abate_hoje', 'compra.abate_pj', 'compra.abate_sem_nota']) {
  ok(tela.includes(`'${k}'`) || tela.includes(`"${k}"`), `tela usa o "?" ${k}`)
  ok(mig.includes(`('${k}',`), `chave de ajuda cadastrada: ${k}`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — contagem de cabeças compra × abate`); process.exit(1) }
console.log('\nContagem de cabeças compra × abate ok')
