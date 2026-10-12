// Download PÚBLICO (sem login) do modelo de importação da Mão de obra — só cabeçalhos, listas, Leia-me e linha de exemplo
// fictícia; nenhum dado de cliente. Fonte única do arquivo (RD-65): a tela "Baixar modelo" usa esta mesma rota.
import { gerarModeloMaoObra } from '@/lib/hub/planilhaMaoObra'

export const runtime = 'nodejs'
export const dynamic = 'force-static'

export async function GET() {
  const arq = await (await gerarModeloMaoObra()).arrayBuffer()
  return new Response(arq, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="MODELO_mao_de_obra_PS.xlsx"',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
