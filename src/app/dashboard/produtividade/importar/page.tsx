// Rota antiga de "Importar quadro". Agora vive como ABA da tela Postos e vagas (CEO 25/11, RH em 5 itens).
// Redireciona para a aba nova para o link salvo não quebrar (RD-30: a tela não foi apagada — virou aba).
import { redirect } from 'next/navigation'

export default function ImportarPostosRedirect() {
  redirect('/dashboard/produtividade?aba=importar')
}
