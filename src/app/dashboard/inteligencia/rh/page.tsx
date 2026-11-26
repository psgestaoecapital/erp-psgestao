// Rota antiga do "RH" (Inteligência → Recursos humanos). A View foi extraída pra src/components/rh/RhHubView.tsx
// (ajuste do Eng. Chefe 25/11, como as outras abas do RH) e agora vive como a aba "Lotação e remuneração
// variável" do Painel de RH. Esta rota redireciona pra lá para o link salvo não quebrar (RD-30: nada apagado).
import { redirect } from 'next/navigation'

export default function RhHubRedirect() {
  redirect('/dashboard/industrial/rh/bi?aba=lotacao')
}
