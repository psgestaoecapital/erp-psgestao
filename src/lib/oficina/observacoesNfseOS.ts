// Chamado #3774 (Gean) · NFS-e emitida pela OS: as informações complementares da nota já saem com o número
// da OS, o modelo e a placa do veículo — os dados estão na OS, a pessoa não precisa redigitar.
// Fonte: erp_os.numero/modelo/placa; se a OS não tem modelo/placa, cai no veículo ligado (veic_veiculo).
// Campo vazio fica de fora (nunca "Placa: —"). O texto continua editável no modal.

export type DadosOSNfse = {
  numero?: string | null
  modelo?: string | null
  placa?: string | null
  veiculo?: { marca?: string | null; modelo?: string | null; placa?: string | null } | null
}

const limpo = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export function montarObservacoesNfseOS(os: DadosOSNfse | null | undefined): string {
  if (!os) return ''
  const numero = limpo(os.numero)
  const veicModelo = [limpo(os.veiculo?.marca), limpo(os.veiculo?.modelo)].filter(Boolean).join(' ')
  const modelo = limpo(os.modelo) || veicModelo
  const placa = (limpo(os.placa) || limpo(os.veiculo?.placa)).toUpperCase()
  const partes = [
    numero ? (/^OS\b/i.test(numero) ? numero : `OS ${numero}`) : '',
    modelo ? `Veículo: ${modelo}` : '',
    placa ? `Placa: ${placa}` : '',
  ].filter(Boolean)
  return partes.join(' · ')
}
