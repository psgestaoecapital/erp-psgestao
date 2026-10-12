// Gate · P&M onda 3 (Pdois) — carga da equipe em horas × capacidade (src/lib/pm/cargaEquipe.ts). Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { cargaEquipe, diasUteis, fracaoNaJanela, type JobCarga, type TarefaCarga } from '../../src/lib/pm/cargaEquipe'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }
const H = '2026-10-05' // segunda-feira
const job = (o: Partial<JobCarga>): JobCarga => ({
  id: 'x', status: 'em_producao', responsavel_id: null, responsavel_nome: null, data_prazo: null, horas_estimadas: 0, horas_realizadas: 0,
  proposta_id: null, fee_id: null, contrato_id: null, created_at: '2026-09-20T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', ...o,
})
const tar = (o: Partial<TarefaCarga>): TarefaCarga => ({ job_id: 'A', status: 'pendente', responsavel_id: null, data_prazo: null, horas_estimadas: 0, horas_realizadas: 0, ...o })

ok(diasUteis('2026-10-05', '2026-10-11') === 5 && diasUteis('2026-10-05', '2026-10-16') === 10 && diasUteis('2026-10-10', '2026-10-11') === 0, 'dias úteis = segunda a sexta')
ok(fracaoNaJanela(null, H, '2026-10-11') === 1 && fracaoNaJanela('2026-09-30', H, '2026-10-11') === 1 && fracaoNaJanela('2026-10-16', H, '2026-10-11') === 0.5, 'prazo vencido/na janela/sem prazo = inteiro; depois = proporcional')

const membros = [
  { id: 'm1', user_id: 'u1', nome: 'Ana Souza', jornada_horas_dia: 8, ativo: true },
  { id: 'm2', user_id: null, nome: 'Bruno Lima', jornada_horas_dia: null, ativo: true },
  { id: 'm3', user_id: 'u3', nome: 'Saiu', jornada_horas_dia: 8, ativo: false },
]
const usuarios = { u1: 'Ana Souza', u2: 'Bruno Lima', u9: 'Carla Reis' }
const jobs = [
  job({ id: 'A', responsavel_id: 'u1', horas_estimadas: 100, proposta_id: 'P3' }), // tem tarefas: o estimado do job não conta
  job({ id: 'B', responsavel_nome: 'bruno  LIMA', horas_estimadas: 20, fee_id: 'F1' }),
  job({ id: 'C', horas_estimadas: 3 }), // sem responsável
  job({ id: 'D', status: 'concluida', responsavel_id: 'u1', horas_estimadas: 50 }),
  job({ id: 'E', responsavel_id: 'u1', horas_estimadas: 50, updated_at: '2025-01-01T00:00:00Z' }), // legado
  job({ id: 'F', responsavel_id: 'u9', horas_estimadas: 8, data_prazo: '2026-10-07' }),
]
const tarefas = [
  tar({ responsavel_id: 'u1', horas_estimadas: 6, horas_realizadas: 2, data_prazo: '2026-10-08' }),
  tar({ responsavel_id: 'u2', horas_estimadas: 10, data_prazo: '2026-10-16' }),
  tar({ responsavel_id: 'u1', horas_estimadas: 30, status: 'concluida' }),
]
const propostas = [{ id: 'P1', status: 'enviada', horas: 30 }, { id: 'P2', status: 'aprovada', horas: 10 }, { id: 'P3', status: 'aprovada', horas: 50 }]
const fees = [{ id: 'F1', status: 'ativo', tipo: 'fee', horas_mes: 44 }, { id: 'F2', status: 'ativo', tipo: 'fee', horas_mes: 44 }, { id: 'F3', status: 'ativo', tipo: 'projeto', horas_mes: 44 }]
const r = cargaEquipe({ membros, jobs, tarefas, usuarios, propostas, fees, dias: 7, hoje: H })
const L = (n: string) => r.linhas.find((l) => l.nome === n)

