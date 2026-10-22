// #1677 etapa 4 · Ordem de Fornecimento em PDF (a partir do pedido de compra, erp_compras).
// Parte pura (sem rede): monta os blocos e o PDF com os dados das duas empresas, itens, valores, entrega, frete CIF/FOB,
// pagamento e o texto obrigatório para as observações da NF do fornecedor. A leitura do banco fica em
// carregarOrdemFornecimento (cliente, pelas tabelas com RLS da empresa) e o download no componente OrdemFornecimentoCard.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface EmpresaOF {
  razao_social: string | null; nome_fantasia?: string | null; cnpj: string | null; ie?: string | null
  endereco?: string | null; cidade_uf?: string | null; cep?: string | null; telefone?: string | null; email?: string | null
}
export interface ItemOF {
  codigo: string | null; descricao: string; unidade: string | null; quantidade: number
  preco_unitario: number | null; subtotal: number | null
}
export interface DadosOF {
  numero: string; data_pedido: string | null; emitido_em: string
  comprador: EmpresaOF; fornecedor: EmpresaOF; itens: ItemOF[]
  subtotal: number | null; desconto_valor: number | null; acrescimo_valor: number | null; frete_valor: number | null; total: number | null
  data_prevista: string | null; prazo_entrega_dias: number | null; frete_tipo: string | null; transportadora: string | null
  condicao_pagamento: string | null; forma_pagamento: string | null; parcelas: number | null; primeiro_vencimento: string | null
  observacoes: string | null
}

export const FRETE_ROTULO: Record<string, string> = {
  CIF: 'CIF (por conta do fornecedor)',
  FOB: 'FOB (por conta do comprador)',
  SEM: 'Sem frete (retirada)',
}

export const FORMA_ROTULO: Record<string, string> = { boleto: 'Boleto', pix: 'Pix', transferencia: 'Transferência', cartao_credito: 'Cartão de crédito', dinheiro: 'Dinheiro' }

export function textoObrigatorioNF(numero: string): string {
  return `INFORMAÇÕES OBRIGATÓRIAS NAS OBSERVAÇÕES DA NF: ORDEM DE FORNECIMENTO Nº ${numero}`
}

// O que falta preencher no pedido para a OF sair completa (a tela avisa antes de baixar; o PDF sai mesmo assim).
export function pendenciasOF(d: Pick<DadosOF, 'data_prevista' | 'prazo_entrega_dias' | 'frete_tipo' | 'condicao_pagamento' | 'itens'>): string[] {
  const p: string[] = []
  if (!d.itens.length) p.push('itens')
  if (!d.data_prevista && !d.prazo_entrega_dias) p.push('entrega')
  if (!d.frete_tipo) p.push('frete (CIF/FOB)')
  if (!d.condicao_pagamento) p.push('condição de pagamento')
  return p
}

const brl = (v: number | null | undefined) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })
const qtd = (v: number) => Number(v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })
export const dataBR = (s: string | null | undefined) => { if (!s) return '-'; const [y, m, d] = s.slice(0, 10).split('-'); return d && m && y ? `${d}/${m}/${y}` : '-' }

export function docFormatado(doc: string | null | undefined): string {
  const d = (doc ?? '').replace(/\D/g, '')
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  return doc?.trim() || '-'
}

// pdf-lib (Helvetica/WinAnsi) só desenha Latin-1: normaliza os comuns e troca o resto por '?' (não quebra).
const ansi = (s: string) => (s ?? '')
  .replace(/[‒–—―]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/•/g, '·').replace(/…/g, '...')
  .replace(/[^\x00-\xFF]/g, '?')

export type Endereco = { logradouro?: string | null; numero?: string | null; complemento?: string | null; bairro?: string | null; endereco?: string | null; cidade?: string | null; uf?: string | null; cidade_estado?: string | null }

