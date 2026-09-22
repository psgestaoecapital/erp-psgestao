/**
 * Gate de build: abre a planilha padrão de CADASTROS e confere que as CHAVES TÉCNICAS
 * (aba "Cadastros", linha 4) são EXATAMENTE as de src/lib/cadastros/colunasImportacao.ts, na mesma ordem.
 * Se divergir, sai com código 1 e QUEBRA O BUILD (chamado antes do next build no package.json).
 *
 *   tsx scripts/check-modelo-cadastros.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'
import { CHAVES_CADASTROS } from '../src/lib/cadastros/colunasImportacao'

const MODELO = path.join(process.cwd(), 'public', 'modelos', 'MODELO_importacao_cadastros_PS.xlsx')

function main() {
  if (!fs.existsSync(MODELO)) {
    console.error(`[check-modelo-cadastros] modelo não encontrado: ${MODELO}\n` +
      `Gere com: python3 scripts/modelos/gerar_modelo_cadastros_ps.py`)
    process.exit(1)
  }
  const wb = XLSX.read(fs.readFileSync(MODELO), { type: 'buffer' })
  const ws = wb.Sheets['Cadastros']
  if (!ws) { console.error('[check-modelo-cadastros] aba "Cadastros" não existe no modelo'); process.exit(1) }
  const linhas = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
  const linha4 = (linhas[3] || []).map((c) => String(c).trim())   // linha 4 = índice 3
  const chavesModelo = linha4.slice(0, CHAVES_CADASTROS.length)

  const igual = chavesModelo.length === CHAVES_CADASTROS.length &&
    chavesModelo.every((k, i) => k === CHAVES_CADASTROS[i])

  if (!igual) {
    console.error('[check-modelo-cadastros] DIVERGÊNCIA entre o modelo e src/lib/cadastros/colunasImportacao.ts')
    console.error('  modelo (linha 4):', JSON.stringify(chavesModelo))
    console.error('  código (CHAVES): ', JSON.stringify(CHAVES_CADASTROS))
    console.error('  Regenere o modelo (python3 scripts/modelos/gerar_modelo_cadastros_ps.py) ou alinhe a lista.')
    process.exit(1)
  }
  console.log(`[check-modelo-cadastros] OK — ${CHAVES_CADASTROS.length} chaves batem com a planilha padrão.`)
}

main()
