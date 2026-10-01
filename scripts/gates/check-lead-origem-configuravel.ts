// Gate (chamado #552 · Pdois): a origem do lead é configurável por empresa (agency_lead_origem, 21/08), mas o CHECK
// antigo de agency_leads.origem só aceitava 4 slugs — escolher WhatsApp/Site/Ligação/E-mail/Evento dava erro ao gravar.
// Migration 20261001140000: sai o CHECK fixo, entra a validação pela lista da empresa (mesma regra da etapa).
// Confere também que as origens padrão semeadas pela tela continuam as de 20260821190000. Roda no build, sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const sql = readFileSync('supabase/migrations/20261001140000_agency_leads_origem_configuravel.sql', 'utf8').replace(/--[^\n]*/g, '')
ok(/DROP CONSTRAINT IF EXISTS agency_leads_origem_check/.test(sql), 'sai o CHECK fixo de 4 origens')
ok(/FROM agency_lead_origem WHERE company_id = NEW\.company_id AND chave = NEW\.origem/.test(sql), 'origem validada pela lista da empresa')
ok(/NOT IN \('prospeccao_ia_fria','indicacao','trafego_pago','relacionamento'\)/.test(sql), 'empresa sem lista segue com os 4 de antes')
ok(/BEFORE INSERT OR UPDATE OF origem ON public\.agency_leads/.test(sql), 'vale ao criar e ao trocar a origem')
ok(!/UPDATE\s+public\.agency_leads\s+SET/i.test(sql), 'nenhum lead existente é alterado')

// as origens que a tela oferece (seed de 20260821190000) passam a ser aceitas
const seed = readFileSync('supabase/migrations/20260821190000_agency_lead_origem_configuravel.sql', 'utf8')
for (const k of ['whatsapp', 'site', 'ligacao', 'email', 'evento']) ok(seed.includes(`('${k}',`), `origem padrão "${k}" existe na lista da empresa`)

// a tela grava pela RPC e mostra o erro do banco (não engole)
const tela = readFileSync('src/app/dashboard/pm/leads/page.tsx', 'utf8')
ok(/rpc\('fn_agency_lead_criar'/.test(tela) && /if \(error\) \{ setToast\(`Erro: \$\{error\.message\}`\)/.test(tela), 'tela cria pela RPC e mostra o erro')

if (falhas) { console.error(`\n${falhas} falha(s) na origem do lead`); process.exit(1) }
console.log('\nOrigem do lead configurável: ok')
