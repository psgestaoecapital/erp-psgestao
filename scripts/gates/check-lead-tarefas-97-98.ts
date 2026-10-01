// Gate (Pdois #97 + #98 · CEO 01/10): tarefas no lead no lugar do registro de reunião. Confere banco e tela. Sem rede.
//  · tipos e situações aprovados; gravação só por função com guarda de empresa e autoria da sessão;
//  · atribuir avisa no sino (nunca quem atribuiu) e põe na agenda do responsável;
//  · conversão das reuniões com prévia (p_aplicar), sem apagar nem sobrescrever o evento, idempotente;
//  · tela: "Tarefas" no card no lugar de "Reunião", "Minhas tarefas", WhatsApp por wa.me, "Meus leads", agenda "Minha/Equipe".
import { readFileSync } from 'node:fs'
import { whatsappHref, TIPOS_TAREFA } from '../../src/lib/pm/tarefas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const mig = readFileSync('supabase/migrations/20261001190000_agency_lead_tarefa.sql', 'utf8')
ok(mig.includes("CHECK (tipo IN ('ligar', 'whatsapp', 'reuniao', 'visita', 'email', 'outro'))"), 'tipos: ligar, WhatsApp, reunião, visita, e-mail, outro')
ok(mig.includes("CHECK (situacao IN ('a_fazer', 'feita', 'cancelada'))"), 'situações: a fazer, feita, cancelada')
ok(/REVOKE ALL ON public\.agency_lead_tarefa FROM PUBLIC, anon, authenticated;\s*GRANT SELECT ON public\.agency_lead_tarefa TO authenticated;/.test(mig), 'tabela: cliente só lê (grava pelas funções)')
for (const fn of ['fn_lead_tarefa_salvar', 'fn_lead_tarefa_situacao', 'fn_lead_tarefa_converter_reunioes']) {
  const ini = mig.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`)
  const corpo = mig.slice(ini, mig.indexOf('$function$;', ini))
  ok(ini >= 0 && corpo.includes('PERFORM public.fn__guarda_empresa('), `${fn}: confere a empresa`)
  ok(new RegExp(String.raw`REVOKE ALL ON FUNCTION public\.` + fn + String.raw`\([^)]*\) FROM PUBLIC, anon;`).test(mig), `${fn}: fechada a quem não está logado`)
}
const salvar = mig.slice(mig.indexOf('FUNCTION public.fn_lead_tarefa_salvar('), mig.indexOf('FUNCTION public.fn_lead_tarefa_situacao('))
ok(salvar.includes('v_autor uuid := auth.uid()') && salvar.includes('criado_por)') && !/criado_por\s*=\s*p_/.test(salvar), 'autoria da sessão')
ok(/v_resp IS DISTINCT FROM v_autor/.test(salvar) && salvar.includes("'tarefa_atribuida'"), 'sino só para o responsável, nunca para quem atribuiu')
ok(salvar.includes("INSERT INTO public.erp_agendamento") && salvar.includes("'tarefa_id', v_id"), 'tarefa entra na agenda do responsável')
ok(salvar.includes("uc.company_id = p_company_id") , 'responsável precisa ter acesso à empresa')
const conv = mig.slice(mig.indexOf('FUNCTION public.fn_lead_tarefa_converter_reunioes('))
ok(conv.includes('IF NOT COALESCE(p_aplicar, false) THEN') && conv.indexOf('IF NOT COALESCE(p_aplicar, false) THEN') < conv.indexOf('INSERT INTO public.agency_lead_tarefa'), 'conversão: prévia antes de gravar')
ok(conv.includes('NOT EXISTS (SELECT 1 FROM public.agency_lead_tarefa t WHERE t.agendamento_id = a.id)') && mig.includes('agency_lead_tarefa_agendamento_uq'), 'conversão idempotente')
ok(!/DELETE FROM public\.erp_agendamento|excluido_em\s*=\s*now\(\)/.test(conv) && conv.includes('a.responsavel_id IS NULL'), 'conversão não apaga o evento e só preenche responsável vazio')

// tela
const leads = readFileSync('src/app/dashboard/pm/leads/page.tsx', 'utf8')
ok(leads.includes('data-testid="lead-tarefas"') && !leads.includes('>📅 Reunião</button>'), 'card: "Tarefas" no lugar de "Reunião"')
ok(leads.includes('data-testid="minhas-tarefas-abrir"') && leads.includes("get('tarefas') === 'minhas'"), '"Minhas tarefas" (e o aviso do sino abre direto)')
ok(leads.includes('<option value={uid}>Meus leads</option>'), 'filtro do funil: Meus leads')
ok(leads.includes('data-testid="lead-whatsapp"'), 'WhatsApp no card')
const agenda = readFileSync('src/app/dashboard/pm/agenda/page.tsx', 'utf8')
ok(agenda.includes("useState<'minha' | 'equipe'>('minha')") && agenda.includes('responsavel_id.eq.${uid}'), 'agenda: Minha agenda (padrão) / Equipe')

// WhatsApp sem integração paga
ok(whatsappHref('(49) 99999-1234') === 'https://wa.me/5549999991234', 'wa.me com DDI 55')
ok(whatsappHref('+55 49 99999-1234') === 'https://wa.me/5549999991234', 'wa.me mantém DDI informado')
ok(whatsappHref('1234') === null && whatsappHref(null) === null, 'sem número válido, sem botão')
ok(TIPOS_TAREFA.map((t) => t.v).join(',') === 'ligar,whatsapp,reuniao,visita,email,outro', 'tela usa os mesmos tipos do banco')

if (falhas) { console.error(`\ncheck-lead-tarefas-97-98: ${falhas} falha(s)`); process.exit(1) }
console.log('\nTarefas no lead (#97/#98): ok')
