'use client'

// Agenda comercial no Hub de Projetos (blueprint §311, CEO 20/11): logo abaixo de Oportunidades,
// reaproveitando a MESMA agenda da área comercial (erp_agendamento origem_modulo='comercial',
// fn_agendamento_*), via o componente compartilhado AgendaComercialView (RD-26 — não recria).
// Só o rótulo de contexto muda; dados, RLS por empresa e a ajuda "?" são os mesmos do P&M.
import { AgendaComercialView } from '@/components/agenda/AgendaComercialView'

export default function HubAgendaPage() {
  return <AgendaComercialView eyebrow="🗓️ Hub de Projetos · Agenda comercial" />
}
