// Gate (chamado #2138, Pdois): a listagem de Contas a Receber lê cliente/boleto/NF da empresa inteira.
// O PostgREST corta em 1000 linhas; com 1009 títulos o título alterado por último (boleto registrado,
// NF emitida) ficava de fora e a tela mostrava "⚠ Gerar boleto" com o cadastro completo.
import { readFileSync } from 'node:fs'
import { selecionarTodas } from '../../src/lib/selecionarTodas'

let falhas = 0
const ok = (cond: boolean, msg: string) => { if (!cond) { falhas++; console.error('✗', msg) } else console.log('✓', msg) }

const tela = readFileSync('src/components/financeiro/ListagemPagarReceberView.tsx', 'utf8')
for (const tabela of ['erp_nfse_emitidas', 'erp_nfe_emitidas', 'erp_receber']) {
  const re = new RegExp(`selecionarTodas<[^>]*>\\(\\(de, ate\\) => supabase\\s*\\.from\\('${tabela}'\\)[\\s\\S]{0,400}?\\.order\\('id'\\)\\s*\\.range\\(de, ate\\)\\)`)
  ok(re.test(tela), `listagem lê ${tabela} da empresa em páginas (ordem por id + range)`)
}

async function main() {
  // Simula o PostgREST: 1009 títulos, no máximo 1000 por requisição; o 1003º é o LOJAS VAMA 20/10.
  const titulos = Array.from({ length: 1009 }, (_, i) => ({ id: `t${String(i).padStart(4, '0')}` }))
  const postgrest = (de: number, ate: number) =>
    Promise.resolve({ data: titulos.slice(de, Math.min(ate + 1, de + 1000)), error: null })
  const { data, error } = await selecionarTodas(postgrest)
  ok(!error && data.length === 1009, `lê os 1009 títulos (veio ${data.length})`)
  ok(data.some((t) => t.id === 't1002'), 'o título além da linha 1000 está na lista')
  const repetidos = data.length - new Set(data.map((t) => t.id)).size
  ok(repetidos === 0, 'nenhum título repetido entre páginas')
  if (falhas) process.exit(1)
}
main()
