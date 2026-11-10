// O painel v7 passou a ser a tela principal em /dashboard/comercial/meu-painel (CEO 10/11, passo 10).
// Esta rota de desenvolvimento (meu-painel-v6) continua apontando para a tela principal, por compatibilidade
// com links antigos. O código vive em ../meu-painel.
import { redirect } from 'next/navigation'

export default function MeuPainelV6Redirect() {
  redirect('/dashboard/comercial/meu-painel')
}
