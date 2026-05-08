"use client";

import { useWealthMode } from "@/lib/stores/wealth-mode-store";
import { WealthModeToggle } from "@/components/wealth/wealth-mode-toggle";
import { WealthConsultorView } from "@/components/wealth/wealth-consultor-view";
import { WealthClienteView } from "@/components/wealth/wealth-cliente-view";

export default function WealthPage() {
  const { mode } = useWealthMode();

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-7xl">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <p
            className="text-sm uppercase tracking-wider font-semibold"
            style={{ color: "#C8941A" }}
          >
            Multi Family Office
          </p>
          <h1
            className="text-3xl md:text-4xl"
            style={{ color: "#3D2314", fontFamily: "serif" }}
          >
            Wealth · MFO
          </h1>
          <p className="mt-1" style={{ color: "rgba(61, 35, 20, 0.7)" }}>
            Gestão consultiva de patrimônio · CVM 19/2021
          </p>
        </div>
        <WealthModeToggle />
      </div>

      {mode === "consultor" ? <WealthConsultorView /> : <WealthClienteView />}

      <div
        className="mt-12 rounded-lg border p-4"
        style={{ borderColor: "rgba(61, 35, 20, 0.1)", backgroundColor: "#FAF7F2" }}
      >
        <p
          className="text-xs flex items-center gap-2"
          style={{ color: "rgba(61, 35, 20, 0.6)" }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: "#C8941A" }}
          />
          Acesso restrito a admins e consultores autorizados. Dados patrimoniais com RLS isolada por consultor (LGPD Art. 37).
        </p>
      </div>
    </div>
  );
}
