// Gate (Rodrigo · chamado #1880) — IBGE do município do tomador (NFS-e). Travas de código, sem rede — roda no build.
// Garante o contrato: (1) o cadastro de cliente grava o IBGE do CEP (regressão); (2) o importador OMIE resolve e
// grava o IBGE na importação sem sobrescrever correção manual; (3) existe o backfill geral set-based com backup.
import { readFileSync, readdirSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) Cadastro de cliente: o "Buscar" do CEP grava codigo_ibge_municipio (parte 1 — regressão).
const clienteForm = readFileSync('src/components/clientes/ClienteForm.tsx', 'utf8')
ok(/codigo_ibge_municipio:\s*d\.ibge\s*\|\|/.test(clienteForm), 'ClienteForm: buscarCEP grava codigo_ibge_municipio do ViaCEP')
ok(clienteForm.includes("rpc('fn_municipio_por_nome_uf'"), 'ClienteForm: fallback resolve IBGE por cidade+UF (tabela oficial)')

// 2) Importador OMIE: resolve o IBGE por cidade+UF e grava, sem sobrescrever correção manual (parte 2).
const omie = readFileSync('src/app/api/sync/omie/clientes/route.ts', 'utf8')
ok(omie.includes("rpc('fn_municipio_por_nome_uf'"), 'OMIE: resolve IBGE pela tabela oficial (fn_municipio_por_nome_uf)')
ok(omie.includes(".replace(/\\s*\\(.*\\)\\s*$/"), 'OMIE: limpa o sufixo " (UF)" da cidade antes de casar')
ok(omie.includes("select('id, codigo_ibge_municipio')"), 'OMIE: lê o IBGE atual do cliente (p/ não sobrescrever)')
ok(omie.includes('temIbge') && /codigo_ibge_municipio:\s*ibge/.test(omie), 'OMIE: só grava IBGE quando o cliente ainda não tem')

// 3) Backfill geral: migration set-based com backup em rls2_backup (parte 3).
const migs = readdirSync('supabase/migrations').filter((f) => f.includes('1880') && f.endsWith('.sql'))
ok(migs.length >= 1, 'backfill: existe a migration do #1880 em supabase/migrations')
if (migs.length) {
  const sql = readFileSync(`supabase/migrations/${migs[0]}`, 'utf8')
  ok(/CREATE TABLE IF NOT EXISTS\s+rls2_backup\./i.test(sql), 'backfill: cria backup em rls2_backup (prova/reversão)')
  ok(/UPDATE\s+public\.erp_clientes[\s\S]*FROM\s+public\.erp_gov_nfse_municipios/i.test(sql), 'backfill: UPDATE set-based com JOIN na tabela oficial (não chama função por linha)')
  ok(sql.includes("regexp_replace(c.cidade, '\\s*\\(.*\\)\\s*$'"), 'backfill: limpa o sufixo " (UF)" da cidade antes de casar')
  ok(/codigo_ibge_municipio IS NULL OR btrim\(codigo_ibge_municipio\)\s*=\s*''|codigo_ibge_municipio IS NULL OR btrim\(c\.codigo_ibge_municipio\)\s*=\s*''/.test(sql), 'backfill: idempotente — só toca NULL/vazio')
}

if (falhas) { console.error(`\ncheck-ibge-tomador: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-ibge-tomador: ok')
