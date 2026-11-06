// #3861 (piloto FCR) · NF-e avulsa com CFOP escolhido — regras puras, usadas pela tela e pela rota
// /api/fiscal/nfe/remessa (a mesma rota da remessa, que passou a ser a "NF-e avulsa").
//  - escopo do CFOP pela UF: 5.xxx dentro do estado, 6.xxx outra UF (troca automática COM aviso), 7.xxx exterior;
//  - finalidade ≠ normal → chave da NF-e referenciada (44 dígitos) obrigatória; CFOP de retorno/devolução → aviso;
//  - ICMS da operação: Simples usa CSOSN, regime normal usa CST. Vazio = tributação do cadastro do produto (venda);
//    no Simples, CFOP x.9xx (remessa/outra saída) exige a escolha explícita (o cadastro traz o CSOSN de venda).
// Gate: scripts/gates/check-nfe-avulsa-cfop.ts.

export const UFS_BR = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
])

export type FinalidadeNFe = 'normal' | 'complementar' | 'ajuste' | 'devolucao'

// Linha do catálogo erp_fiscal_cfop_saida (5.xxx e 7.xxx; o 6.xxx é o espelho do 5.xxx, salvo os só-interestaduais).
export interface CfopSaida {
  cfop: string
  descricao: string
  natureza_sugerida: string
  exige_referenciada: boolean
}

// Códigos de ICMS que a NF-e avulsa aceita como escolha da operação (vazio = do cadastro do produto).
export const ICMS_OPCOES_SIMPLES: Array<{ codigo: string; rotulo: string }> = [
  { codigo: '400', rotulo: '400 · Não tributada pelo Simples' },
  { codigo: '900', rotulo: '900 · Outros' },
]
export const ICMS_OPCOES_NORMAL: Array<{ codigo: string; rotulo: string }> = [
  { codigo: '41', rotulo: '41 · Não tributada' },
  { codigo: '50', rotulo: '50 · Suspensão' },
  { codigo: '90', rotulo: '90 · Outras' },
]

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function formatarCfop(cfop: string): string {
  const c = soDigitos(cfop)
  return c.length === 4 ? `${c[0]}.${c.slice(1)}` : c
}

// UF do destinatário: sigla nacional, 'EX' (exterior) ou indefinida.
export function ufDestino(uf: unknown): string | undefined {
  const u = String(uf ?? '').trim().toUpperCase()
  if (u === 'EX') return 'EX'
  return UFS_BR.has(u) ? u : undefined
}

// Procura o CFOP no catálogo: exato, ou o 6.xxx pelo espelho 5.xxx.
export function cfopNoCatalogo(cfop: string, catalogo: CfopSaida[]): CfopSaida | undefined {
  const c = soDigitos(cfop)
  return catalogo.find((x) => x.cfop === c) ?? (c[0] === '6' ? catalogo.find((x) => x.cfop === '5' + c.slice(1)) : undefined)
}

export interface EscopoCfop {
  cfop: string
  aviso?: string
  erro?: string
}

// Ajusta o 1º dígito do CFOP de saída pela UF do emitente × destinatário.
export function escopoCfop(cfopBruto: string, ufEmitente: string | undefined, ufDest: string | undefined): EscopoCfop {
  const cfop = soDigitos(cfopBruto)
  if (cfop.length !== 4 || !'567'.includes(cfop[0])) {
    return { cfop, erro: `CFOP ${cfopBruto || '(vazio)'} inválido: NF-e de saída usa 4 dígitos começando por 5, 6 ou 7.` }
  }
  if (ufDest === 'EX') {
    if (cfop[0] !== '7') return { cfop, erro: `Destinatário no exterior exige CFOP 7.xxx (escolhido ${formatarCfop(cfop)}).` }
    return { cfop }
  }
  if (cfop[0] === '7') return { cfop, erro: `CFOP ${formatarCfop(cfop)} é de exportação; o destinatário está no Brasil.` }
  if (!ufEmitente || !ufDest) {
    return { cfop, erro: 'UF do destinatário não cadastrada: complete o endereço do cadastro antes de emitir.' }
  }
  const alvo = ufEmitente === ufDest ? '5' : '6'
  if (cfop[0] === alvo) return { cfop }
  const novo = alvo + cfop.slice(1)
  return {
    cfop: novo,
    aviso: alvo === '6'
      ? `Destinatário em ${ufDest} (outra UF): CFOP trocado de ${formatarCfop(cfop)} para ${formatarCfop(novo)}.`
      : `Destinatário em ${ufDest} (mesma UF da empresa): CFOP trocado de ${formatarCfop(cfop)} para ${formatarCfop(novo)}.`,
  }
}

export interface EntradaAvulsa {
  cfop: string
  itensCfop?: Array<string | undefined>
  ufEmitente?: string
  ufDestino?: string
  finalidade: FinalidadeNFe
  chaveReferenciada?: string
  icmsCodigo?: string
  simples: boolean
  catalogo: CfopSaida[]
  // #3861 · cadastro do destinatário (cliente OU fornecedor): documento, IE e "Contribuinte ICMS"
  destinatario?: CadastroIE
}

export interface ResultadoAvulsa {
  cfop: string
  itensCfop: string[]
  erros: string[]
  avisos: string[]
  ie?: IEDestinatario
}

export interface CadastroIE {
  doc?: string | null
  ie?: string | null
  contribuinteIcms?: string | null
}

