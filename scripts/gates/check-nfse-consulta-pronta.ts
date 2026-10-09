// Gate (Rodrigo · chamado #1881) — NFS-e autorizada: XML em minutos + PDF assim que a prefeitura gerar.
// Travas de código, sem rede. Garante o contrato da migration:
//   (A) o cron reconsulta também AUTORIZADA sem PDF (janela limitada) além de processando/sem-XML;
//   (B) a cadência do cron caiu de 15 min (passa a rodar a cada <=5 min);
//   (C) o webhook (fn_webhook_atualizar_nfse) grava XML/PDF que cheguem depois, com status inalterado.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const migs = readdirSync('supabase/migrations').filter((f) => f.includes('1881') && f.endsWith('.sql'))
ok(migs.length >= 1, '#1881: existe a migration em supabase/migrations')

if (migs.length) {
  const sql = readFileSync(`supabase/migrations/${migs[0]}`, 'utf8')

  // (A) cron reconsulta autorizada sem PDF (com janela) e sem XML
  ok(/CREATE OR REPLACE FUNCTION public\.fn_nfse_auto_consultar_pendentes/i.test(sql),
    'cron: redefine fn_nfse_auto_consultar_pendentes')
  ok(/status\s*=\s*'autorizada'\s+AND\s*\(\s*pdf_url IS NULL/i.test(sql),
    'cron: reconsulta AUTORIZADA sem PDF (DANFSE que a prefeitura gera depois)')
  ok(/pdf_url IS NULL[\s\S]{0,120}interval\s*'48 hours'/i.test(sql),
    'cron: chase de PDF tem janela limitada (48h) — não martela município sem DANFSE')
  ok(/status\s*=\s*'autorizada'\s+AND\s*\(\s*xml_url IS NULL/i.test(sql),
    'cron: mantém a reconsulta de AUTORIZADA sem XML')

  // (B) cadência caiu de 15 min — roda a cada 1..5 min
  const sched = sql.match(/cron\.schedule\(\s*'nfse-auto-consultar-pendentes'\s*,\s*'([^']+)'/i)
  ok(!!sched, 'cron: reagenda nfse-auto-consultar-pendentes')
  if (sched) {
    const expr = sched[1].trim()
    const m = expr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/)
    ok(!!m && Number(m[1]) <= 5 && Number(m[1]) >= 1, `cron: cadência a cada <=5 min (atual: "${expr}")`)
  }

  // (C) webhook grava XML/PDF tardios mesmo com status inalterado
  ok(/CREATE OR REPLACE FUNCTION public\.fn_webhook_atualizar_nfse/i.test(sql),
    'webhook: redefine fn_webhook_atualizar_nfse')
  ok(/p_pdf_url IS NOT NULL[\s\S]{0,80}pdf_url IS NULL/i.test(sql),
    'webhook: grava PDF que chega depois (status já autorizada)')
  ok(/p_xml_url IS NOT NULL[\s\S]{0,80}xml_url IS NULL/i.test(sql),
    'webhook: grava XML que chega depois')
  ok(/xml_url\s*=\s*COALESCE\(p_xml_url, xml_url\)/i.test(sql) && /pdf_url\s*=\s*COALESCE\(p_pdf_url, pdf_url\)/i.test(sql),
    'webhook: idempotente — COALESCE preserva o que já existe (só preenche vazio)')
}

if (falhas) { console.error(`\ncheck-nfse-consulta-pronta: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfse-consulta-pronta: ok')