ok(r.de === H && r.ate === '2026-10-11' && r.diasUteis === 5, 'janela "esta semana" = hoje + 6 dias, 5 úteis')
ok(L('Ana Souza')?.capacidade === 40 && L('Bruno Lima')?.capacidade === 40 && L('Bruno Lima')?.jornadaPadrao === true && !L('Saiu'), 'capacidade = jornada × dias úteis; sem jornada = 8 h; inativo fora')
ok(L('Ana Souza')?.comprometido === 4, 'tarefa: saldo (6 − 2) para o responsável; concluída, job concluído e legado fora; estimado do job com tarefas não conta dobrado')
ok(L('Bruno Lima')?.comprometido === 25, 'Bruno (sem usuário) casado pelo nome: tarefa com prazo depois (10 × 5/10) + job sem tarefa (20)')
ok(L('Carla Reis')?.naEquipe === false && L('Carla Reis')?.comprometido === 8 && r.linhas[0].nome === 'Carla Reis', 'responsável fora da equipe aparece primeiro, sem capacidade')
ok(r.semDono === 3, 'trabalho sem responsável fica à parte')
ok(L('Ana Souza')?.situacao === 'folga' && L('Bruno Lima')?.situacao === 'ok' && L('Carla Reis')?.situacao === 'sobrecarga', 'situação: folga < 50%, ok, sobrecarga sem capacidade')
ok(r.previsao.propostas === 40, 'previsão: proposta enviada + aprovada sem job (a aprovada que já virou job não conta)')
ok(r.previsao.fees === 10, 'previsão do fee = horas/mês × 5/22, descontado o que os jobs do fee já comprometem (F1 coberto; projeto fora)')
ok(r.capacidade === 80 && r.comprometido === 40 && r.livre === -10, 'totais: capacidade 80, comprometido 40 (com sem dono), livre = 80 − 40 − 40 − 10')

// RD-83: passar 5 h de uma pessoa para outra move a carga das duas e não muda o total
const r2 = cargaEquipe({ membros, jobs, tarefas: tarefas.map((t) => (t.responsavel_id === 'u2' ? { ...t, responsavel_id: 'u1' } : t)), usuarios, propostas, fees, dias: 7, hoje: H })
ok(r2.linhas.find((l) => l.nome === 'Ana Souza')?.comprometido === 9 && r2.linhas.find((l) => l.nome === 'Bruno Lima')?.comprometido === 20 && r2.comprometido === r.comprometido, 'reatribuir tarefa move a carga e mantém o total')
const r3 = cargaEquipe({ membros, jobs: [...jobs, job({ id: 'G', responsavel_id: 'u1', horas_estimadas: 40, data_prazo: '2026-10-09' })], tarefas, usuarios, dias: 7, hoje: H })
ok(r3.linhas.find((l) => l.nome === 'Ana Souza')?.situacao === 'sobrecarga', 'acima de 100% da jornada = sobrecarga')
const r4 = cargaEquipe({ membros, jobs, tarefas, usuarios, dias: 28, hoje: H })
ok(r4.diasUteis === 20 && r4.linhas.find((l) => l.nome === 'Bruno Lima')?.comprometido === 30, '4 semanas: 20 dias úteis e a tarefa de prazo 16/10 entra inteira')

// tela: Equipe usa o componente; o componente não lê custo; toda chave de "?" existe numa migration
const comp = readFileSync('src/components/pm/CargaEquipe.tsx', 'utf8')
const pagina = readFileSync('src/app/dashboard/pm/equipe/page.tsx', 'utf8')
ok(/<CargaEquipe\b/.test(pagina), 'tela Equipe mostra a carga × capacidade')
ok(!/custo_hora|custo_total/.test(comp), 'carga só com horas, nunca custo (LGPD)')
const sql = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
const chaves = [...new Set([...comp.matchAll(/(?:chave|ajuda)="(pm\.equipe\.[a-z_]+)"/g), ...pagina.matchAll(/chave="(pm\.equipe\.[a-z_]+)"/g)].map((m) => m[1]))]
const faltam = chaves.filter((c) => !sql.includes(`'${c}'`))
ok(chaves.length >= 12 && faltam.length === 0, `"?" da carga e do cadastro com chave em migration (${chaves.length})${faltam.length ? ' — faltam: ' + faltam.join(', ') : ''}`)

if (falhas) { console.error(`\n${falhas} falha(s) no gate da carga da equipe`); process.exit(1) }
console.log('✓ P&M carga × capacidade OK')
