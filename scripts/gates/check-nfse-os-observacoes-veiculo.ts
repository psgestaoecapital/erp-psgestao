// Gate · chamado #3774 (Gean) — NFS-e emitida pela OS já sai com OS, modelo e placa do veículo nas
// informações complementares (editável). Sem rede: prova a função pura e o fio OS → botão → modal.
import { readFileSync } from 'node:fs'
import { buscarVeiculoLigado, montarObservacoesNfseOS } from '../../src/lib/oficina/observacoesNfseOS'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

// 1) texto montado a partir da OS (formato real da Gean: numero "OS-2026-0280")
ok(montarObservacoesNfseOS({ numero: 'OS-2026-0280', modelo: 'Master', placa: 'una0h94' }) === 'OS-2026-0280 · Veículo: Master · Placa: UNA0H94',
  'OS + modelo + placa (placa em maiúsculas, sem prefixo OS duplicado)')
ok(montarObservacoesNfseOS({ numero: '198', modelo: 'Frontier', placa: 'MJL5040' }) === 'OS 198 · Veículo: Frontier · Placa: MJL5040',
  'número sem prefixo ganha "OS "')
ok(montarObservacoesNfseOS({ numero: 'OS-2026-0280', marca: 'Renault', modelo: 'Master', placa: 'UNA0H94' }) === 'OS-2026-0280 · Veículo: Renault Master · Placa: UNA0H94',
  'marca + modelo da OS')
// 2) OS sem modelo/placa usa o veículo ligado
ok(montarObservacoesNfseOS({ numero: 'OS-1', modelo: null, placa: ' ', veiculo: { marca: 'Renault', modelo: 'Master', placa: 'abc1d23' } }) === 'OS-1 · Veículo: Renault Master · Placa: ABC1D23',
  'cai no veículo ligado quando a OS não tem modelo/placa')
// 3) campo vazio fica de fora; nada → texto vazio
ok(montarObservacoesNfseOS({ numero: 'OS-2', modelo: '', placa: null }) === 'OS-2', 'sem modelo/placa: só a OS')
ok(montarObservacoesNfseOS(null) === '' && montarObservacoesNfseOS({}) === '', 'sem dados: vazio (modal fica como antes)')

// 4) o fio: botão lê numero/modelo/placa (+ veículo) da OS e passa ao modal; modal semeia o campo editável
const botao = readFileSync('src/components/comum/EmitirNFSeOSButton.tsx', 'utf8')
const modal = readFileSync('src/components/fiscal/NFSeEmitirGovModal.tsx', 'utf8')
ok(/select\('cliente_id, numero, marca, modelo, placa, veic_veiculo_id'\)/.test(botao), 'botão da OS lê cliente_id, numero/modelo/placa e o id do veículo')
ok(!/veiculo:veic_veiculo\(/.test(botao), 'select da OS sem embed do veículo (o tomador não depende dele)')
ok(botao.includes('buscarVeiculoLigado(osDados.veic_veiculo_id'), 'veículo ligado em consulta própria')
ok(botao.includes('setObsOS(montarObservacoesNfseOS(osDados ? { ...osDados, veiculo: await buscarVeiculoLigado(') && botao.includes('observacoesIniciais={obsOS}'), 'botão monta o texto e passa ao modal')
ok(modal.includes('observacoesIniciais?: string') && modal.includes("setObservacoes(observacoesIniciais?.trim() || '')"), 'modal: semeia as informações complementares com o texto inicial')

// 5) busca do veículo falha (erro do PostgREST ou exceção) → só fica sem o veículo; cliente_id da OS segue lido
async function casosVeiculo() {
  const os = { cliente_id: 'cli-1', numero: 'OS-9', modelo: null, placa: null, veic_veiculo_id: 'v-1' }
  const comErro = await buscarVeiculoLigado(os.veic_veiculo_id, async () => ({ data: null, error: { code: 'PGRST200' } }))
  const comExcecao = await buscarVeiculoLigado(os.veic_veiculo_id, async () => { throw new Error('rede') })
  const semId = await buscarVeiculoLigado(null, async () => { throw new Error('não deveria consultar') })
  const okVeic = await buscarVeiculoLigado('v-1', async () => ({ data: { marca: 'Renault', modelo: 'Master', placa: 'abc1d23' }, error: null }))
  ok(comErro === null && comExcecao === null && semId === null, 'falha na busca do veículo devolve null sem lançar')
  ok(os.cliente_id === 'cli-1' && montarObservacoesNfseOS({ ...os, veiculo: comErro }) === 'OS-9', 'com a busca do veículo falhando, o tomador (cliente_id) continua e o texto sai só com a OS')
  ok(montarObservacoesNfseOS({ ...os, veiculo: okVeic }) === 'OS-9 · Veículo: Renault Master · Placa: ABC1D23', 'busca ok: veículo ligado entra no texto')
  ok(botao.indexOf('setClienteId(osDados?.cliente_id') < botao.indexOf('buscarVeiculoLigado(osDados.veic_veiculo_id'), 'cliente da OS é gravado antes da busca do veículo')
}

casosVeiculo().then(() => {
  if (falhas) { console.error(`\ncheck-nfse-os-observacoes-veiculo: ${falhas} falha(s)`); process.exit(1) }
  console.log('\ncheck-nfse-os-observacoes-veiculo: ok')
})