export interface IEDestinatario {
  inscricaoEstadual?: string
  indicadorIE: 1 | 2 | 9
  erro?: string
  aviso?: string
}

// #3861 (Gean → HUTSONTURBO): a remessa não lia a IE do cadastro e a SEFAZ recusou "IE do destinatário não
// informada". Regra única da tela e da rota: declarado no cadastro vale (contribuinte 1 / isento 2 / não contribuinte 9);
// sem declaração, ter IE = contribuinte (1), não ter = não contribuinte (9). Contribuinte declarado sem IE barra antes
// de enviar (a SEFAZ recusaria). Só o indicador 1 manda o número da IE (o provider não manda IE com 2/9).
export function ieDestinatario(c: CadastroIE): IEDestinatario {
  const ie = soDigitos(c.ie)
  const ehCnpj = soDigitos(c.doc).length === 14
  const declarado = ({ contribuinte: 1, isento: 2, nao_contribuinte: 9 } as Record<string, 1 | 2 | 9>)[
    String(c.contribuinteIcms ?? '').trim().toLowerCase()
  ]
  if (declarado === 1 && !ie) {
    return {
      indicadorIE: 1,
      erro: 'Destinatário marcado como contribuinte de ICMS sem Inscrição Estadual: informe a IE no cadastro '
        + '(ou declare isento/não contribuinte). Sem ela a SEFAZ recusa a nota.',
    }
  }
  if (declarado === 2 || declarado === 9) {
    return {
      indicadorIE: declarado,
      ...(ie ? { aviso: `Cadastro com IE ${ie}, mas declarado ${declarado === 2 ? 'isento' : 'não contribuinte'}: a IE não vai na nota. Confira o campo "Contribuinte ICMS".` } : {}),
    }
  }
  if (ie) return { inscricaoEstadual: ie, indicadorIE: 1 }
  return {
    indicadorIE: 9,
    ...(ehCnpj ? { aviso: 'Empresa (CNPJ) sem Inscrição Estadual no cadastro: a nota vai como não contribuinte. Se ela é contribuinte de ICMS, informe a IE antes de emitir.' } : {}),
  }
}

export function validarNFeAvulsa(e: EntradaAvulsa): ResultadoAvulsa {
  const erros: string[] = []
  const avisos: string[] = []

  const nota = escopoCfop(e.cfop, e.ufEmitente, e.ufDestino)
  if (nota.erro) erros.push(nota.erro)
  if (nota.aviso) avisos.push(nota.aviso)

  const itensCfop = (e.itensCfop ?? []).map((ci, i) => {
    if (!ci || soDigitos(ci) === soDigitos(e.cfop)) return nota.cfop
    const r = escopoCfop(ci, e.ufEmitente, e.ufDestino)
    if (r.erro) erros.push(`Item ${i + 1}: ${r.erro}`)
    if (r.aviso) avisos.push(`Item ${i + 1}: ${r.aviso}`)
    return r.cfop
  })

  const todos = [nota.cfop, ...itensCfop]
  const exige = todos.some((c) => cfopNoCatalogo(c, e.catalogo)?.exige_referenciada)
  const chave = soDigitos(e.chaveReferenciada)
  if (e.finalidade !== 'normal' && chave.length !== 44) {
    erros.push('Nota complementar, de ajuste ou de devolução exige a chave da NF-e referenciada (44 dígitos).')
  } else if (exige && !chave) {
    // retorno/devolução com finalidade normal: a SEFAZ não recusa sem a referência, mas o fisco cobra o vínculo
    avisos.push('Este CFOP é de retorno/devolução: informe a chave da NF-e de origem para vincular as notas.')
  } else if (chave && chave.length !== 44) {
    erros.push('Chave da NF-e referenciada deve ter 44 dígitos.')
  }

  for (const c of new Set(todos)) {
    if (c.length === 4 && !cfopNoCatalogo(c, e.catalogo)) {
      avisos.push(`CFOP ${formatarCfop(c)} fora do catálogo do ERP: confira com a contabilidade antes de emitir.`)
    }
  }

  const icms = soDigitos(e.icmsCodigo)
  // remessa/outra saída (x.9xx) no Simples: o CSOSN do cadastro é o de VENDA (102 → 101 com crédito, #2876) —
  // a operação exige a escolha explícita (400 ou 900, conforme a contabilidade)
  if (!icms && e.simples && todos.some((c) => c.length === 4 && c[1] === '9')) {
    erros.push('Remessa/outra saída (CFOP x.9xx) no Simples: escolha o CSOSN da operação (400 ou 900, conforme a contabilidade).')
  }
  if (icms) {
    const validos = (e.simples ? ICMS_OPCOES_SIMPLES : ICMS_OPCOES_NORMAL).map((o) => o.codigo)
    if (!validos.includes(icms)) {
      erros.push(e.simples
        ? `Empresa do Simples: o ICMS da operação usa CSOSN (${validos.join(', ')}), não ${icms}.`
        : `Empresa do regime normal: o ICMS da operação usa CST (${validos.join(', ')}), não ${icms}.`)
    }
  }

  const ie = e.destinatario ? ieDestinatario(e.destinatario) : undefined
  if (ie?.erro) erros.push(ie.erro)
  if (ie?.aviso) avisos.push(ie.aviso)

  return { cfop: nota.cfop, itensCfop, erros, avisos, ...(ie ? { ie } : {}) }
}
