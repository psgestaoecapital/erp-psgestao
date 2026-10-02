// Gate · PM-C — rodada de ajuste, "Aguardando" com motivo e aprovação do cliente com prazo (CEO 02/10). Sem rede.
// 1) regras puras: letra da rodada, prazo da aprovação (vencida / vence hoje / até…) e tempo parado;
// 2) as 5 funções gravam com guarda de empresa, recusam o que não tem motivo e deixam linha no feed;
//    nada aberto a anônimo; nada apagado; demo só na P&M e no reset;
// 3) a tela usa SÓ as funções (nunca grava rodada/aprovação direto) e cada campo do fluxo tem o "?".
import { readFileSync } from 'node:fs'
import { letraRodada, codigoJob, prazoAprovacao, tempoParado, textoAguardando } from '../../src/lib/pm/pauta'

let falhas = 0
const ok = (c: boolean, m: string) => { if (c) console.log('✓', m); else { falhas++; console.error('✗', m) } }

ok(letraRodada(1) === 'A' && letraRodada(2) === 'B' && letraRodada(0) === '' && codigoJob('24101', 2) === '24101B', 'código com a letra da rodada (24101B)')
const agora = new Date('2026-10-02T16:00:00Z') // 13h em São Paulo
ok(prazoAprovacao('2026-10-02T21:00:00Z', agora).nivel === 'hoje' && prazoAprovacao('2026-10-02T21:00:00Z', agora).texto === 'vence hoje às 18h', 'aprovação que vence hoje às 18h')
ok(prazoAprovacao('2026-09-30T15:00:00Z', agora).texto === 'vencida há 2 dias' && prazoAprovacao('2026-09-30T15:00:00Z', agora).nivel === 'vencida', 'aprovação vencida há 2 dias')
ok(prazoAprovacao('2026-10-02T13:00:00Z', agora).texto === 'vencida há 3 h', 'aprovação vencida há poucas horas')
ok(prazoAprovacao('2026-10-06T21:00:00Z', agora).texto === 'até 06/10 às 18h' && prazoAprovacao('2026-10-06T21:00:00Z', agora).nivel === 'ok', 'aprovação com prazo futuro')
ok(tempoParado('2026-09-29T16:00:00Z', agora) === 'há 3 dias' && tempoParado('2026-10-02T11:00:00Z', agora) === 'há 5 h', 'tempo parado no "Aguardando"')
ok(textoAguardando('cliente', 3, 'Material do cliente') === 'aguardando cliente · material do cliente · há 3 dias', 'selo do aguardando com motivo e tempo')

