// Gate (CEO 16/10 19:15) — aba "Infraestrutura" do Painel de Codes: números com dados conhecidos, semáforo com limites
// visíveis, dado ruim sem exceção, cada bloco sob BlocoSeguro, leitura só pelas funções guardadas e "?" com chave no banco.
import { readFileSync } from 'node:fs'
import { ETAPAS, LIMITES, NOME_AGENTE, estadoAgente, legivelCron, lerAgentes, lerDesempenho, resumirEtapas, saldo, semaforo, type AgenteInfra } from '../../src/lib/dev/infraestrutura'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }

// semáforo com limites conhecidos
ok(semaforo('resp_20min_pct', 91) === 'verde' && semaforo('resp_20min_pct', 77.8) === 'amarelo' && semaforo('resp_20min_pct', 50) === 'vermelho', 'resposta em 20 min: 91 verde, 77,8 amarelo, 50 vermelho')
ok(semaforo('publicadas_por_hora', 4) === 'verde' && semaforo('publicadas_por_hora', 2.13) === 'amarelo' && semaforo('publicadas_por_hora', 1.54) === 'vermelho', 'publicadas por hora: meta 4/h')
ok(semaforo('main_vermelha_min', 0) === 'verde' && semaforo('main_vermelha_min', 30) === 'amarelo' && semaforo('main_vermelha_min', 120) === 'vermelho', 'main vermelha: 0 verde')
ok(semaforo('saldo', null) === 'sem_dado' && semaforo('saldo', NaN) === 'sem_dado' && semaforo('saldo', undefined) === 'sem_dado', 'sem número = sem_dado (nunca verde)')
ok(Object.values(LIMITES).every(l => (l.menor ? l.bom <= l.medio : l.bom >= l.medio)), 'limites coerentes (bom melhor que médio)')

// números conhecidos (fotografia real de 17/10) → resumo por etapa
const d = lerDesempenho({
  ok: true, chamados_abertos: 43, chamados_idade_media_h: 89, main_vermelha_min: 0, esteira_sensiveis_esperando: 4, esteira_migrations_na_fila: 2,
  esteira_estados: { esperando: 1, 'fora-da-rodada': 27 },
  hoje: { chamados_novos: 36, resp_20min_pct: 77.8, prs_produzidas: 12, prs_publicadas: 15, publicadas_por_hora: 2.13, aberta_pronta_min: 286.4, pronta_publicada_min: 867,
    auditor_telas: 1, auditor_vereditos: { BRONZE: 21, PENDENTE: 27, OURO: 3 }, auditor_nota_hub: null, achados_abertos: 1, achados_fechados: 0, achado_correcao_min: null },
  d7: { prs_produzidas: 408, prs_publicadas: 258, publicadas_por_hora: 1.54, resp_20min_pct: 91 },
})
ok(!!d, 'resposta válida é lida')
const h = resumirEtapas(d!, 'hoje'), s7 = resumirEtapas(d!, 'd7')
const met = (r: typeof h, e: string, k: string) => r.find(x => x.id === e)!.metricas.find(x => x.chave === k)!
ok(h.length === 6 && h.map(e => e.id).join() === ETAPAS.map(e => e.id).join(), 'seis etapas, na ordem do fluxograma')
ok(saldo(d!.hoje) === -3 && met(h, 'publicacao', 'saldo').valor === '-3', 'saldo hoje = 12 produzidas − 15 publicadas = −3')
ok(saldo(d!.d7) === 150 && met(s7, 'publicacao', 'saldo').semaforo === 'vermelho', 'saldo 7 dias = 408 − 258 = 150 (vermelho)')
ok(met(h, 'pedido', 'resp20').valor === '77,8%' && met(h, 'pedido', 'resp20').semaforo === 'amarelo', 'pedido: 77,8% em 20 min, amarelo')
ok(met(h, 'pedido', 'abertos').valor === '43' && met(h, 'pedido', 'idade').valor === '3,7 dias', 'pedido: 43 abertos, idade média 89 h = 3,7 dias')
ok(met(h, 'constroi', 'aberta_pronta').valor === '4,8 h', 'constrói: 286,4 min = 4,8 h')
ok(met(h, 'esteira', 'sensiveis').semaforo === 'amarelo' && met(h, 'esteira', 'pronta_pub').valor === '14,5 h', 'esteira: 4 sensíveis amarelo; 867 min = 14,5 h')
ok(met(h, 'auditor', 'nota').valor === '—' && met(h, 'auditor', 'nota').semaforo === 'sem_dado', 'auditor: nota ausente aparece "—", sem semáforo')
ok(met(h, 'auditor', 'vereditos').valor.includes('OK 3') && met(h, 'auditor', 'vereditos').valor.includes('não auditada 27'), 'auditor: vereditos OK 3 e não auditada 27')
ok(h.find(e => e.id === 'esteira')!.semaforo === 'vermelho', 'semáforo da etapa = pior dos números (pronta→publicada 14,5 h é vermelho)')

