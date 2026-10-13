// Tela de NF-e Recebidas (entrada de notas) sob o caminho fiscal (grupo Notas Fiscais no menu).
// A implementação REAL vive em compras/documentos-recebidos — lista via fn_nfe_recebidas_listar,
// "Buscar agora" (ciclo NSU da SEFAZ), aplicar XML, gerar pagar, entrada de estoque e vincular item->OS
// (Part 4 da oficina, #1038). Aqui é só o alias de rota; a tela não depende do path (usa useCompanyIds).
import DocumentosRecebidosScreen from '@/app/dashboard/compras/documentos-recebidos/page'

export default function NfeRecebidasPage() {
  return <DocumentosRecebidosScreen />
}
