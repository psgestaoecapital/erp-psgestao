/**
 * Gate de build · #2861 (Gean): Diagnóstico técnico e Aprovação do cliente têm a busca da tela de Ordens de Serviço
 * (placa, número, cliente, veículo), com o "?" (RD-95) e a regra única de src/lib/oficina/buscaOS.ts.
 */
import { readFileSync } from 'node:fs'
import { filtrarOS } from '../../src/lib/oficina/buscaOS'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

const lista = [
  { id: 1, numero: 'OS-2026-0198', cliente_nome: 'FC Pisos', placa: 'ABC-1D23', marca: 'Fiat', modelo: 'Strada' },
  { id: 2, numero: 'OS-2026-0201', cliente_nome: 'João da Silva', placa: 'XYZ9A87', marca: 'Toyota', modelo: 'Hilux' },
  { id: 3, numero: 'OS-2026-0202', cliente_nome: null, placa: null, marca: null, modelo: null },
]
const ids = (b: string) => filtrarOS(lista, b).map((o) => o.id).join(',')
ok(ids('') === '1,2,3' && ids('   ') === '1,2,3', 'busca vazia mostra todas')
ok(ids('0198') === '1', 'acha pelo número da OS')
ok(ids('joão') === '2', 'acha pelo cliente sem diferenciar maiúscula')
ok(ids('abc1d23') === '1' && ids('ABC 1D') === '1', 'acha pela placa ignorando traço/espaço')
ok(ids('fiat strada') === '1' && ids('hilux') === '2', 'acha por marca/modelo')
ok(ids('zzz') === '', 'sem resultado devolve lista vazia')

for (const [arq, chave] of [
  ['src/app/dashboard/oficina/diagnostico/page.tsx', 'oficina.diagnostico.busca'],
  ['src/app/dashboard/oficina/aprovacao/page.tsx', 'oficina.aprovacao.busca'],
] as const) {
  const s = readFileSync(arq, 'utf8')
  ok(s.includes('filtrarOS(lista, buscaOS).map('), `${arq} lista as OS pela busca`)
  ok(s.includes(`<AjudaCampo chave="${chave}"`), `${arq} tem o "?" da busca (${chave})`)
}
const mig = readFileSync('supabase/migrations/20261016220020_oficina_busca_os_ajuda.sql', 'utf8')
ok(mig.includes("'oficina.diagnostico.busca'") && mig.includes("'oficina.aprovacao.busca'"), 'migration cria as duas chaves de ajuda')

if (falhas > 0) { console.error(`\n[check-oficina-busca-os] ${falhas} regra(s) quebrada(s) — build bloqueado.`); process.exit(1) }
console.log('\n[check-oficina-busca-os] busca da Oficina conferida.')
