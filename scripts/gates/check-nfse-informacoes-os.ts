/**
 * Gate #3774 (Gean): a NFS-e emitida pela OS já abre com o número da OS, o modelo e a placa do veículo nas
 * informações complementares (editável). Prova o texto montado e que a OS passa o texto ao modal.
 *   tsx scripts/gates/check-nfse-informacoes-os.ts
 */
import { readFileSync } from 'node:fs'
import { informacoesDaOS } from '../../src/lib/fiscal/informacoesDaOS'

let falhas = 0
function ok(cond: boolean, msg: string) { if (!cond) { falhas++; console.error(`✘ ${msg}`) } else console.log(`✓ ${msg}`) }

ok(informacoesDaOS('OS-2026-0198', 'Fiat', 'Strada', 'abc1d23') === 'OS: OS-2026-0198 · Veículo: Fiat Strada · Placa: ABC1D23', 'OS + marca/modelo + placa')
ok(informacoesDaOS('OS-1', 'Fiat', 'Fiat Strada', 'ABC1234') === 'OS: OS-1 · Veículo: Fiat Strada · Placa: ABC1234', 'modelo que já traz a marca não repete')
ok(informacoesDaOS('OS-1', null, '  ', null) === 'OS: OS-1', 'só o número quando não há veículo')
ok(informacoesDaOS(null, null, null, null) === '', 'OS sem nada → vazio (campo fica como antes)')

const botao = readFileSync('src/components/comum/EmitirNFSeOSButton.tsx', 'utf8')
ok(/select\('cliente_id, numero, marca, modelo, placa'\)/.test(botao), 'a OS lê número, marca, modelo e placa')
ok(botao.includes('observacoesIniciais={obsOS || undefined}'), 'a OS passa o texto ao modal de emissão')
const modal = readFileSync('src/components/fiscal/NFSeEmitirGovModal.tsx', 'utf8')
ok(modal.includes("setObservacoes(observacoesIniciais ?? '')"), 'o modal pré-preenche as informações complementares ao abrir')

if (falhas) { console.error(`\n${falhas} falha(s)`); process.exit(1) }
console.log('\nNFS-e da OS com OS/modelo/placa: OK')
