import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PS Gestão e Capital — ERP Inteligente",
  description: "Assessoria Empresarial · BPO Financeiro · Consultoria de Investimentos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
