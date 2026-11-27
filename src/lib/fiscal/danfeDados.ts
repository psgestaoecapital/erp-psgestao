// Chamado #11234 — monta os DADOS do DANFE (src/lib/fiscal/danfePdf.ts) a partir do que o emissor já tem:
//  · a nota MONTADA (NFeRequest) — espelho de conferência, sem chave nem protocolo;
//  · a nota JÁ EMITIDA (erp_nfe_emitidas) — DANFE da nota autorizada, com chave e protocolo.
// Só reorganiza dados para o leiaute: não calcula imposto nem mexe no XML. Os totais que a nota traz (frete, seguro, desconto,
// outras despesas) vão como estão; ICMS/IPI/PIS/COFINS totais são a SOMA do que cada item já traz. Puro (sem rede/banco).

import type { NFeRequest, NFeProdutoItem, EnderecoFiscal } from './types'
import type { DanfeDados, DanfeItem } from './danfePdf'
import { isoBrasilia } from './dataBrasil'

type Emitente = DanfeDados['emitente']

const soma = (itens: NFeProdutoItem[], f: (i: NFeProdutoItem) => number | undefined | null) => itens.reduce((a, i) => a + (Number(f(i)) || 0), 0)
const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/** Itens da nota (NFeProdutoItem — o mesmo formato do emissor e do que fica gravado em erp_nfe_emitidas.itens). */
export function itensDanfe(itens: NFeProdutoItem[]): DanfeItem[] {
  return (itens ?? []).map((it) => ({
    codigo: it.codigo ?? null,
    descricao: it.descricao,
    ncm: it.ncm ?? null,
    origem: it.origem ?? null,
    cst: it.icms?.cst ?? null,
    cfop: it.cfop ?? null,
    un: it.unidade ?? null,
    quantidade: num(it.quantidade),
    valorUnitario: num(it.valorUnitario),
    valorTotal: Number(it.valorTotal) || 0,
    baseIcms: num(it.icms?.base),
    valorIcms: num(it.icms?.valor),
    valorIpi: num(it.ipi?.valor),
    aliqIcms: num(it.icms?.aliquota),
    aliqIpi: num(it.ipi?.aliquota),
    chassi: it.veiculo?.chassi ?? null,
  }))
}

function linhaEndereco(e?: Partial<EnderecoFiscal> | null): string {
  if (!e) return ''
  return [e.logradouro, e.numero, e.complemento].filter(Boolean).join(', ')
}

/** Totais a partir dos itens (soma do que cada item traz) + os totais declarados na nota. */
function totaisDosItens(itens: NFeProdutoItem[], t?: NFeRequest['totais']) {
  return {
    baseIcms: soma(itens, (i) => i.icms?.base),
    valorIcms: soma(itens, (i) => i.icms?.valor),
    valorPis: soma(itens, (i) => i.pis?.valor),
    valorCofins: soma(itens, (i) => i.cofins?.valor),
    valorIpi: soma(itens, (i) => i.ipi?.valor),
    valorProdutos: soma(itens, (i) => i.valorTotal),
    frete: t?.frete ?? 0, seguro: t?.seguro ?? 0, desconto: t?.desconto ?? 0, outrasDespesas: t?.outrasDespesas ?? 0,
  }
}

/** ESPELHO: a nota montada pelo emissor (apenasPrevia). Sem chave nem protocolo → o PDF sai com a marca de conferência. */
export function danfeDeNFeRequest(req: NFeRequest, emitente: Partial<Emitente> | null, agora: Date = new Date()): DanfeDados {
  const d = req.destinatario
  const e = d.endereco
  const t = totaisDosItens(req.itens, req.totais)
  const iso = isoBrasilia(agora).slice(0, 16)
  return {
    emitente: {
      razaoSocial: emitente?.razaoSocial || req.emitente.razaoSocial,
      cnpj: emitente?.cnpj || req.emitente.cnpj || null,
      ie: emitente?.ie || req.emitente.inscricaoEstadual || null,
      ieSt: emitente?.ieSt ?? null,
      endereco: emitente?.endereco ?? null, bairro: emitente?.bairro ?? null, cep: emitente?.cep ?? null,
      municipio: emitente?.municipio ?? null, uf: emitente?.uf ?? null, fone: emitente?.fone ?? null, logo: emitente?.logo ?? null,
    },
    numero: null,
    serie: req.serie,
    tipoOperacao: 1,
    naturezaOperacao: req.naturezaOperacao,
    dataEmissaoISO: iso,
    dataSaidaISO: iso,
    horaSaida: iso.slice(11, 16),
    destinatario: {
      nome: d.razaoSocial,
      documento: d.cnpj || d.cpf || null,
      ie: d.inscricaoEstadual ?? null,
      endereco: linhaEndereco(e), bairro: e?.bairro ?? null, cep: e?.cep ?? null, municipio: e?.cidade ?? null, uf: e?.uf ?? null,
    },
    totais: { ...t, valorNota: t.valorProdutos + t.frete + t.seguro + t.outrasDespesas - t.desconto + t.valorIpi },
    // #5722 · transportador/veículo/volumes no DANFE quando a nota os traz (sem isso, só a modalidade, como antes).
    transporte: (() => {
      const tp = req.transporte
      const tr = tp?.transportador; const v = tp?.veiculo; const vol = tp?.volumes?.[0]
      return {
        modalidade: req.totais?.modalidadeFrete ?? 9,
        ...(tr ? { nome: tr.nome ?? null, documento: tr.cnpj ?? tr.cpf ?? null, ie: tr.inscricaoEstadual ?? null,
          endereco: tr.endereco ?? null, municipio: tr.municipio ?? null, uf: tr.uf ?? null } : {}),
        ...(v ? { placa: v.placa ?? null, ufPlaca: v.uf ?? null } : {}),
        ...(vol ? { quantidade: vol.quantidade != null ? String(vol.quantidade) : null, especie: vol.especie ?? null,
          marca: vol.marca ?? null, numeracao: vol.numero ?? null,
          pesoBruto: vol.pesoBruto != null ? String(vol.pesoBruto) : null, pesoLiquido: vol.pesoLiquido != null ? String(vol.pesoLiquido) : null } : {}),
      }
    })(),
    itens: itensDanfe(req.itens),
    informacoesComplementares: req.observacoes ?? '',
    simples: !!req.emitente.simplesNacional,
  }
}

