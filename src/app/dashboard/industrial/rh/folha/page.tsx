// Rota antiga do item "Folha" do RH industrial. O item canônico passou a viver em
// /dashboard/industrial/folha (CEO 25/11, "RH em 5 itens"). Redireciona para a rota nova para o
// link salvo não quebrar (RD-30: a tela não foi apagada — virou a rota canônica /industrial/folha).
import { redirect } from 'next/navigation'

export default function FolhaRedirect() {
  redirect('/dashboard/industrial/folha')
}
