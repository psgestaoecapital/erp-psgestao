// src/app/dashboard/projetos/mao-obra/page.tsx
// Hub · Mão de obra — renderiza o componente compartilhado no contexto "hub" (RD-26). A tela vive em
// src/components/maoObra/MaoObraTela.tsx (a mesma usada pela Indústria/RH no contexto "industria").
"use client";
import { MaoObraTela } from "@/components/maoObra/MaoObraTela";

export default function MaoObraPage() {
  return <MaoObraTela contexto="hub" />;
}
