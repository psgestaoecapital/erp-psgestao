// Gate · PM-D — Meu Dia, cronômetro, comentários com @, minhas últimas ações e anotações (CEO 02/10). Sem rede.
// 1) regras puras: menção só de quem é da equipe (nome inteiro), sugestão enquanto digita, destaque, relógio,
//    horas do cronômetro (mínimo 0,01 h) e a linha do tempo das minhas ações;
// 2) a tela: cronômetro é a linha aberta do timesheet (sobrevive ao recarregar), anotação só da pessoa,
//    comentário em nome de quem escreve com as menções; menu "Meu dia"; demo só na P&M e no reset.
import { readFileSync } from 'node:fs'
import { buscaMencao, extrairMencoes, horasDoCronometro, inserirMencao, juntarAcoes, partesComMencao, relogio, sugerirPessoas } from '../../src/lib/pm/meuDia'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

const eq = [{ id: 'a', nome: 'Ana Ribeiro' }, { id: 'g', nome: 'Gilberto' }, { id: 'an', nome: 'Ana' }]
ok(extrairMencoes('@Ana Ribeiro veja isto e @gilberto também', eq).sort().join() === 'a,g', 'menções: Ana Ribeiro (não a Ana) e Gilberto')
ok(extrairMencoes('@Ana e @Ana Ribeiro', eq).sort().join() === 'a,an', 'as duas Anas quando as duas são chamadas')
ok(extrairMencoes('@Gilbertox não é ninguém', eq).length === 0, 'nome colado em outra palavra não vira menção')
ok(extrairMencoes('fale com @Gilberto.', eq).join() === 'g', 'menção com pontuação depois')
ok(extrairMencoes('mande para ana@empresa.com', eq).length === 0, 'e-mail não vira menção')
ok(buscaMencao('oi @Gil', 7)?.termo === 'Gil' && buscaMencao('ana@empresa', 11) === null, 'sugestão só depois de @ solto')
ok(sugerirPessoas('ana', eq).length === 2 && inserirMencao('oi @Gil', 3, 7, eq[1]) === 'oi @Gilberto ', 'lista de sugestões e inserção da menção')
const partes = partesComMencao('@Ana Ribeiro pode seguir', eq)
ok(partes[0].mencao && partes[0].texto === '@Ana Ribeiro' && !partes[1].mencao, 'destaque pega o nome mais longo (Ana Ribeiro, não Ana)')
ok(relogio(3909) === '01:05:09' && relogio(-5) === '00:00:00', 'relógio do cronômetro')
const ini = '2026-10-02T12:00:00Z'
ok(horasDoCronometro(ini, new Date('2026-10-02T13:30:00Z')) === 1.5 && horasDoCronometro(ini, new Date('2026-10-02T12:00:05Z')) === 0.01, 'horas do cronômetro (mínimo 0,01 h)')
const acoes = juntarAcoes(
  [{ criado_em: '2026-10-02T10:00:00Z', texto: 'Ajuste B pedido pelo cliente: x', job_id: 'j1' }, { criado_em: '2026-10-02T09:00:00Z', texto: 'oi', job_id: 'j1' }],
  [{ inicio_em: ini, created_at: ini, horas: 1.5, job_id: 'j1', fim_em: '2026-10-02T11:00:00Z' }, { inicio_em: ini, created_at: ini, horas: 0, job_id: 'j1', fim_em: null }],
  [{ criado_em: '2026-10-02T08:00:00Z', acao: 'editar', job_ids: ['j1', 'j2'], desfeito_em: null }])
ok(acoes.length === 4 && acoes[0].tipo === 'horas' && acoes[1].tipo === 'acao' && acoes[3].tipo === 'massa' && acoes[0].texto === 'Apontou 1 h 30', 'minhas últimas ações em ordem (cronômetro aberto não entra)')

const cron = readFileSync('src/components/pm/Cronometro.tsx', 'utf8')
ok(/\.is\("fim_em", null\)/.test(cron) && /horas: 0,/.test(cron) && /update\(\{ fim_em: fim\.toISOString\(\), horas \}\)/.test(cron), 'cronômetro = linha aberta do timesheet (sobrevive ao recarregar)')
ok(/if \(aberto && !\(await parar\(true\)\)\) return;/.test(cron), 'trocar de job para o cronômetro anterior antes')
const com = readFileSync('src/components/pm/JobComentarios.tsx', 'utf8')
ok(/autor_id: userId/.test(com) && /mencoes: extrairMencoes\(texto, equipe\)/.test(com), 'comentário em nome de quem escreve, com as menções')
const dia = readFileSync('src/app/dashboard/pm/meu-dia/page.tsx', 'utf8')
ok(/\.contains\("mencoes", \[uid\]\)/.test(dia) && /p_filtros: \{ atalho: "meus" \}/.test(dia), 'Meu dia: menções para mim e a mesma regra "Meus" da Pauta')
ok(/insert\(\{ company_id: empresa, user_id: userId, texto/.test(dia) && /excluido_em: new Date\(\)\.toISOString\(\)/.test(dia), 'anotação da própria pessoa; arquivar é lógico (RD-30)')
const pauta = readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8')
ok(/<JobComentarios key=/.test(pauta) && /<Cronometro key=/.test(pauta) && /get\("job"\)/.test(pauta), 'job aberto da Pauta com comentários, cronômetro e link ?job=')

const mig = readFileSync('supabase/migrations/20261002280000_pm_d_meu_dia.sql', 'utf8')
ok(/'pm_meu_dia', 'Meu dia', 'pm', 'pm_producao', 'Sun', '\/dashboard\/pm\/meu-dia'/.test(mig) && /WHERE pm\.module_id = 'pm_jobs'/.test(mig), 'menu "Meu dia" nos planos do P&M')
ok(/IF p_company_id IS DISTINCT FROM v_demo/.test(mig) && /fn_demo_seed_pm_dia\(p_company_id\)/.test(mig) && /IF v_new = v_def THEN RAISE EXCEPTION/.test(mig), 'demo só na P&M e no reset (RD-69)')
ok(/REVOKE ALL ON FUNCTION public\.fn_demo_seed_pm_dia\(uuid\) FROM PUBLIC, anon, authenticated;/.test(mig), 'seed sem acesso de usuário')
for (const k of ['pm.dia.cronometro.job', 'pm.dia.anotacao.texto', 'pm.job.comentario.texto']) ok(mig.includes(`'${k}'`), `"?" ${k} no banco`)
ok(!/\b(CREATE TABLE|DELETE\s+FROM)\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'nenhuma tabela nova e nada apagado')

if (falhas) { console.error(`\ncheck-pm-d-meu-dia: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPM-D Meu dia: ok')
