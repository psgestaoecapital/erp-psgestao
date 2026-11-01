// Chamado #3774 (Gean) · NFS-e emitida pela OS: as informações complementares da nota já saem com o número
// da OS, o modelo e a placa do veículo — os dados estão na OS, a pessoa não precisa redigitar.
// Fonte: erp_os.numero/marca/modelo/placa; se a OS não tem modelo/placa, cai no veículo ligado (veic_veiculo).
// Campo vazio fica de fora (nunca "Placa: —"). O texto continua editável no modal.

export type DadosOSNfse = {
  numero?: string | null
  marca?: string | null
  modelo?: string | null
  placa?: string | null
  veiculo?: { marca?: string | null; modelo?: string | null; placa?: string | null } | null
}

const limpo = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export function montarObservacoesNfseOS(os: DadosOSNfse | null | undefined): string {
  if (!os) return ''
  const numero = limpo(os.numero)
  const veicModelo = [limpo(os.veiculo?.marca), limpo(os.veiculo?.modelo)].filter(Boolean).join(' ')
  const osModelo = [limpo(os.marca), limpo(os.modelo)].filter(Boolean).join(' ')
  const modelo = limpo(os.modelo) ? osModelo : veicModelo
  const placa = (limpo(os.placa) || limpo(os.veiculo?.placa)).toUpperCase()
  const partes = [
    numero ? (/^OS\b/i.test(numero) ? numero : `OS ${numero}`) : '',
    modelo ? `Veículo: ${modelo}` : '',
    placa ? `Placa: ${placa}` : '',
  ].filter(Boolean)
  return partes.join(' · ')
}

type VeiculoNfse = DadosOSNfse['veiculo']

// Veículo ligado à OS em consulta PRÓPRIA (fora do select da OS, que traz o tomador): qualquer erro ou exceção
// só deixa o texto sem o veículo — nunca derruba a leitura do cliente da OS.
export async function buscarVeiculoLigado(
  veiculoId: string | null | undefined,
  consultar: (id: string) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<VeiculoNfse> {
  if (!veiculoId) return null
  try {
    const { data, error } = await consultar(veiculoId)
    return error ? null : ((data as VeiculoNfse) ?? null)
  } catch {
    return null
  }
}
