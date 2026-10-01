// Gate (Pdois · 01/10 · defeitos da Agenda comercial, achados no mapeamento do #119): roda no build, sem rede.
//  1) evento excluído (soft delete) não aparece; 2) salvar evento existente ATUALIZA (não cria outro);
//  3) o evento novo grava o nome do responsável (o card saía sem nome).
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }
const f = readFileSync('src/app/dashboard/pm/agenda/page.tsx', 'utf8')

ok(/from\('erp_agendamento'\)[\s\S]{0,500}\.is\('excluido_em', null\)/.test(f), 'lista da agenda ignora evento excluído')
ok(/if \(ag\) \{[\s\S]{0,600}from\('erp_agendamento'\)\.update\(/.test(f) && /\.eq\('id', ag\.id\)\.eq\('company_id', empresa\)/.test(f), 'salvar evento existente atualiza o próprio evento')
ok(/if \(ag\) \{[\s\S]*?onSaved\(\); return\s*\}\s*const \{ error \} = await supabase\.rpc\('fn_agendamento_criar'/.test(f), 'criar só acontece para evento novo')
ok(/p_responsavel_nome: nomeUsuario/.test(f) && !/p_responsavel_nome: null/.test(f), 'evento novo grava o nome do responsável')

if (falhas) { console.error(`\n${falhas} falha(s) na agenda comercial`); process.exit(1) }
console.log('\nAgenda comercial (defeitos Pdois): ok')
