// #3862 · texto dos bloqueios da porta única (fn_nfse_validar_emissao) na tela "Emitir NFS-e".
// A obra de construção civil é atendida pelo CNO OU pelo endereço completo — a mensagem não pode sugerir que
// só serve obra cadastrada. A alíquota de ISS faltando leva à tela que cadastra (o "onde" do banco era um
// caminho cru, sem link). Puro, sem React: testado em scripts/gates/check-nfse-obra-endereco-3862.ts.

export const ROTA_ISS_MUNICIPIOS = '/dashboard/configuracoes/fiscal/iss-municipios'

export type BloqueioNfse = { codigo: string; mensagem: string; acao?: string; onde?: string }
export type BloqueioNfseTexto = { mensagem: string; acao: string | null; link: { href: string; rotulo: string } | null }

export function textoBloqueioNfse(b: BloqueioNfse): BloqueioNfseTexto {
  if (b.codigo === 'obra_obrigatoria') {
    return { mensagem: b.mensagem, acao: 'Informe o CNO ou o endereço da obra no quadro "Serviço de construção civil".', link: null }
  }
  if (b.codigo === 'aliquota_iss_desconhecida') {
    return { mensagem: b.mensagem, acao: b.acao ?? 'Cadastre a alíquota ou consulte o contador.', link: { href: ROTA_ISS_MUNICIPIOS, rotulo: 'ISS por município' } }
  }
  const acao = b.acao ? `${b.acao}${b.onde ? ` (${b.onde})` : ''}` : null
  return { mensagem: b.mensagem, acao, link: null }
}

// Quadro da obra: quando o serviço exige obra e a pessoa ainda não escolheu nada, abre já em "Informar o
// endereço agora" — o endereço basta (sem CNO e sem cadastrar obra antes). Escolha feita não é desfeita.
export function modoObraInicial(
  atual: { modo: 'apontar' | 'informar'; obraSel: unknown | null; tocado: boolean },
  exigeObra: boolean,
): 'apontar' | 'informar' {
  if (!exigeObra || atual.tocado || atual.obraSel) return atual.modo
  return 'informar'
}
