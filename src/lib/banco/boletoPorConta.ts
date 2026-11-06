// Chamado #5404 (FC Pisos) · o boleto sai pelo banco da CONTA BANCÁRIA do título, não pelo "primeiro banco ativo".
// Função pura (sem rede) para a regra ser provada em gate; o carregamento dos dados fica em providersBoleto.carregarRoteamentoBoleto.

export type ConfigBoletoBanco = { provider: string; banco_codigo: string | null; banco_conta_id: string | null }
export type ContaBoleto = { id: string; nome: string | null; banco_codigo: string | null }
export type RoteamentoBoleto = { configs: ConfigBoletoBanco[]; contas: Record<string, ContaBoleto> }
export type ResolucaoBoleto = { ok: true; provider: string } | { ok: false; motivo: string }

const nomeConta = (c?: ContaBoleto) => (c?.nome ?? '').trim() || 'selecionada'
const semBoleto = (c?: ContaBoleto): ResolucaoBoleto => ({ ok: false, motivo: `A conta ${nomeConta(c)} não tem boleto ativado.` })

// 1) configuração ligada à conta (banco_conta_id); 2) configuração do mesmo banco (banco_codigo);
// 3) conta sem vínculo nem código: só se a empresa tem UM único banco de boleto (empresa de um banco só);
//    com vários, não adivinha — nunca cai em outro banco.
export function resolverProviderDaConta(r: RoteamentoBoleto, contaId: string | null | undefined): ResolucaoBoleto | null {
  if (!contaId) return null // título sem conta: a tela segue a escolha manual de sempre
  const conta = r.contas[contaId]
  const ligada = r.configs.find((c) => c.banco_conta_id === contaId)
  if (ligada) return { ok: true, provider: ligada.provider.toLowerCase() }
  const cod = (conta?.banco_codigo ?? '').trim()
  if (cod) {
    const doBanco = r.configs.find((c) => !c.banco_conta_id && (c.banco_codigo ?? '').trim() === cod)
    return doBanco ? { ok: true, provider: doBanco.provider.toLowerCase() } : semBoleto(conta)
  }
  if (r.configs.length === 1 && !r.configs[0].banco_conta_id) return { ok: true, provider: r.configs[0].provider.toLowerCase() }
  return semBoleto(conta)
}
