// Rota canônica da tela Fees (blueprint P&M tela 113 · PM-F F3). A tela de Fees — cada fee com a
// esteira Briefing · Planejamento do mês · Jobs gerados × contratados e os botões "Fazer briefing",
// "Planejar o mês" e "Ver jobs" — já vive em /dashboard/pm/contratos (o item do menu chama "Fees").
// Esta rota resolve o endereço esperado pelo blueprint/jornada à mesma tela, sem duplicar a UI.
import { redirect } from 'next/navigation'

export default function PmFeesRota() {
  redirect('/dashboard/pm/contratos')
}
