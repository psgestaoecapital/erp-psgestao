/**
 * Gate de build (contexto 9c43a93d): abre a planilha padrão de estoque e confere que as CHAVES TÉCNICAS
 * (aba "Estoque", linha 4) são EXATAMENTE as de src/lib/estoque/colunasImportacao.ts, na mesma ordem.
 * Se divergir, sai com código 1 e QUEBRA O BUILD (chamado antes do next build no package.json).
 *
 *   tsx scripts/check-modelo-estoque.ts
 */
import * as fs from 'fs'
import * as path from 'path'
import * as XLSX from 'xlsx'
import { CHAVES_ESTOQUE } from '../src/lib/estoque/colunasImportacao'

const MODELO = path.join(process.cwd(), 'public', 'modelos', 'MODELO_migracao_estoque_PS.xlsx')

function main() {
  if (!fs.existsSync(MODELO)) {
    console.error(`[check-modelo-estoque] modelo não encontrado: ${MODELO}\n` +
      `Gere com: python3 scripts/modelos/gerar_modelo_estoque_ps.py`)
    process.exit(1)
  }
  const wb = XLSX.read(fs.readFileSync(MODELO), { type: 'buffer' })
  const ws = wb.Sheets['Estoque']
  if (!ws) { console.error('[check-modelo-estoque] aba "Estoque" não existe no modelo'); process.exit(1) }
  const linhas = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' })
  const linha4 = (linhas[3] || []).map((c) => String(c).trim())   // linha 4 = índice 3
  const chavesModelo = linha4.slice(0, CHAVES_ESTOQUE.length)

  const igual = chavesModelo.length === CHAVES_ESTOQUE.length &&
    chavesModelo.every((k, i) => k === CHAVES_ESTOQUE[i])

  if (!igual) {
    console.error('[check-modelo-estoque] DIVERGÊNCIA entre o modelo e src/lib/estoque/colunasImportacao.ts')
    console.error('  modelo (linha 4):', JSON.stringify(chavesModelo))
    console.error('  código (CHAVES): ', JSON.stringify(CHAVES_ESTOQUE))
    console.error('  Regenere o modelo (python3 scripts/modelos/gerar_modelo_estoque_ps.py) ou alinhe a lista.')
    process.exit(1)
  }
  console.log(`[check-modelo-estoque] OK — ${CHAVES_ESTOQUE.length} chaves batem com a planilha padrão.`)
}

main()
