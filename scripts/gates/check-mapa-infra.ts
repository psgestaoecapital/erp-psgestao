// Gate (CEO 14/10) — aba "Mapa da Infra" (Codes). Estático, sem rede:
//  (1) migration aditiva na faixa 05: 4 tabelas com RLS, SELECT só equipe PS, sem GRANT ao anon, escrita só service_role;
//  (2) batimento só service_role; config só PS_ADMIN com auditoria; alerta pelo canal do briefing (erp_truth_alerts);
//  (3) desenho versionado (vigente único), nó com dono/cadência/tolerância; "?" (RD-95), system_screens (RD-50);
//  (4) regras puras da tela e a aba na Central.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { haQuanto, porCamada, resumo, type NoInfra } from '../../src/lib/dev/mapaInfra'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const dir = 'supabase/migrations'
const arq = readdirSync(dir).find((f) => f.endsWith('_dev_infra_mapa.sql'))
ok(!!arq && /^\d{12}05_/.test(arq), `migration na faixa 05 (${arq ?? '—'})`)
const sql = (arq ? readFileSync(join(dir, arq), 'utf8') : '').replace(/--[^\n]*/g, '')
for (const t of ['erp_infra_desenho_versao', 'erp_infra_no', 'erp_infra_ligacao', 'erp_infra_batimento'])
  ok(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`).test(sql), `tabela ${t}`)
ok(/ENABLE ROW LEVEL SECURITY/.test(sql) && /REVOKE ALL ON TABLE public\.%I FROM PUBLIC, anon, authenticated/.test(sql)
  && /GRANT SELECT ON TABLE public\.%I TO authenticated/.test(sql) && /fn_dev_painel_pode_ver\(\)/.test(sql), 'RLS, REVOKE anon e leitura só equipe PS')
ok(!/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO (anon|authenticated)/.test(sql) && !/TO[^;]*\banon\b[^;]*;/.test(sql.replace(/REVOKE[^;]*;/g, '')), 'sem escrita nem GRANT ao anon')
ok(/UNIQUE INDEX[^;]*erp_infra_desenho_vigente_uq[^;]*WHERE vigente/.test(sql), 'um só desenho vigente')
ok(/dono\s+text NOT NULL/.test(sql) && /cadencia_min/.test(sql) && /tolerancia_min/.test(sql), 'nó com dono, cadência e tolerância')
ok(/REVOKE ALL ON FUNCTION public\.fn_infra_batimento_registrar\([^)]*\) FROM PUBLIC, anon, authenticated/.test(sql)
  && /GRANT EXECUTE ON FUNCTION public\.fn_infra_batimento_registrar\([^)]*\) TO service_role/.test(sql), 'batimento só service_role')
ok(/papel = 'PS_ADMIN'/.test(sql) && /audit_log_global/.test(sql), 'config só PS_ADMIN, com auditoria')
ok(/erp_truth_alerts/.test(sql) && /dev-infra-alerta-10min/.test(sql), 'alerta ao CEO pelo briefing, agendado')
ok(/dashboard\.dev\.infra/.test(sql) && /'\/dashboard\/dev\/infra'/.test(sql), 'system_screens (RD-50)')
const chaves = [...sql.matchAll(/\('(dev\.infra\.[a-z_]+)'/g)].map((m) => m[1])
const tela = readFileSync('src/components/dev/MapaInfra.tsx', 'utf8')
const usadas = [...tela.matchAll(/chave="(dev\.infra\.[a-z_]+)"/g)].map((m) => m[1])
ok(usadas.length >= 5 && usadas.every((c) => chaves.includes(c)), '"?" (RD-95): toda chave usada na tela existe na migration')
ok(/supabase_realtime/.test(sql) && /postgres_changes/.test(tela), 'Realtime')
const n = (cor: NoInfra['cor'], camada: NoInfra['camada'], ordem: number): NoInfra => ({ chave: String(ordem), nome: 'x', camada, tipo: 'cron', dono: 'd', ordem,
  cadencia_min: 5, tolerancia_min: 5, ultimo_batimento: null, resultado: null, detalhe: null, itens_olhados: 0, itens_decididos: 0, atraso_min: null, cor })
const g = porCamada([n('verde', 'auditores', 2), n('vermelho', 'esteira', 2), n('amarelo', 'esteira', 1)])
ok(g.map((x) => x.id).join() === 'esteira,auditores' && g[0].nos[0].ordem === 1, 'camadas na ordem do fluxo e nós por ordem')
ok(resumo([n('verde', 'esteira', 1), n('verde', 'esteira', 2), n('vermelho', 'esteira', 3)]).verde === 2, 'resumo conta por cor')
ok(haQuanto(null) === 'nunca' && haQuanto(new Date(Date.now() - 7 * 60000).toISOString()) === 'há 7 min', 'há quanto tempo')
const pg = readFileSync('src/app/dashboard/dev/page.tsx', 'utf8')
ok(/MapaInfra/.test(pg) && /dashboard\\\/dev\\\/infra/.test(pg) && /central-aba-/.test(pg), 'aba Infra na Central')
ok(/from '\.\.\/page'/.test(readFileSync('src/app/dashboard/dev/infra/page.tsx', 'utf8')), 'rota própria /dashboard/dev/infra')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-mapa-infra: OK')
