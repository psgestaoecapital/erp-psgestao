// Calculadora de Obra (HB2 fatia 4): saída "mandar para o orçamento" e lista de compra. Sem rede: devolve linhas prontas.
import type { LinhaCusto } from './depara'

export type ItemOrcamento = {
  orcamento_id: string; company_id: string; ordem: number; tipo_item: 'produto'
  produto_id: string | null; produto_nome: string; unidade: string; quantidade: number
  preco_unitario: number; preco_custo: number; subtotal: number; observacoes: string
}

const r2 = (v: number) => Math.round(v * 100) / 100

// Item sem produto vinculado entra com preço 0 (o usuário completa no orçamento); nada é descartado.
export function itensParaOrcamento(linhas: LinhaCusto[], orcamentoId: string, companyId: string, ordemInicial = 0): ItemOrcamento[] {
  return linhas.map((l, idx) => {
    const custo = l.custoUnitario ?? 0
    return {
      orcamento_id: orcamentoId, company_id: companyId, ordem: ordemInicial + idx + 1, tipo_item: 'produto' as const,
      produto_id: l.produto?.id ?? null, produto_nome: l.produto?.nome ?? l.item.descricao,
      unidade: l.item.unidadeCompra, quantidade: l.item.quantidade,
      preco_unitario: custo, preco_custo: custo, subtotal: r2(l.item.quantidade * custo),
      observacoes: 'Calculadora de Obra: ' + l.item.conta,
    }
  })
}

export function listaDeCompra(linhas: LinhaCusto[], titulo: string): string {
  const corpo = linhas.map(l => `- ${l.item.quantidade} × ${l.item.unidadeCompra} · ${l.produto?.nome ?? l.item.descricao}`)
  return [titulo, ...corpo].join('\n')
}

// Link do WhatsApp com a lista pronta (sem número: o usuário escolhe o contato).
export function linkWhatsApp(texto: string): string {
  return 'https://wa.me/?text=' + encodeURIComponent(texto)
}

const campoCsv = (v: string | number) => {
  const s = String(v)
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

// CSV com separador ";" e BOM, para abrir direto no Excel brasileiro.
export function listaDeCompraCsv(linhas: LinhaCusto[]): string {
  const cab = ['Material', 'Quantidade', 'Unidade', 'Custo unitário', 'Subtotal']
  const corpo = linhas.map(l => {
    const custo = l.custoUnitario ?? 0
    return [l.produto?.nome ?? l.item.descricao, String(l.item.quantidade).replace('.', ','), l.item.unidadeCompra,
      r2(custo).toFixed(2).replace('.', ','), r2(l.item.quantidade * custo).toFixed(2).replace('.', ',')].map(campoCsv).join(';')
  })
  return '﻿' + [cab.join(';'), ...corpo].join('\r\n')
}
