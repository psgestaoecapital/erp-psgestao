import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaBootstrap from "@/components/pwa/PwaBootstrap";

export const metadata: Metadata = {
  title: "PS Gestão e Capital — ERP Inteligente",
  description: "Assessoria Empresarial · BPO Financeiro · Consultoria de Investimentos",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "PS Gestão" },
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#3D2314",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        {children}
        <PwaBootstrap />
      </body>
    </html>
  );
}
