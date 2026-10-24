// HB2 · Importar tabela de preço colando a planilha (Excel/Sheets): uma faixa por linha, colunas separadas por tab ou ";".
// Colunas: código do serviço · nome · unidade · de · até (vazio = em diante) · preço base. Cabeçalho é ignorado.
export type FaixaImportada = { servico_ref: string; servico_nome: string; unidade: string; faixa_de: number; faixa_ate: number | null; preco_base: number }
export type ResultadoImportacao = { faixas: FaixaImportada[]; erros: string[] }

const numero = (v: string): number | null => {
  const t = v.trim().replace(/^R\$\s*/, '').replace(/\s/g, '')
  if (t === '') return null
  // "1.234,56" (pt-BR) e "1234.56" valem; vírgula é o decimal quando existe.
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : NaN
}

export function lerPlanilhaFaixas(texto: string): ResultadoImportacao {
  const faixas: FaixaImportada[] = []
  const erros: string[] = []
  texto.split(/\r?\n/).forEach((linha, i) => {
    if (!linha.trim()) return
    const c = linha.split(linha.includes('\t') ? '\t' : ';').map(x => x.trim())
    const n = i + 1
    const de = numero(c[3] ?? ''), ate = numero(c[4] ?? ''), preco = numero(c[5] ?? '')
    if (i === 0 && (de == null || Number.isNaN(de)) && (preco == null || Number.isNaN(preco))) return // cabeçalho
    if (c.length < 6) { erros.push(`Linha ${n}: faltam colunas (são 6: código, nome, unidade, de, até, preço).`); return }
    if (!c[0] || !c[1]) { erros.push(`Linha ${n}: código e nome do serviço são obrigatórios.`); return }
    if (de == null || Number.isNaN(de) || (ate != null && Number.isNaN(ate)) || preco == null || Number.isNaN(preco) || preco < 0) { erros.push(`Linha ${n}: confira os números (de, até e preço).`); return }
    if (ate != null && ate <= de) { erros.push(`Linha ${n}: "até" precisa ser maior que "de".`); return }
    faixas.push({ servico_ref: c[0], servico_nome: c[1], unidade: c[2] || 'un', faixa_de: de, faixa_ate: ate, preco_base: preco })
  })
  return { faixas, erros }
}
