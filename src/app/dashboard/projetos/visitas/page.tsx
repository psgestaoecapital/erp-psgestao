"use client";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function VisitasPage() {
  return (
    <PlaceholderTab
      icone="🗺️"
      titulo="Visitas Técnicas"
      descricao="Vendedor em campo registra visita ao local da obra: localização GPS, fotos, medidas iniciais, briefing do cliente, prazos."
      fase="Fase 2"
      funcoesFuturas={[
        "App mobile-first para vendedor",
        "Captura GPS automática",
        "Upload de fotos",
        "Áudio de briefing",
        "Funciona offline (sincroniza ao voltar online)",
      ]}
    />
  );
}
