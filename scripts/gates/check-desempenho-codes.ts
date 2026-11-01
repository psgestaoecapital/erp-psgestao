// Gate (CEO 09/10) — gráficos de desempenho da aba Codes: regras puras de src/lib/dev/desempenhoCodes.ts.
import { pilhaProntas, producaoPublicacao, resumoProducao, publicacoesPorDia, publicacoesPorHora, vazaoPorDia } from '../../src/lib/dev/desempenhoCodes'
import type { Entrega } from '../../src/lib/dev/painelCodes'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const ev = (pr: number, evento: Entrega['evento'], em: string, code = 'gilberto-produto'): Entrega =>
  ({ id: pr * 10, pr_numero: pr, titulo: 't', code, evento, via: 'rapida', sha: evento + pr, url: null, ocorrido_em: em })

const agora = new Date('2026-10-09T15:30:00Z')
const es = [
  ev(1, 'pronta', '2026-10-09T13:00:00Z'), ev(1, 'publicada', '2026-10-09T13:45:00Z'),
  ev(2, 'pronta', '2026-10-09T14:10:00Z', 'rodrigo-code'), ev(2, 'publicada', '2026-10-09T14:50:00Z', 'rodrigo-code'),
  ev(3, 'pronta', '2026-10-09T15:00:00Z'),
  ev(4, 'pronta', '2026-10-08T12:00:00Z'), ev(4, 'publicada', '2026-10-08T13:00:00Z'),
]
const h = publicacoesPorHora(es, agora, 24)
ok(h.length === 24 && h.reduce((s, p) => s + p.total, 0) === 2, 'por hora: 2 publicações nas últimas 24 h')
ok(h[h.length - 1].total === 0 && h.find((p) => p.porCode['rodrigo-code'])?.total === 1, 'por hora: separa por Code')
const d = publicacoesPorDia(es, agora, 7)
ok(d.length === 7 && d[6].total === 2 && d[5].total === 1, 'por dia: 2 hoje e 1 ontem (fuso São Paulo)')
const pilha = pilhaProntas(es, agora, 3)
ok(pilha[2].prontas === 1 && pilha[1].prontas <= 2, 'pilha: só a PR 3 segue pronta e não publicada')
const v = vazaoPorDia(es, agora, 7)
ok(v[6].medianaMin === 43 && v[6].n === 2 && v[5].medianaMin === 60 && v[0].medianaMin === null, 'vazão: mediana pronta→publicada por dia (45 e 40 min → 43)')

// CEO 16/10: produzidas × publicadas, fila acumulada, saldo e semáforo (dados conhecidos)
const ev2 = es.concat([ev(5, 'aberta', '2026-10-09T15:05:00Z', 'rodrigo-code'), ev(6, 'aberta', '2026-10-09T15:10:00Z'), ev(6, 'aberta', '2026-10-09T15:12:00Z'),
  ev(1, 'aberta', '2026-10-09T12:50:00Z'), ev(2, 'aberta', '2026-10-09T14:00:00Z', 'rodrigo-code')])
const pr = producaoPublicacao(ev2, agora, 'hoje')
const res = resumoProducao(pr, 'hoje')
ok(pr.length === 24 && res.produzidas === 4 && res.publicadas === 2 && res.saldo === 2, 'produção: 4 produzidas (PR distinta), 2 publicadas, saldo +2')
ok(pr[23].produzidas === 2 && pr[23].fila === 2 && pr[22].fila === 0, 'produção: fila acumulada soma hora a hora')
ok(res.semaforo === 'amarelo' && resumoProducao(pr.map((p) => ({ ...p, produzidas: 0, publicadas: 1 })), 'hoje').semaforo === 'verde'
  && resumoProducao(pr.map((p) => ({ ...p, produzidas: 1 })), 'hoje').semaforo === 'vermelho', 'semáforo: verde, amarelo e vermelho')
const rod = resumoProducao(producaoPublicacao(ev2, agora, 'hoje', 'rodrigo-code'), 'hoje')
ok(rod.produzidas === 2 && rod.publicadas === 1, 'filtro por Code vale para as duas séries')
ok(pr[23].prsProduzidas.length === 2 && pr[23].prsProduzidas[0].pr === 5, 'lista de PRs da hora')
if (falhas) { console.error(`check-desempenho-codes: ${falhas} falha(s)`); process.exit(1) }
console.log('check-desempenho-codes: ok')