const mig = readFileSync('supabase/migrations/20261002260000_pm_c_fluxo_job.sql', 'utf8')
const fn = (n: string) => { const i = mig.indexOf(`FUNCTION public.${n}(`); return i < 0 ? '' : mig.slice(i, mig.indexOf('END $$;', i)) }
for (const f of ['fn_pm_job_pedir_ajuste', 'fn_pm_job_aguardar', 'fn_pm_job_retomar', 'fn_pm_job_enviar_aprovacao', 'fn_pm_job_decidir_aprovacao']) {
  const b = fn(f)
  ok(/PERFORM public\.fn__guarda_empresa\(j\.company_id\);/.test(b), `${f}: só quem é da empresa do job`)
}
ok(/motivo_obrigatorio/.test(fn('fn_pm_job_pedir_ajuste')) && /ON CONFLICT \(job_id, rodada\)/.test(fn('fn_pm_job_pedir_ajuste')), 'pedir ajuste exige motivo e não quebra com rodada já guardada')
ok(/UPDATE agency_aprovacoes SET decisao = 'ajustar'/.test(fn('fn_pm_job_pedir_ajuste')), 'ajuste fecha a aprovação aberta')
ok(/motivo_invalido/.test(fn('fn_pm_job_aguardar')) && /lista = 'motivo_aguardando'/.test(fn('fn_pm_job_aguardar')), 'aguardando só com motivo da lista da agência')
ok(/fn__somar_dias_uteis\(.*COALESCE\(v_dias, 2\)\) \+ time '18:00'/.test(fn('fn_pm_job_enviar_aprovacao')) && /prazo_passado/.test(fn('fn_pm_job_enviar_aprovacao')), 'aprovação: padrão 2 dias úteis às 18h; prazo no passado recusado')
ok(/sem_aprovacao_aberta/.test(fn('fn_pm_job_decidir_aprovacao')) && /RETURN public\.fn_pm_job_pedir_ajuste\(p_job_id, p_motivo, 'cliente'\)/.test(fn('fn_pm_job_decidir_aprovacao')), '"pediu ajuste" abre a próxima rodada')
ok((mig.match(/PERFORM public\.fn__pm_job_registrar/g) ?? []).length >= 5, 'cada ação deixa linha no feed do job')
ok(/REVOKE ALL ON FUNCTION public\.fn__pm_job_registrar\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated;/.test(mig), 'auxiliar do feed sem acesso direto')
ok(/fn_pm_job_decidir_aprovacao\(uuid, text, text\) FROM PUBLIC, anon;/.test(mig), 'nenhuma função aberta a anônimo')
ok(/IF p_company_id IS DISTINCT FROM v_demo/.test(fn('fn_demo_seed_pm_fluxo')) && /fn_demo_seed_pm_fluxo\(p_company_id\)/.test(mig), 'demo só na P&M e no reset (RD-69)')
ok(!/\bDELETE\s+FROM\b/i.test(mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')), 'nada é apagado (RD-30)')
for (const k of ['pm.job.ajuste.motivo', 'pm.job.ajuste.quem', 'pm.job.aguardando.de', 'pm.job.aguardando.motivo', 'pm.job.aprovacao.prazo', 'pm.job.aprovacao.decisao'])
  ok(mig.includes(`'${k}'`), `"?" ${k} no banco`)

const tela = readFileSync('src/components/pm/JobFluxo.tsx', 'utf8')
ok(!/from\("agency_(job_rodadas|aprovacoes|jobs)"\)\.(insert|update|upsert|delete)/.test(tela), 'a tela nunca grava rodada/aprovação/job direto — só pelas funções')
for (const f of ['fn_pm_job_pedir_ajuste', 'fn_pm_job_aguardar', 'fn_pm_job_retomar', 'fn_pm_job_enviar_aprovacao', 'fn_pm_job_decidir_aprovacao'])
  ok(tela.includes(`"${f}"`), `tela usa ${f}`)
const campos = (tela.match(/<(select|textarea|input)\b/g) ?? []).length
const ajudas = (tela.match(/<Rotulo texto=/g) ?? []).length
ok(campos === ajudas && campos >= 5, `todo campo do fluxo tem o "?" (${ajudas}/${campos})`)
const pag = readFileSync('src/app/dashboard/pm/pauta/page.tsx', 'utf8')
ok(/<JobFluxo key=\{aberto\.id\}/.test(pag) && /data-testid="pauta-selo-aprovacao"/.test(pag), 'Pauta: fluxo no job aberto e selo da aprovação na lista')

// decisão do CEO 02/10: a demo da P&M ganha a equipe PS (como GE/Mecânica/Indústria), só se for demo, sem duplicar
ok(/INSERT INTO public\.user_companies \(user_id, company_id, role, origem\)/.test(mig) && /uc\.origem = 'equipe_ps'/.test(mig)
  && /c\.is_demo IS TRUE/.test(mig) && /ON CONFLICT \(user_id, company_id\) DO NOTHING/.test(mig), 'demo da P&M: equipe PS ligada (só demo, idempotente)')

if (falhas) { console.error(`\ncheck-pm-c-fluxo-job: ${falhas} falha(s)`); process.exit(1) }
console.log('\nPM-C fluxo do job: ok')
