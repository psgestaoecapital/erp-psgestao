'use client'
// Rota direta do fluxo detalhado do Agente ATAK (segue funcional — guardrail da Parte D).
// O conteúdo vive em src/components/conectores/ConectorAtakAgente.tsx, o mesmo que abre no card
// "Atak / Frigosoft" da Central de Conectores (/dashboard/conectores).
import { ConectorAtakAgente } from '@/components/conectores/ConectorAtakAgente'

export default function ConectoresIndustrialPage() {
  return <ConectorAtakAgente />
}
