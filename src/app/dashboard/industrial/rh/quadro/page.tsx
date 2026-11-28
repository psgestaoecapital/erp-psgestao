// Rota antiga do "Quadro de pessoal". Agora vive como ABA da tela Pessoas (CEO 25/11, RH em 5 itens).
// Redireciona para a aba nova para o link salvo não quebrar (RD-30: a tela não foi apagada — virou aba).
import { redirect } from 'next/navigation'

export default function QuadroPessoalRedirect() {
  redirect('/dashboard/industrial/rh/pessoas?aba=quadro')
}
