// Gate (#2078 Pdois): ganhar o lead não cria uma 2ª proposta zerada quando o lead já tem proposta. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261010190020_lead_ganho_reusa_proposta_do_lead.sql', 'utf8')
const iLead = mig.indexOf('lead_id=p_lead_id AND deleted_at IS NULL')
const iInsert = mig.indexOf('INSERT INTO agency_propostas')
ok(iLead > 0 && iInsert > iLead, 'procura a proposta do lead antes de criar outra')
ok(mig.includes("status IS DISTINCT FROM 'recusada'"), 'proposta recusada do lead não conta')
ok(/SET cliente_id=v_cli, updated_at=now\(\) WHERE id=v_prop AND cliente_id IS NULL/.test(mig), 'liga o cliente sem sobrescrever o que já tinha')
ok(mig.includes("cliente_id=v_cli AND status='rascunho' AND deleted_at IS NULL"), 'rascunho do cliente: só não excluído')
ok(mig.includes('IF NOT (v_lead.company_id IN (SELECT get_user_company_ids()) OR is_admin())'), 'guarda de empresa mantida')
ok(mig.includes("SECURITY DEFINER\n SET search_path TO 'public'"), 'search_path fixo mantido')
ok(!/\b(DELETE|TRUNCATE|GRANT|REVOKE)\b/.test(mig.replace(/^--.*$/gm, '')), 'não apaga dado nem mexe em permissão')
const tela = readFileSync('src/app/dashboard/pm/leads/page.tsx', 'utf8')
ok(tela.includes('usa a proposta já feita no lead'), 'tela avisa que reaproveita a proposta do lead')
const spec = readFileSync('e2e/jornadas/aceitacao/pdois-lead-ganho-sem-proposta-duplicada.spec.ts', 'utf8')
ok(spec.includes("tag: '@pos-migration'"), 'aceitação marcada @pos-migration')

if (falhas) { console.error(`\ncheck-lead-ganho-proposta-2078: ${falhas} falha(s)`); process.exit(1) }
console.log('\nLead ganho sem proposta duplicada (#2078): ok')
