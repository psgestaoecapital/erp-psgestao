// Gate (HB0, auditor F20 em /dashboard/projetos/takeoff) — o take-off mostra as 6 etapas e em qual o usuário está,
// conta os ambientes prontos para orçar (confirmado E com serviço), lista as plantas enviadas com a situação de cada uma,
// rola a tabela dentro do cartão no celular e nunca mostra erro cru do banco. Regra única em src/lib/hub/takeoff.ts. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { contarAmbientes, etapaAtual, etapasTakeoff, plantaAnalisada, situacaoPlanta } from '../../src/lib/hub/takeoff'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regra ──
const amb = [
  { confirmado: true, servico_id: 's1' },
  { confirmado: true, servico_id: null },
  { confirmado: false, servico_id: 's2' },
]
const c = contarAmbientes(amb)
ok(c.total === 3 && c.confirmados === 2 && c.comServico === 2 && c.prontos === 1, 'pronto = confirmado E com serviço (1 de 3)')

const pdf = { status: 'enviada', arquivo_tipo: 'pdf', aps_status: null }
ok(etapaAtual(etapasTakeoff({ planta: null, ambientes: [], orcamentoEscolhido: false, orcamentoGerado: false })) === 0, 'sem planta → etapa 1 (enviar)')
ok(etapaAtual(etapasTakeoff({ planta: pdf, ambientes: [], orcamentoEscolhido: false, orcamentoGerado: false })) === 1, 'planta enviada sem análise → etapa 2 (analisar)')
ok(!plantaAnalisada({ status: 'enviada', arquivo_tipo: 'dwg', aps_status: 'traduzindo' }, 0), 'DWG traduzindo ainda não está analisado')
ok(plantaAnalisada({ status: 'enviada', arquivo_tipo: 'dwg', aps_status: 'radiografado' }, 0), 'DWG radiografado = analisado')
ok(plantaAnalisada(pdf, 1), 'ambiente digitado na mão conta como análise feita')
ok(etapaAtual(etapasTakeoff({ planta: pdf, ambientes: amb, orcamentoEscolhido: false, orcamentoGerado: false })) === 2, 'ambiente sem confirmar → etapa 3 (revisar)')
const tudoPronto = [{ confirmado: true, servico_id: 's1' }, { confirmado: true, servico_id: 's2' }]
ok(etapaAtual(etapasTakeoff({ planta: { ...pdf, status: 'processada' }, ambientes: tudoPronto, orcamentoEscolhido: false, orcamentoGerado: false })) === 4, 'tudo pronto sem orçamento → etapa 5 (escolher orçamento)')
ok(etapaAtual(etapasTakeoff({ planta: { ...pdf, status: 'processada' }, ambientes: tudoPronto, orcamentoEscolhido: true, orcamentoGerado: true })) === 6, 'itens gerados → concluído')
// Semente DEMO Construtora: 4 plantas 'confirmada' com 3 ambientes confirmados e com serviço → fluxo concluído ao reabrir
const demo = { status: 'confirmada', arquivo_tipo: 'pdf', aps_status: null }
const demoAmb = [...Array(3)].map(() => ({ confirmado: true, servico_id: 's' }))
ok(etapaAtual(etapasTakeoff({ planta: demo, ambientes: demoAmb, orcamentoEscolhido: false, orcamentoGerado: false })) === 6, 'DEMO: planta confirmada reaberta → concluído')
ok(situacaoPlanta(demo, contarAmbientes(demoAmb)).rotulo === 'Orçamento gerado', 'DEMO: situação "Orçamento gerado"')
ok(situacaoPlanta({ ...pdf, status: 'processada' }, c).rotulo === '1 de 3 prontos', 'situação parcial: "1 de 3 prontos"')
ok(situacaoPlanta({ ...pdf, status: 'erro' }, c).tom === 'erro', 'erro na análise fica em vermelho')

// ── tela ──
const src = readFileSync('src/app/dashboard/projetos/takeoff/page.tsx', 'utf8')
ok(src.includes("from '@/lib/hub/takeoff'") && src.includes('etapasTakeoff(') && src.includes('contarAmbientes('), 'tela usa a regra única do take-off')
for (const id of ['takeoff-etapas', 'takeoff-etapa', 'takeoff-contadores', 'takeoff-plantas-recentes', 'takeoff-planta-recente', 'takeoff-planta-situacao', 'takeoff-orcamentos-contagem', 'takeoff-catalogo-vazio']) {
  ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)
}
ok(/overflowX: 'auto'/.test(src) && /minWidth: 760/.test(src), 'tabela de ambientes rola dentro do cartão no celular')
ok(src.includes('@/lib/erroAmigavel') && !/setErro\([^)]*\.message\b/.test(src) && !/\$\{[^}]*error\.message\}/.test(src), 'erro do banco passa por erroAmigavel, nunca .message cru')
ok(!/[\u{1F300}-\u{1FAFF}\u{2795}\u{26A0}]/u.test(src), 'sem emoji na tela (RD-96)')
ok(!src.includes('→ a IA extrai'), 'texto do topo em frases (o auditor leu as setas como texto colado)')

// ── "?" das áreas novas existe na tela e em migration (RD-95) ──
const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['etapas', 'cont_extraidos', 'cont_confirmados', 'cont_com_servico', 'cont_prontos', 'plantas_enviadas'].map(k => `projetos.takeoff.${k}`)) {
  ok(src.includes(`'${chave}'`) || src.includes(`"${chave}"`), `"?" ${chave} na tela`)
  ok(mig.includes(`'${chave}'`), `"?" ${chave} no banco (migration)`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-takeoff-etapas`); process.exit(1) }
console.log('\ncheck-hub-takeoff-etapas: verde')
