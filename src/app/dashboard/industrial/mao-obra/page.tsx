// Rota antiga do "Custo da mão de obra". Agora vive como aba "Custo por setor e cargo" do Painel de RH
// (/dashboard/industrial/rh/bi?aba=custo — ajuste do Eng. Chefe 25/11: o CEO colocou o custo no Painel de RH).
// Redireciona para a aba nova para o link salvo não quebrar (RD-30: a tela não foi apagada — virou aba).
import { redirect } from 'next/navigation'

export default function MaoObraCustoRedirect() {
  redirect('/dashboard/industrial/rh/bi?aba=custo')
}
