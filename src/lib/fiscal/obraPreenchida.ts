// #3862 (complemento) · obra que já existe no pedido não é pedida de novo. O orçamento congela o endereço da obra
// (erp_orcamentos.obra_*) e aponta a obra cadastrada (obra_id). A NFS-e de obra (07.05) abre com esses dados:
// só o que FALTA aparece para preencher. Puro (sem React/Supabase): testado em
// scripts/gates/check-obra-preenchida-3862.ts.
// Regra da prefeitura (mesma do backend, obra_endereco_incompleto): endereço completo + município IBGE.
// CNO é OPCIONAL (a nota segue pelo endereço): nunca entra na lista de faltantes.

export type OrcamentoObra = {
  obra_id: string | null
  obra_cno: string | null
  obra_logradouro: string | null
  obra_numero: string | null
  obra_complemento: string | null
  obra_bairro: string | null
  obra_cidade: string | null
  obra_uf: string | null
  obra_cep: string | null
  obra_codigo_ibge: string | null
}

// Campos de projetos_obras lidos para pré-preencher (mesma lista do BlocoObraFiscal).
export const OBRA_PREENCHIDA_SELECT = 'id,numero,nome,cliente_nome,endereco,numero_endereco,bairro,cidade,uf,cep,cno,codigo_ibge_municipio'

export type ObraSalva = {
  id: string; numero: string; nome: string | null; cliente_nome: string | null
  endereco: string | null; numero_endereco: string | null; bairro: string | null
  cidade: string | null; uf: string | null; cep: string | null; cno: string | null
  codigo_ibge_municipio: string | null
}

// Modo do bloco: 'apontar' (obra cadastrada escolhida) ou 'informar' (endereço digitado).
// Devolve null quando o pedido ainda não tem obra nenhuma (o bloco segue como antes).
export function obraPreenchidaDoOrcamento(o: OrcamentoObra, obraSalva: ObraSalva | null) {
  const temEndereco = [o.obra_logradouro, o.obra_numero, o.obra_bairro, o.obra_cep, o.obra_codigo_ibge]
    .some((c) => (c ?? '').trim() !== '')
  if (obraSalva && camposFaltandoObraSalva(obraSalva).length === 0) {
    return { modo: 'apontar' as const, obraSel: obraSalva, obraEnd: null, obraCno: obraSalva.cno ?? '' }
  }
  if (temEndereco) {
    return {
      modo: 'informar' as const, obraSel: null,
      obraEnd: {
        cep: o.obra_cep ?? '', logradouro: o.obra_logradouro ?? '', numero: o.obra_numero ?? '',
        complemento: o.obra_complemento ?? '', bairro: o.obra_bairro ?? '', cidade: o.obra_cidade ?? '',
        uf: o.obra_uf ?? '', codigo_ibge_municipio: o.obra_codigo_ibge ?? '',
      },
      obraCno: o.obra_cno ?? '',
    }
  }
  if (obraSalva) {
    // obra cadastrada mas incompleta: aparece escolhida, com o aviso de endereço incompleto do bloco
    return { modo: 'apontar' as const, obraSel: obraSalva, obraEnd: null, obraCno: obraSalva.cno ?? '' }
  }
  return null
}

const ROTULO = { logradouro: 'rua', numero: 'número', bairro: 'bairro', cep: 'CEP', codigo_ibge: 'município (IBGE)' } as const

function camposFaltandoObraSalva(o: ObraSalva): (keyof typeof ROTULO)[] {
  const f: (keyof typeof ROTULO)[] = []
  if (!(o.endereco ?? '').trim()) f.push('logradouro')
  if (!(o.numero_endereco ?? '').trim()) f.push('numero')
  if (!(o.bairro ?? '').trim()) f.push('bairro')
  if (!(o.cep ?? '').trim()) f.push('cep')
  if (!(o.codigo_ibge_municipio ?? '').trim()) f.push('codigo_ibge')
  return f
}

// Lista, em português, o que ainda falta para a obra ser faturada. Vazia = pode emitir sem perguntar de novo.
export function camposObraFaltando(st: {
  modo: 'apontar' | 'informar'
  obraSel: ObraSalva | null
  obraEnd: { logradouro: string; numero: string; bairro: string; cep: string; codigo_ibge_municipio: string }
}): string[] {
  if (st.modo === 'apontar') {
    if (!st.obraSel) return ['obra']
    return camposFaltandoObraSalva(st.obraSel).map((c) => ROTULO[c])
  }
  const e = st.obraEnd
  const f: string[] = []
  if (!e.logradouro.trim()) f.push(ROTULO.logradouro)
  if (!e.numero.trim()) f.push(ROTULO.numero)
  if (!e.bairro.trim()) f.push(ROTULO.bairro)
  if (!e.cep.trim()) f.push(ROTULO.cep)
  if (!e.codigo_ibge_municipio.trim()) f.push(ROTULO.codigo_ibge)
  return f
}