/** Linha de erp_nfe_emitidas (colunas usadas pelo DANFE da nota autorizada). */
export type NotaEmitidaRow = {
  numero: string | null; serie: string | null; chave: string | null; protocolo: string | null
  data_emissao: string | null; natureza_operacao: string | null; status: string | null
  valor_total: number | null; valor_produtos: number | null; valor_frete: number | null; valor_desconto: number | null
  valor_icms: number | null; valor_ipi: number | null; valor_pis: number | null; valor_cofins: number | null
  emitente_cnpj: string | null; emitente_razao_social: string | null; emitente_inscricao_estadual: string | null
  destinatario_cnpj: string | null; destinatario_cpf: string | null; destinatario_razao_social: string | null
  destinatario_endereco: Partial<EnderecoFiscal> | null
  itens: NFeProdutoItem[] | null
  payload_enviado: Record<string, unknown> | null
}

/** DANFE da nota AUTORIZADA: o que ficou gravado na emissão (itens, valores, chave, protocolo). */
export function danfeDeNotaEmitida(n: NotaEmitidaRow, emitente: Partial<Emitente> | null, opt: { simples?: boolean } = {}): DanfeDados {
  const itens = Array.isArray(n.itens) ? n.itens : []
  const e = n.destinatario_endereco
  const t = totaisDosItens(itens)
  const p = n.payload_enviado ?? {}
  const info = typeof p.informacoes_adicionais_contribuinte === 'string' ? p.informacoes_adicionais_contribuinte : ''
  const modFrete = num(p.modalidade_frete)
  const emissao = n.data_emissao ? isoBrasilia(new Date(n.data_emissao)).slice(0, 16) : null
  const valorProdutos = n.valor_produtos ?? t.valorProdutos
  return {
    emitente: {
      razaoSocial: emitente?.razaoSocial || n.emitente_razao_social || '',
      cnpj: emitente?.cnpj || n.emitente_cnpj, ie: emitente?.ie || n.emitente_inscricao_estadual, ieSt: emitente?.ieSt ?? null,
      endereco: emitente?.endereco ?? null, bairro: emitente?.bairro ?? null, cep: emitente?.cep ?? null,
      municipio: emitente?.municipio ?? null, uf: emitente?.uf ?? null, fone: emitente?.fone ?? null, logo: emitente?.logo ?? null,
    },
    numero: n.numero, serie: n.serie, tipoOperacao: 1,
    chave: n.chave, protocolo: n.protocolo,
    protocoloDataISO: null,
    naturezaOperacao: n.natureza_operacao ?? '',
    dataEmissaoISO: emissao, dataSaidaISO: emissao, horaSaida: emissao ? emissao.slice(11, 16) : null,
    destinatario: {
      nome: n.destinatario_razao_social ?? '',
      documento: n.destinatario_cnpj || n.destinatario_cpf || null,
      endereco: linhaEndereco(e), bairro: e?.bairro ?? null, cep: e?.cep ?? null, municipio: e?.cidade ?? null, uf: e?.uf ?? null,
    },
    // totais gravados na emissão têm prioridade; o que não foi gravado é a soma dos itens
    totais: {
      baseIcms: t.baseIcms, valorIcms: n.valor_icms ?? t.valorIcms, valorPis: n.valor_pis ?? t.valorPis, valorCofins: n.valor_cofins ?? t.valorCofins,
      valorIpi: n.valor_ipi ?? t.valorIpi, valorProdutos, frete: n.valor_frete ?? 0, desconto: n.valor_desconto ?? 0,
      valorNota: n.valor_total ?? undefined,
    },
    // #5722 · transportador/veículo/volumes lidos do que foi enviado (payload_enviado), nomes oficiais da Focus.
    transporte: (() => {
      const str = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim() : (typeof x === 'number' ? String(x) : null))
      const vols = Array.isArray((p as Record<string, unknown>).volumes) ? ((p as Record<string, unknown>).volumes as Array<Record<string, unknown>>) : []
      const vol = vols[0]
      return {
        modalidade: modFrete ?? 9,
        nome: str(p.nome_transportador),
        documento: str(p.cnpj_transportador) ?? str(p.cpf_transportador),
        ie: str(p.inscricao_estadual_transportador),
        endereco: str(p.endereco_transportador),
        municipio: str(p.municipio_transportador),
        uf: str(p.uf_transportador),
        placa: str(p.veiculo_placa),
        ufPlaca: str(p.veiculo_uf),
        ...(vol ? { quantidade: str(vol.quantidade), especie: str(vol.especie), marca: str(vol.marca),
          numeracao: str(vol.numero), pesoBruto: str(vol.peso_bruto), pesoLiquido: str(vol.peso_liquido) } : {}),
      }
    })(),
    itens: itensDanfe(itens),
    informacoesComplementares: info,
    simples: opt.simples,
  }
}
