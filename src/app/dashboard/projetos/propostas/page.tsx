"use client";
import { PlaceholderTab } from "../_components/PlaceholderTab";

export default function PropostasPage() {
  return (
    <PlaceholderTab
      icone="📄"
      titulo="Propostas Comerciais"
      descricao="Geração automática de propostas profissionais a partir do orçamento. Envio multicanal (email/WhatsApp/Portal), assinatura digital."
      fase="Fase 5"
      funcoesFuturas={[
        "PDF profissional com identidade visual",
        "Envio via Inbox Unificado",
        "Versionamento de propostas",
        "Assinatura digital",
        "Aprovação com 1 clique",
      ]}
    />
  );
}
