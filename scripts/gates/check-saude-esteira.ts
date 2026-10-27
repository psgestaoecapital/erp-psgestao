// Gate — card "Saúde da Esteira" na aba Codes (Eng. Chefe 11/10): semáforo só de performance, lê fn_esteira_saude(). Sem rede.
import { readFileSync } from 'node:fs'
import { classificarSaude, type SaudeEsteira } from '../../src/lib/dev/saudeEsteira'

let falhas = 0
const ok = (c: boolean, m: string) => { if (!c) { falhas++; console.error('✗', m) } else console.log('✓', m) }
const base: SaudeEsteira = { portao_verde: true, portao_desde: '2026-10-11T10:00:00Z', portao_spec_falha: null, quedas_24h: 0, tempo_vermelho_24h_min: 0,
  merges_24h: 20, intervalo_mediano_merge_min: 20, fila_esperando: 3, fila_parada: 0, pr_parada_mais_antiga_h: null }
const agora = new Date('2026-10-11T12:00:00Z')
const k = (o: Partial<SaudeEsteira>) => classificarSaude({ ...base, ...o }, agora)

ok(k({}).cadencia === 'verde' && k({}).estabilidade === 'verde' && k({}).fila === 'verde' && k({}).portao === 'verde', 'tudo saudável → verde')
ok(k({ intervalo_mediano_merge_min: 60 }).cadencia === 'amarelo', 'cadência 60 min → amarelo')
ok(k({ intervalo_mediano_merge_min: null }).cadencia === 'vermelho', 'sem publicação → cadência vermelha')
ok(k({ quedas_24h: 1, tempo_vermelho_24h_min: 30 }).estabilidade === 'amarelo', '1 queda/30 min → amarelo')
ok(k({ quedas_24h: 4, tempo_vermelho_24h_min: 30 }).estabilidade === 'vermelho', '4 quedas → vermelho')
ok(k({ fila_parada: 2, pr_parada_mais_antiga_h: 8 }).fila === 'vermelho', 'PR parada 8 h → vermelho')
ok(k({ portao_verde: false }).portao === 'vermelho' && k({ portao_verde: null }).portao === 'vermelho', 'portão vermelho/sem dado → vermelho')
ok(k({}).portaoHa === '2 h', 'portão verde há 2 h')

const card = readFileSync('src/components/dev/SaudeEsteira.tsx', 'utf8')
ok(card.includes("rpc('fn_esteira_saude')"), 'card lê a RPC fn_esteira_saude')
ok(readFileSync('src/components/dev/PainelCodes.tsx', 'utf8').match(/<SaudeEsteira[\s/>]/) !== null, 'card montado na aba Codes')
ok(['cadencia', 'estabilidade', 'fila', 'portao'].every((b) => card.includes(`id="${b}"`)), '4 blocos (cadência, estabilidade, fila, portão), cada um com "?"')
if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
