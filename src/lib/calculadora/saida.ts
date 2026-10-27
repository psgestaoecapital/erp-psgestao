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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const brl = (v: number) => r2(v).toFixed(2).replace('.', ',')

// Documento HTML da lista de compra para imprimir / salvar como PDF (sem biblioteca: o navegador gera o PDF).
export function listaDeCompraHtml(linhas: LinhaCusto[], titulo: string): string {
  let total = 0
  const corpo = linhas.map(l => {
    const sub = r2(l.item.quantidade * (l.custoUnitario ?? 0)); total += sub
    return `<tr><td>${esc(l.produto?.nome ?? l.item.descricao)}</td><td class="n">${String(l.item.quantidade).replace('.', ',')}</td><td>${esc(l.item.unidadeCompra)}</td><td class="n">${brl(l.custoUnitario ?? 0)}</td><td class="n">${brl(sub)}</td></tr>`
  }).join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>body{font-family:system-ui,sans-serif;color:#2A1A10;margin:24px}h1{color:#C8941A;font-size:20px}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #E8E2D6;padding:6px 8px;text-align:left;font-size:13px}th{background:#3D2314;color:#fff}.n{text-align:right}tfoot td{font-weight:700}</style></head><body><h1>${esc(titulo)}</h1><table><thead><tr><th>Material</th><th class="n">Qtd</th><th>Un.</th><th class="n">Custo unit.</th><th class="n">Subtotal</th></tr></thead><tbody>${corpo}</tbody><tfoot><tr><td colspan="4">Total</td><td class="n">${brl(total)}</td></tr></tfoot></table></body></html>`
}
