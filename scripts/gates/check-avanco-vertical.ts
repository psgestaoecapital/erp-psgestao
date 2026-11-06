// Gate (CEO 16/10) — seção "Avanço por vertical" do Painel de Codes: regras puras + painel protegido + migration aditiva.
import { readFileSync } from 'node:fs'
import { fmtPct, ordenar, resumoOndas, semaforo, serieHistorico, type Cobertura } from '../../src/lib/dev/avancoVertical'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const cob = (v: string, g: number | null): Cobertura => ({ ok: true, vertical: v, geral_pct: g, essenciais_pct: g, total_requisitos: 10, total_provado_por_jornada: 1, por_tela: [] })

ok(semaforo(77.9) === 'verde' && semaforo(31.3) === 'amarelo' && semaforo(11.4) === 'vermelho' && semaforo(0) === 'vermelho' && semaforo(null) === 'neutro', 'semáforo: 77,9 verde · 31,3 amarelo · 11,4 e 0 vermelho · sem dado neutro')
ok(fmtPct(11.4) === '11,4%' && fmtPct(null) === '—', 'formato do % em pt-BR')
const o = ordenar([cob('pm', 31.3), cob('ehs', 22.4), cob('hub_projetos', 11.4), { ...cob('x', 1), ok: false }])
ok(o.map((c) => c.vertical).join() === 'hub_projetos,ehs,pm', 'ordem: Hub primeiro, resto alfabético, ok=false descartado')
const s = serieHistorico([
  { dia: '2026-10-17', vertical: 'pm', geral_pct: 32 }, { dia: '2026-10-16', vertical: 'pm', geral_pct: 31.3 }, { dia: '2026-10-16', vertical: 'ehs', geral_pct: 22.4 },
])
ok(s.length === 2 && s[0].dia === '2026-10-16' && s[0].ehs === 22.4 && s[1].pm === 32, 'linha do tempo: um ponto por dia, uma chave por vertical, ordenada')
const r = resumoOndas([{ onda: 200, concluidos: 1, em_andamento: 1, planejados: 2 }, { onda: 201, concluidos: 0, em_andamento: 0, planejados: 4 }])
ok(r.total === 8 && r.concluidos === 1 && r.pct === 12.5 && resumoOndas([]).pct === 0, 'ondas: soma e % concluído (vazio = 0)')

const painel = readFileSync('src/components/dev/PainelCodes.tsx', 'utf8')
ok(/<BlocoSeguro[^>]*>\s*<AvancoVertical\b/.test(painel), 'AvancoVertical protegido por BlocoSeguro no painel')
const comp = readFileSync('src/components/dev/AvancoVertical.tsx', 'utf8')
ok(/supabase\.rpc\('fn_dev_avanco_vertical'\)/.test(comp) && !/\.channel\(/.test(comp), 'componente lê pela RPC com guarda e não assina canal Realtime')
const CHAVES_AJUDA = ['mapeado', 'essencial', 'jornada', 'ondas', 'linha_tempo', 'telas', 'geral', 'tela', 'ondas_legenda']
for (const k of CHAVES_AJUDA) ok(comp.includes(`dev.codes.avanco.${k}`), `"?" ${k}`)
const mig = readFileSync('supabase/migrations/20261030160000_dev_avanco_vertical.sql', 'utf8')
for (const k of CHAVES_AJUDA) ok(mig.includes(`'dev.codes.avanco.${k}'`), `migration traz o texto do "?" ${k}`)
ok(!/\bDROP\s+(TABLE|FUNCTION)|TRUNCATE|DELETE\s+FROM\s+(?!erp_dev_vertical_historico)/i.test(mig), 'RD-97: migration aditiva (sem DROP/TRUNCATE/DELETE fora do histórico novo)')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /fn_dev_painel_pode_ver\(\)/.test(mig), 'RLS ligada e leitura só equipe PS')
process.exit(falhas ? (console.error(`check-avanco-vertical: ${falhas} falha(s)`), 1) : (console.log('check-avanco-vertical: ok'), 0))
