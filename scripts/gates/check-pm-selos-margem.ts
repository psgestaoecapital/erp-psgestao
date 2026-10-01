// Gate (CEO 01/10 · P&M antes do teste da Pdois):
//  1) selos de estado ("Pronto", "Previsto", "Parcial", "Em breve") só para a equipe PS — no menu e no título das
//     telas de módulo; usuário de cliente não vê selo nenhum;
//  2) Margem por Job: hora apontada sem custo/hora NÃO vira "lucro = valor" — a tela pede para cadastrar o custo da
//     hora da equipe e diz onde (tela Equipe). Sem rede.
import { readFileSync } from 'node:fs'
import { calcularMargem, totaisMargem } from '../../src/lib/pm/margem'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── 1) selos só para a equipe PS ──
const eqps = readFileSync('src/lib/menu/equipe-ps.ts', 'utf8')
ok(/PAPEIS_EQUIPE_PS = \['PS_ADMIN', 'PS_ADMIN_CVM', 'PS_SUPPORT'\]/.test(eqps), 'equipe PS = PS_ADMIN, PS_ADMIN_CVM e PS_SUPPORT')
ok(eqps.includes("return !!userId && res?.uid === userId && res.ps"), 'na dúvida (carregando, sem login, troca de login) o selo não aparece')

const sidebar = readFileSync('src/lib/menu/useSidebarModulos.ts', 'utf8')
ok(sidebar.includes('setIsPS(ehEquipePS(up?.system_role))'), 'menu: quem é PS vem da regra única')
ok(sidebar.includes('...(isPS && r.badge_label ? { badge: r.badge_label } : {})'), 'menu: selo do módulo só com isPS')
const subItem = readFileSync('src/components/layout/SidebarSubItem.tsx', 'utf8')
ok(subItem.includes('{ps && emBreve && ('), 'menu: "em breve" só para a equipe PS')
const preview = readFileSync('src/components/pm/ModuloPreview.tsx', 'utf8')
ok(/\{ps && <span style=\{\{ \.\.\.statusChip, background: cfg\.bg, color: cfg\.fg \}\} data-testid="modulo-selo-estado">/.test(preview),
  'tela de módulo: selo Previsto/Em breve/Pronto só para a equipe PS')
// nenhum outro lugar da tela de módulo imprime o estado
ok((preview.match(/\{cfg\.l\}/g) ?? []).length === 1, 'tela de módulo: o estado aparece num lugar só (o selo protegido)')

// ── 2) Margem por Job ──
const job = { id: 'j1', valor_job: 1000, custo_estimado: null }
const semCustoHora = calcularMargem(job, [{ job_id: 'j1', horas: 4, custo_hora: null, custo_total: null }])
ok(semCustoHora.situacao === 'sem_custo_hora' && semCustoHora.lucro === null && semCustoHora.margem === null && semCustoHora.horasSemCusto === 4,
  'hora apontada sem custo/hora → sem lucro (não é "lucro = valor")')
const misto = calcularMargem(job, [{ job_id: 'j1', horas: 2, custo_hora: 100, custo_total: 200 }, { job_id: 'j1', horas: 3, custo_hora: 0, custo_total: 0 }])
ok(misto.situacao === 'sem_custo_hora' && misto.lucro === null, 'uma pessoa sem custo/hora já deixa o custo incompleto')
const okReal = calcularMargem(job, [{ job_id: 'j1', horas: 2, custo_hora: 100, custo_total: 200 }])
ok(okReal.situacao === 'ok' && okReal.lucro === 800 && okReal.margem === 80 && !okReal.estimado, 'com custo/hora: lucro = valor − horas × custo/hora')
const okEst = calcularMargem({ id: 'j2', valor_job: 1000, custo_estimado: 300 }, [])
ok(okEst.situacao === 'ok' && okEst.lucro === 700 && okEst.estimado, 'sem apontamento: usa o custo estimado')
const semCusto = calcularMargem({ id: 'j3', valor_job: 1000, custo_estimado: null }, [])
ok(semCusto.situacao === 'sem_custo' && semCusto.lucro === null, 'sem apontamento e sem estimativa → "sem custo lançado", sem lucro')
const tot = totaisMargem([semCustoHora, okReal, okEst, semCusto])
ok(tot.valor === 2000 && tot.custo === 500 && tot.lucro === 1500 && tot.semCustoHora === 1 && tot.semCusto === 1,
  'totais só com jobs de custo completo; os incompletos contados à parte')

const pagina = readFileSync('src/app/dashboard/pm/margem-job/page.tsx', 'utf8')
ok(pagina.includes("const ROTA_CUSTO_HORA = '/dashboard/pm/equipe'") && pagina.includes('Cadastre o custo da hora da equipe'),
  'a tela diz o que fazer e leva à tela Equipe')
ok(!/valor\s*-\s*custo/.test(pagina.replace(/\/\/[^\n]*/g, '')), 'a tela não calcula lucro por conta própria (usa a regra única)')
const equipe = readFileSync('src/app/dashboard/pm/equipe/page.tsx', 'utf8')
ok(equipe.includes('Custo/hora (R$)'), 'tela Equipe tem o campo "Custo/hora (R$)"')

if (falhas) { console.error(`\ncheck-pm-selos-margem: ${falhas} falha(s)`); process.exit(1) }
console.log('\nP&M · selos só PS + margem sem custo/hora: ok')
