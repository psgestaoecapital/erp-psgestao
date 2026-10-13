// Gate (CEO 01/10 · roteiro de teste da Pdois): os botões e campos que o roteiro entregue à Pdois cita continuam na tela.
// Se alguém renomear/remover um deles, o roteiro (e o teste pdois-roteiro-teste) quebraria em silêncio. Sem rede.
import { readFileSync } from 'node:fs'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const leads = readFileSync('src/app/dashboard/pm/leads/page.tsx', 'utf8')
const tarefas = readFileSync('src/components/pm/TarefasLead.tsx', 'utf8')
const libTarefas = readFileSync('src/lib/pm/tarefas.ts', 'utf8')
const agenda = readFileSync('src/app/dashboard/pm/agenda/page.tsx', 'utf8')
const jobs = readFileSync('src/app/dashboard/producao/page.tsx', 'utf8')
const menu = readFileSync('src/lib/menu/useSidebarModulos.ts', 'utf8')

// menu citado no roteiro
ok(menu.includes("PM_COMERCIAL: '1 · Comercial & Entrada'") && menu.includes("PM_PRODUCAO: '2 · Produção & Controle'"), 'seções do menu do P&M com os nomes do roteiro')

// Leads: novo lead, origem, "Meus leads", tarefas, Minhas tarefas
ok(leads.includes('data-testid="lead-novo"') && leads.includes('+ Novo lead'), 'Leads: botão "+ Novo lead"')
ok(leads.includes('Origem do Lead') && leads.includes('data-testid="lead-salvar"'), 'Leads: campo "Origem do Lead" e CRIAR')
ok(leads.includes('>Meus leads</option>'), 'Leads: filtro "Meus leads"')
ok(leads.includes('data-testid="lead-observacoes"') && /observacoes: form\.observacoes/.test(leads), 'Leads: "Observações" no Novo lead, gravada na criação (#912)')
ok(leads.includes('data-testid="lead-tarefas"') && leads.includes('✅ Tarefas'), 'Leads: botão "✅ Tarefas" no cartão do lead')
ok(leads.includes('data-testid="minhas-tarefas-abrir"') && leads.includes('✅ Minhas tarefas'), 'Leads: botão "✅ Minhas tarefas" no topo')

// Tarefas do lead
ok(tarefas.includes('data-testid="tarefas-whatsapp"') && tarefas.includes('💬 WhatsApp'), 'Tarefas: botão "💬 WhatsApp"')
ok(/https:\/\/wa\.me\//.test(libTarefas), 'WhatsApp abre o wa.me (sem integração paga)')
for (const id of ['tarefa-titulo', 'tarefa-data', 'tarefa-hora', 'tarefa-responsavel', 'tarefa-salvar', 'tarefa-resultado', 'tarefa-confirmar']) {
  ok(tarefas.includes(`data-testid="${id}"`), `Tarefas: ${id}`)
}
ok(tarefas.includes("'Criar tarefa'") && tarefas.includes('✓ Feita') && tarefas.includes('Abrir tarefas do lead'), 'Tarefas: "Criar tarefa", "✓ Feita" e "Abrir tarefas do lead"')

// Agenda (#119): Minha agenda × Equipe, abrindo na própria
ok(agenda.includes("useState<'minha' | 'equipe'>('minha')"), 'Agenda abre em "Minha agenda"')
ok(agenda.includes("'Minha agenda' : 'Equipe'") && agenda.includes('data-testid={`agenda-${k}`}'), 'Agenda: botões "Minha agenda" e "Equipe"')

// Jobs (#144)
ok(jobs.includes('+ Novo job'), 'Jobs: botão "+ Novo job"')
for (const id of ['job-cliente', 'job-tipo', 'job-titulo', 'job-prazo', 'job-responsavel']) {
  ok(jobs.includes(`data-testid="${id}"`) || jobs.includes(`testId="${id}"`), `Jobs: ${id}`)
}

if (falhas) { console.error(`\ncheck-pdois-roteiro-telas: ${falhas} falha(s)`); process.exit(1) }
console.log('\nRoteiro da Pdois · telas: ok')
