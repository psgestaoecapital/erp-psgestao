import type { Metadata } from "next";
import "./globals.css";
import LgpdConsentModal from "@/components/LgpdConsentModal";

export const metadata: Metadata = {
  title: "PS Gestão e Capital — ERP Inteligente",
  description: "Assessoria Empresarial · BPO Financeiro · Consultoria de Investimentos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {/*
          Pilar 1 LGPD: modal de aceite montado no root layout cobre 100% das
          rotas autenticadas (dashboard, wealth, admin, cliente). Foi removido
          acidentalmente em commit a11856d (19/04/2026 — refactor layout v11.0
          premium). Modal faz check interno de session — retorna null se nao
          ha user (paginas publicas /termos, /privacidade nao mostram).
        */}
        <LgpdConsentModal />
        {children}
      </body>
    </html>
  );
}
