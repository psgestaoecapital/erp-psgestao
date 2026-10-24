// Gate (HB0, auditor F15 em /dashboard/projetos/propostas) — o funil de propostas é honesto (conta o que está na lista,
// taxa só sobre o que o cliente decidiu, "vence em 7 dias" só para proposta em aberto), a tela usa essa regra única
// (src/lib/hub/propostas.ts), rola dentro do cartão no celular e nunca mostra erro cru do banco. Sem rede.
import { readFileSync, readdirSync } from 'node:fs'
import { diasParaVencer, resumoFunil, type PropostaFunil } from '../../src/lib/hub/propostas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// ── regra (hoje fixo: 24/10/2026) ──
const hoje = new Date(2026, 9, 24)
ok(diasParaVencer('2026-10-30', hoje) === 6, 'validade 30/10 → 6 dias')
ok(diasParaVencer('2026-10-24', hoje) === 0, 'validade hoje → 0 dias')
ok(diasParaVencer('2026-10-20', hoje) === -4, 'validade passada → negativo (vencida)')
ok(diasParaVencer(null, hoje) === null && diasParaVencer('lixo', hoje) === null, 'sem validade → null')

const ls: PropostaFunil[] = [
  { status: 'enviado', total: 45000, data_validade: '2026-10-30' },
  { status: 'rascunho', total: 10000, data_validade: '2026-12-31' },
  { status: 'visualizado', total: 5000, data_validade: '2026-10-20' },
  { status: 'aprovado', total: 100000, data_validade: '2026-10-25' },
  { status: 'convertido', total: 60000, data_validade: null },
  { status: 'recusado', total: 30000, data_validade: null },
]
const r = resumoFunil(ls, hoje)
ok(r.total === 6 && r.abertas === 3 && r.valorAberto === 60000, 'em aberto = rascunho + enviado + visualizado (3 · 60.000)')
ok(r.ganhas === 2 && r.valorGanho === 160000, 'aprovadas = aprovado + virou pedido (2 · 160.000)')
ok(r.taxaAprovacao === 67, 'taxa = 2 ganhas ÷ 3 decididas = 67%')
ok(r.aVencer === 1 && r.valorAVencer === 45000, 'vence em 7 dias: só aberta com validade 0–7 (aprovada e vencida não contam)')
ok(r.porStatus.enviado?.n === 1 && r.porStatus.aprovado?.valor === 100000, 'funil por situação conta e soma')
ok(resumoFunil([{ status: 'enviado', total: 1, data_validade: null }], hoje).taxaAprovacao === null, 'sem decisão do cliente → sem taxa (—)')
// Semente DEMO (Construtora): 4 aprovadas + 1 enviada → taxa 100%
ok(resumoFunil([...Array(4)].map(() => ({ status: 'aprovado', total: 1, data_validade: null })).concat([{ status: 'enviado', total: 1, data_validade: null }]), hoje).taxaAprovacao === 100, 'DEMO 4 aprovadas + 1 enviada → 100%')

// ── tela ──
const src = readFileSync('src/app/dashboard/projetos/propostas/page.tsx', 'utf8')
ok(src.includes("from '@/lib/hub/propostas'") && src.includes('resumoFunil(linhas)'), 'tela usa a regra única do funil')
for (const id of ['hub-propostas-indicadores', 'hub-propostas-funil', 'hub-propostas-funil-etapa', 'hub-propostas-taxa', 'hub-propostas-a-vencer', 'hub-proposta-validade']) {
  ok(src.includes(`data-testid="${id}"`), `tela tem ${id}`)
}
ok(/overflowX: 'auto'/.test(src) && /minWidth: \d{3,4}\b/.test(src), 'lista rola dentro do cartão no celular (página não rola de lado)')
ok(src.includes('@/lib/erroAmigavel') && !/setErro\([^)]*\.message\b/.test(src), 'erro do banco passa por erroAmigavel, nunca .message cru')

// ── "?" das áreas novas existe na tela e em migration (RD-95) ──
const mig = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).map(f => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n')
for (const chave of ['em_aberto', 'aprovadas', 'taxa_aprovacao', 'a_vencer', 'funil', 'validade'].map(c => `projetos.propostas.${c}`)) {
  ok(src.includes(`chave="${chave}"`) && mig.includes(`'${chave}'`), `"?" ${chave} na tela e no banco`)
}

if (falhas) { console.error(`\n${falhas} falha(s) — check-hub-propostas-funil`); process.exit(1) }
console.log('\ncheck-hub-propostas-funil: verde')