// dado ruim: sem exceção
ok(lerDesempenho(null) === null && lerDesempenho({ ok: false, erro: 'sem_acesso' }) === null && lerDesempenho('x') === null, 'sem acesso/nulo/texto = null')
const ruim = lerDesempenho({ ok: true, hoje: 'x', d7: [], chamados_abertos: 'a', esteira_estados: [1], main_vermelha_min: {} })
ok(!!ruim && ruim.chamados_abertos === 0 && ruim.hoje.prs_produzidas === 0 && ruim.hoje.resp_20min_pct === null, 'dado malformado vira zeros/nulos')
let lancou = false
try { resumirEtapas(ruim!, 'hoje'); resumirEtapas(ruim!, 'd7') } catch { lancou = true }
ok(!lancou, 'resumo de dado malformado não lança')
ok(lerAgentes(null) === null && lerAgentes({ ok: true, agentes: 'x' }) === null && (lerAgentes({ ok: true, agentes: [1, null, { agente: 'a' }] }) ?? []).length === 1, 'agentes malformados são ignorados')

// agentes
const agora = new Date('2026-10-17T12:00:00Z')
const ag = (o: Partial<AgenteInfra>): AgenteInfra => ({ agente: 'x', aciona: true, observacao: '', cron_job: null, cron_agenda: null, cron_ativo: null, iniciada_em: null, renovada_em: null, ...o })
ok(estadoAgente(ag({ iniciada_em: '2026-10-17T11:50:00Z', renovada_em: '2026-10-17T11:58:00Z' }), agora) === 'trabalhando', 'lease recente = trabalhando')
ok(estadoAgente(ag({ iniciada_em: '2026-10-17T09:00:00Z', renovada_em: '2026-10-17T09:30:00Z' }), agora) === 'esperando', 'sessão há 2,5 h = esperando')
ok(estadoAgente(ag({ iniciada_em: '2026-10-15T09:00:00Z', renovada_em: '2026-10-15T09:30:00Z' }), agora) === 'dormindo', 'sem sessão há > 24 h = dormindo')
ok(estadoAgente(ag({}), agora) === 'dormindo' && estadoAgente(ag({ aciona: false, iniciada_em: '2026-10-17T09:00:00Z', renovada_em: '2026-10-17T09:30:00Z' }), agora) === 'dormindo', 'sem lease ou desligado = dormindo')
ok(NOME_AGENTE('eng-chefe-auto') === 'Code-Auditor' && NOME_AGENTE('rodrigo-code') === 'rodrigo-code', 'eng-chefe-auto aparece como Code-Auditor')
ok(legivelCron('*/5 * * * *') === 'a cada 5 min' && legivelCron(null) === 'por evento', 'agenda do cron legível')

// tela, migration e "?"
const tela = readFileSync('src/components/dev/AbaInfraestrutura.tsx', 'utf8')
const central = readFileSync('src/app/dashboard/dev/page.tsx', 'utf8')
const mig = readFileSync('supabase/migrations/20261017200000_dev_infraestrutura.sql', 'utf8')
for (const n of ['BlocoFluxograma', 'BlocoAgentes', 'BlocoDesempenho']) ok(new RegExp(`<BlocoSeguro[^>]*>\\s*<${n}\\b`).test(tela), `${n} sob BlocoSeguro`)
ok(/rpc\('fn_dev_infra_desempenho'\)/.test(tela) && /rpc\('fn_dev_infra_agentes'\)/.test(tela) && !/\.from\(/.test(tela), 'tela lê só pelas funções guardadas')
ok(/Promise\.allSettled/.test(tela), 'falha de uma leitura não derruba a outra')
ok(/<AbaInfraestrutura\s*\/>/.test(central) && /Infraestrutura/.test(central), 'Central monta a aba Infraestrutura')
ok(/fn_dev_painel_pode_ver\(\)/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_dev_infra_desempenho\(\) FROM PUBLIC, anon/.test(mig) && /REVOKE ALL ON FUNCTION public\.fn_dev_infra_agentes\(\) FROM PUBLIC, anon/.test(mig), 'funções guardadas pela equipe PS e sem anon')
ok(!/\b(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/.test(mig.replace(/--.*$/gm, '')), 'migration aditiva (RD-97)')
// toda chave de "?" usada (fixas + por métrica) existe na migration
const chaves = new Set<string>([...tela.matchAll(/chave="(dev\.infra\.[a-z0-9_.]+)"/g)].map(m => m[1]))
for (const e of h) for (const m of e.metricas) chaves.add(`dev.infra.${e.id}.${m.chave}`)
const faltam = [...chaves].filter(c => !mig.includes(`'${c}'`))
ok(chaves.size >= 26 && faltam.length === 0, `todas as ${chaves.size} chaves de "?" existem na migration${faltam.length ? ' — faltam: ' + faltam.join(', ') : ''}`)
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(tela + readFileSync('src/lib/dev/infraestrutura.ts', 'utf8')), 'sem emoji (RD-96)')
process.exit(falhas ? 1 : 0)
