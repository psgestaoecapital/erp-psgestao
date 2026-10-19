// #3774 (Gean) · informações complementares da NFS-e emitida pela OS: número da OS + veículo (marca/modelo) + placa.
// "OS: OS-2026-0198 · Veículo: Fiat Strada · Placa: ABC1D23" — só as partes preenchidas; vazio quando a OS não tem nada.
// Sem dependências: a tela da OS monta o texto e o modal de emissão o pré-preenche (editável).

export function informacoesDaOS(numero?: string | null, marca?: string | null, modelo?: string | null, placa?: string | null): string {
  const t = (x?: string | null) => (x ?? '').trim()
  // modelo às vezes já vem com a marca ("Fiat Strada"): não repetir
  const veiculo = t(marca) && !t(modelo).toLowerCase().startsWith(t(marca).toLowerCase())
    ? [t(marca), t(modelo)].filter(Boolean).join(' ')
    : t(modelo) || t(marca)
  const partes = [t(numero) && `OS: ${t(numero)}`, veiculo && `Veículo: ${veiculo}`, t(placa) && `Placa: ${t(placa).toUpperCase()}`]
  return partes.filter(Boolean).join(' · ')
}
