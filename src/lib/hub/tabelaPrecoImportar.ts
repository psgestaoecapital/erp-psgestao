// HB2 · Importar tabela de preço colando a planilha (Excel/Sheets): uma faixa por linha, colunas separadas por tab ou ";".
// Colunas: código do serviço · nome · unidade · de · até (vazio = em diante) · preço base. Cabeçalho é ignorado.
export type FaixaImportada = { servico_ref: string; servico_nome: string; unidade: string; faixa_de: number; faixa_ate: number | null; preco_base: number }
// linhas: revisão lado a lado — o texto original de cada linha ao lado do que foi entendido (faixa) ou do motivo da recusa (erro).
export type LinhaRevisao = { n: number; original: string; faixa: FaixaImportada | null; erro: string | null }
export type ResultadoImportacao = { faixas: FaixaImportada[]; erros: string[]; linhas: LinhaRevisao[] }

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
  const linhas: LinhaRevisao[] = []
  const recusar = (n: number, original: string, e: string) => { erros.push(e); linhas.push({ n, original, faixa: null, erro: e }) }
  texto.split(/\r?\n/).forEach((linha, i) => {
    if (!linha.trim()) return
    const c = linha.split(linha.includes('\t') ? '\t' : ';').map(x => x.trim())
    const n = i + 1
    const de = numero(c[3] ?? ''), ate = numero(c[4] ?? ''), preco = numero(c[5] ?? '')
    if (i === 0 && (de == null || Number.isNaN(de)) && (preco == null || Number.isNaN(preco))) return // cabeçalho
    if (c.length < 6) { recusar(n, linha, `Linha ${n}: faltam colunas (são 6: código, nome, unidade, de, até, preço).`); return }
    if (!c[0] || !c[1]) { recusar(n, linha, `Linha ${n}: código e nome do serviço são obrigatórios.`); return }
    if (de == null || Number.isNaN(de) || (ate != null && Number.isNaN(ate)) || preco == null || Number.isNaN(preco) || preco < 0) { recusar(n, linha, `Linha ${n}: confira os números (de, até e preço).`); return }
    if (ate != null && ate <= de) { recusar(n, linha, `Linha ${n}: "até" precisa ser maior que "de".`); return }
    const faixa = { servico_ref: c[0], servico_nome: c[1], unidade: c[2] || 'un', faixa_de: de, faixa_ate: ate, preco_base: preco }
    faixas.push(faixa); linhas.push({ n, original: linha, faixa, erro: null })
  })
  return { faixas, erros, linhas }
}
