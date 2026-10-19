// Gate · chamado #3774 (Gean) — NFS-e emitida pela OS já sai com OS, modelo e placa do veículo nas
// informações complementares (editável). Sem rede: prova a função pura e o fio OS → botão → modal.
import { readFileSync } from 'node:fs'
import { montarObservacoesNfseOS } from '../../src/lib/oficina/observacoesNfseOS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) texto montado a partir da OS (formato real da Gean: numero "OS-2026-0280")
ok(montarObservacoesNfseOS({ numero: 'OS-2026-0280', modelo: 'Master', placa: 'una0h94' }) === 'OS-2026-0280 · Veículo: Master · Placa: UNA0H94',
  'OS + modelo + placa (placa em maiúsculas, sem prefixo OS duplicado)')
ok(montarObservacoesNfseOS({ numero: '198', modelo: 'Frontier', placa: 'MJL5040' }) === 'OS 198 · Veículo: Frontier · Placa: MJL5040',
  'número sem prefixo ganha "OS "')
// 2) OS sem modelo/placa usa o veículo ligado
ok(montarObservacoesNfseOS({ numero: 'OS-1', modelo: null, placa: ' ', veiculo: { marca: 'Renault', modelo: 'Master', placa: 'abc1d23' } }) === 'OS-1 · Veículo: Renault Master · Placa: ABC1D23',
  'cai no veículo ligado quando a OS não tem modelo/placa')
// 3) campo vazio fica de fora; nada → texto vazio
ok(montarObservacoesNfseOS({ numero: 'OS-2', modelo: '', placa: null }) === 'OS-2', 'sem modelo/placa: só a OS')
ok(montarObservacoesNfseOS(null) === '' && montarObservacoesNfseOS({}) === '', 'sem dados: vazio (modal fica como antes)')

// 4) o fio: botão lê numero/modelo/placa (+ veículo) da OS e passa ao modal; modal semeia o campo editável
const botao = readFileSync('src/components/comum/EmitirNFSeOSButton.tsx', 'utf8')
const modal = readFileSync('src/components/fiscal/NFSeEmitirGovModal.tsx', 'utf8')
ok(/select\('cliente_id, numero, modelo, placa, veiculo:veic_veiculo\(marca, modelo, placa\)'\)/.test(botao), 'botão da OS lê numero/modelo/placa e o veículo ligado')
ok(botao.includes('setObsOS(montarObservacoesNfseOS(osDados))') && botao.includes('observacoesIniciais={obsOS}'), 'botão monta o texto e passa ao modal')
ok(modal.includes('observacoesIniciais?: string') && modal.includes("setObservacoes(observacoesIniciais?.trim() || '')"), 'modal: semeia as informações complementares com o texto inicial')

if (falhas) { console.error(`\ncheck-nfse-os-observacoes-veiculo: ${falhas} falha(s)`); process.exit(1) }
console.log('\ncheck-nfse-os-observacoes-veiculo: ok')