export function enderecoLinha(e: Endereco): string | null {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ')
  const partes = [rua || null, e.complemento, e.bairro].filter(Boolean).join(' - ')
  return partes || e.endereco || null
}
export function cidadeUf(e: Endereco): string | null {
  return e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ''}` : (e.cidade_estado || null)
}

export function linhasEmpresa(e: EmpresaOF): string[] {
  const l = [e.razao_social || e.nome_fantasia || '-']
  if (e.nome_fantasia && e.razao_social && e.nome_fantasia !== e.razao_social) l.push(`Nome fantasia: ${e.nome_fantasia}`)
  l.push(`CNPJ/CPF: ${docFormatado(e.cnpj)}${e.ie ? ` · IE: ${e.ie}` : ''}`)
  const end = [e.endereco, e.cidade_uf, e.cep ? `CEP ${e.cep}` : null].filter(Boolean).join(' · ')
  if (end) l.push(end)
  const cont = [e.telefone, e.email].filter(Boolean).join(' · ')
  if (cont) l.push(cont)
  return l
}

export function linhasEntregaPagamento(d: DadosOF): { entrega: string[]; pagamento: string[] } {
  const entrega = [
    `Entrega prevista: ${d.data_prevista ? dataBR(d.data_prevista) : d.prazo_entrega_dias ? `${d.prazo_entrega_dias} dia(s) após o pedido` : 'a combinar'}`,
    `Frete: ${d.frete_tipo ? (FRETE_ROTULO[d.frete_tipo] ?? d.frete_tipo) : 'a combinar'}${d.frete_valor ? ` · ${brl(d.frete_valor)}` : ''}`,
  ]
  if (d.transportadora) entrega.push(`Transportadora: ${d.transportadora}`)
  const pagamento = [`Condição: ${d.condicao_pagamento || 'a combinar'}`]
  if (d.forma_pagamento) pagamento.push(`Forma: ${FORMA_ROTULO[d.forma_pagamento] ?? d.forma_pagamento}`)
  if (d.parcelas && d.parcelas > 1) pagamento.push(`Parcelas: ${d.parcelas}`)
  if (d.primeiro_vencimento) pagamento.push(`1º vencimento: ${dataBR(d.primeiro_vencimento)}`)
  return { entrega, pagamento }
}

function quebrar(texto: string, font: PDFFont, size: number, largura: number): string[] {
  const out: string[] = []
  for (const par of ansi(texto).split('\n')) {
    let linha = ''
    for (const palavra of par.split(/\s+/)) {
      const tent = linha ? `${linha} ${palavra}` : palavra
      if (font.widthOfTextAtSize(tent, size) <= largura) { linha = tent; continue }
      if (linha) out.push(linha)
      linha = palavra
      while (font.widthOfTextAtSize(linha, size) > largura && linha.length > 1) {
        let n = linha.length
        while (n > 1 && font.widthOfTextAtSize(linha.slice(0, n), size) > largura) n--
        out.push(linha.slice(0, n)); linha = linha.slice(n)
      }
    }
    out.push(linha)
  }
  return out
}

const A4: [number, number] = [595.28, 841.89]
const M = 36
const COR = { texto: rgb(0.12, 0.1, 0.08), suave: rgb(0.42, 0.38, 0.34), linha: rgb(0.85, 0.82, 0.78), destaque: rgb(0.55, 0.42, 0.18), fundo: rgb(0.97, 0.95, 0.92) }

export async function montarOrdemFornecimentoPdf(d: DadosOF): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(ansi(`Ordem de Fornecimento ${d.numero}`))
  const reg = await pdf.embedFont(StandardFonts.Helvetica)
  const neg = await pdf.embedFont(StandardFonts.HelveticaBold)
  const W = A4[0] - 2 * M
  let page: PDFPage = pdf.addPage(A4)
  let y = A4[1] - M

  const txt = (s: string, x: number, yy: number, size = 9, f: PDFFont = reg, color = COR.texto) => page.drawText(ansi(s), { x, y: yy, size, font: f, color })
  const novaPagina = () => {
    page = pdf.addPage(A4); y = A4[1] - M
    txt(`Ordem de Fornecimento Nº ${d.numero} (continuação)`, M, y - 10, 10, neg); y -= 24
  }
  const garantir = (h: number) => { if (y - h < M + 20) novaPagina() }

  // Cabeçalho
  txt('ORDEM DE FORNECIMENTO', M, y - 16, 16, neg)
  txt(`Nº ${d.numero}`, A4[0] - M - neg.widthOfTextAtSize(ansi(`Nº ${d.numero}`), 16), y - 16, 16, neg, COR.destaque)
  y -= 30
  txt(`Data do pedido: ${dataBR(d.data_pedido)}   ·   Emitida em: ${dataBR(d.emitido_em)}`, M, y, 9, reg, COR.suave)
  y -= 14

  // Comprador | Fornecedor
  const col = (W - 12) / 2
  const blocoEmpresa = (titulo: string, e: EmpresaOF) => linhasEmpresa(e).flatMap((l, i) => quebrar(l, i === 0 ? neg : reg, 8.5, col - 12).map((t) => ({ t, f: i === 0 ? neg : reg }))).map((x) => ({ ...x, titulo }))
  const comp = blocoEmpresa('COMPRADOR', d.comprador)
  const forn = blocoEmpresa('FORNECEDOR', d.fornecedor)
  const hEmp = 22 + Math.max(comp.length, forn.length) * 11
  for (const [i, bloco] of [comp, forn].entries()) {
    const x = M + i * (col + 12)
    page.drawRectangle({ x, y: y - hEmp, width: col, height: hEmp, borderColor: COR.linha, borderWidth: 0.8 })
    txt(i === 0 ? 'COMPRADOR' : 'FORNECEDOR', x + 6, y - 13, 8, neg, COR.destaque)
    bloco.forEach((l, k) => txt(l.t, x + 6, y - 26 - k * 11, 8.5, l.f))
  }
  y -= hEmp + 16

  // Itens
  const cols = [
    { h: '#', w: 22, a: 'r' as const }, { h: 'Código', w: 62, a: 'l' as const }, { h: 'Descrição', w: 0, a: 'l' as const },
    { h: 'Un', w: 30, a: 'l' as const }, { h: 'Qtd', w: 52, a: 'r' as const }, { h: 'Preço unit.', w: 70, a: 'r' as const }, { h: 'Subtotal', w: 76, a: 'r' as const },
  ]
  cols[2].w = W - cols.reduce((s, c) => s + c.w, 0)
  const cabecalhoItens = () => {
    page.drawRectangle({ x: M, y: y - 16, width: W, height: 16, color: COR.fundo })
    let x = M
    for (const c of cols) { const s = ansi(c.h); txt(s, c.a === 'r' ? x + c.w - 4 - neg.widthOfTextAtSize(s, 8) : x + 4, y - 11, 8, neg); x += c.w }
    y -= 18
  }
  cabecalhoItens()
  d.itens.forEach((it, i) => {
    const desc = quebrar(it.descricao || '-', reg, 8.5, cols[2].w - 8)
    const h = Math.max(1, desc.length) * 10 + 4
    if (y - h < M + 20) { novaPagina(); cabecalhoItens() }
    const vals = [String(i + 1), it.codigo ?? '', '', it.unidade ?? '', qtd(it.quantidade), it.preco_unitario == null ? '-' : brl(it.preco_unitario), it.subtotal == null ? '-' : brl(it.subtotal)]
    let x = M
    cols.forEach((c, k) => {
      if (k === 2) desc.forEach((l, j) => txt(l, x + 4, y - 9 - j * 10, 8.5))
      else { const s = ansi(vals[k]); txt(s, c.a === 'r' ? x + c.w - 4 - reg.widthOfTextAtSize(s, 8.5) : x + 4, y - 9, 8.5) }
      x += c.w
    })
    y -= h
    page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.4, color: COR.linha })
  })
  if (!d.itens.length) { txt('Sem itens.', M + 4, y - 10, 8.5, reg, COR.suave); y -= 16 }

  // Totais
  const totais: [string, number | null][] = [['Subtotal', d.subtotal], ['Desconto', d.desconto_valor ? -Math.abs(d.desconto_valor) : null], ['Frete', d.frete_valor], ['Acréscimo', d.acrescimo_valor]]
  const linhasTot = totais.filter(([k, v]) => k === 'Subtotal' || (v != null && v !== 0))
  garantir(linhasTot.length * 12 + 24)
  y -= 6
  for (const [k, v] of linhasTot) { const s = brl(v); txt(k, M + W - 200, y - 9, 9, reg, COR.suave); txt(s, M + W - 4 - reg.widthOfTextAtSize(ansi(s), 9), y - 9, 9); y -= 12 }
  const tot = brl(d.total)
  txt('TOTAL', M + W - 200, y - 12, 11, neg); txt(tot, M + W - 4 - neg.widthOfTextAtSize(ansi(tot), 11), y - 12, 11, neg, COR.destaque)
  y -= 26

  // Entrega e pagamento
  const { entrega, pagamento } = linhasEntregaPagamento(d)
  const e2 = entrega.flatMap((l) => quebrar(l, reg, 8.5, col - 12))
  const p2 = pagamento.flatMap((l) => quebrar(l, reg, 8.5, col - 12))
  const hEP = 22 + Math.max(e2.length, p2.length) * 11
  garantir(hEP + 8)
  for (const [i, ls] of [e2, p2].entries()) {
    const x = M + i * (col + 12)
    page.drawRectangle({ x, y: y - hEP, width: col, height: hEP, borderColor: COR.linha, borderWidth: 0.8 })
    txt(i === 0 ? 'ENTREGA E FRETE' : 'PAGAMENTO', x + 6, y - 13, 8, neg, COR.destaque)
    ls.forEach((l, k) => txt(l, x + 6, y - 26 - k * 11, 8.5))
  }
  y -= hEP + 14

  // Observações
  if (d.observacoes?.trim()) {
    const obs = quebrar(d.observacoes.trim(), reg, 8.5, W - 12)
    garantir(20 + obs.length * 11)
    txt('OBSERVAÇÕES', M, y - 9, 8, neg, COR.destaque); y -= 20
    obs.forEach((l) => { garantir(11); txt(l, M, y - 9, 8.5); y -= 11 })
    y -= 8
  }

  // Texto obrigatório na NF
  const obrig = quebrar(textoObrigatorioNF(d.numero), neg, 10, W - 20)
  const hOb = 14 + obrig.length * 13
  garantir(hOb + 70)
  page.drawRectangle({ x: M, y: y - hOb, width: W, height: hOb, color: COR.fundo, borderColor: COR.destaque, borderWidth: 1 })
  obrig.forEach((l, k) => txt(l, M + 10, y - 17 - k * 13, 10, neg))
  y -= hOb + 44

  // Assinaturas: quem comprou e quem confere o recebimento
  for (const [i, rot] of ['Comprador', 'Conferido no recebimento por / data'].entries()) {
    const x = M + i * (col + 12)
    page.drawLine({ start: { x, y }, end: { x: x + col, y }, thickness: 0.6, color: COR.suave })
    txt(rot, x, y - 11, 8, reg, COR.suave)
  }

  const paginas = pdf.getPages()
  paginas.forEach((p, i) => {
    const s = ansi(`Ordem de Fornecimento Nº ${d.numero} · página ${i + 1} de ${paginas.length}`)
    p.drawText(s, { x: A4[0] - M - reg.widthOfTextAtSize(s, 7), y: M - 14, size: 7, font: reg, color: COR.suave })
  })
  return pdf.save()
}

export function nomeArquivoOF(numero: string): string {
  return `ordem_fornecimento_${(numero || 'pedido').replace(/[^A-Za-z0-9_-]+/g, '_')}.pdf`
}
