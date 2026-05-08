"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { X } from "lucide-react";

interface TermoConsentModalProps {
  clienteId: string;
  onAceitar: (consentId: string) => void;
  onCancelar: () => void;
}

interface TermoTemplate {
  id: string;
  versao: string;
  titulo: string;
  texto_md: string;
  texto_md5: string;
}

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function TermoConsentModal({
  clienteId,
  onAceitar,
  onCancelar,
}: TermoConsentModalProps) {
  const [termo, setTermo] = useState<TermoTemplate | null>(null);
  const [loadingTermo, setLoadingTermo] = useState(true);
  const [scrollouAteFim, setScrollouAteFim] = useState(false);
  const [aceito, setAceito] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const load = async () => {
      const nowISO = new Date().toISOString();
      const { data, error: err } = await supabase
        .from("wealth_consent_templates")
        .select("id, versao, titulo, texto_md, texto_md5")
        .eq("tipo", "pluggy_open_finance")
        .lte("vigente_de", nowISO)
        .or(`vigente_ate.is.null,vigente_ate.gt.${nowISO}`)
        .order("vigente_de", { ascending: false })
        .limit(1)
        .single();
      if (err) {
        setError("Não foi possível carregar o termo de consentimento.");
      } else {
        setTermo(data);
      }
      setLoadingTermo(false);
    };
    load();
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 20) {
      setScrollouAteFim(true);
    }
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = true;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setHasSignature(true);
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#3D2314";
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endDraw = () => {
    drawingRef.current = false;
  };

  const limparAssinatura = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleConfirmar = async () => {
    if (!termo) return;
    if (!aceito || !hasSignature) {
      setError("Você precisa marcar a aceitação e fazer a assinatura.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const canvas = canvasRef.current;
      const assinaturaPng = canvas?.toDataURL("image/png") || "";

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Sessão expirada");

      // company_id do cliente (necessario para FK + RLS)
      const { data: cli, error: cliErr } = await supabase
        .from("wealth_clients")
        .select("company_id")
        .eq("id", clienteId)
        .single();
      if (cliErr || !cli) throw new Error("Cliente não acessível");

      let ip = "127.0.0.1";
      try {
        const r = await fetch("https://api.ipify.org?format=json");
        const j = await r.json();
        if (j.ip) ip = j.ip;
      } catch {
        /* fallback ok */
      }

      const aceitoEm = new Date().toISOString();
      const hashConsentimento = await sha256Hex(
        [
          clienteId,
          termo.versao,
          termo.texto_md5,
          assinaturaPng,
          aceitoEm,
          user.id,
          ip,
        ].join("|")
      );

      const { data, error: insErr } = await supabase
        .from("wealth_pluggy_consents")
        .insert({
          client_id: clienteId,
          company_id: cli.company_id,
          texto_consentimento_v: termo.versao,
          texto_consentimento_md5: termo.texto_md5,
          assinatura_canvas: assinaturaPng,
          hash_consentimento: hashConsentimento,
          ip,
          user_agent: navigator.userAgent,
          aceito_em: aceitoEm,
          aceito_por_user_id: user.id,
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      onAceitar(data.id);
    } catch (e) {
      setError(`Erro ao registrar consentimento: ${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingTermo) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
        <div className="bg-white rounded-lg p-8">
          <div
            className="animate-spin h-8 w-8 border-4 rounded-full mx-auto"
            style={{ borderColor: "#C8941A", borderTopColor: "transparent" }}
          />
        </div>
      </div>
    );
  }

  if (!termo) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg p-6 max-w-md">
          <p style={{ color: "#DC2626" }}>{error || "Termo não disponível"}</p>
          <button
            onClick={onCancelar}
            className="mt-4 px-4 py-2 rounded text-white"
            style={{ backgroundColor: "#3D2314" }}
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 md:p-4">
      <div className="bg-white rounded-lg w-full max-w-3xl max-h-[95vh] flex flex-col shadow-2xl">
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
        >
          <div>
            <h2 className="text-lg font-semibold" style={{ color: "#3D2314" }}>
              {termo.titulo}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "rgba(61, 35, 20, 0.6)" }}>
              Versão {termo.versao}
            </p>
          </div>
          <button
            onClick={onCancelar}
            className="hover:opacity-70"
            style={{ color: "rgba(61, 35, 20, 0.5)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-4 relative"
        >
          <div
            className="whitespace-pre-wrap text-sm leading-relaxed"
            style={{ color: "rgba(61, 35, 20, 0.85)" }}
          >
            {termo.texto_md}
          </div>
          {!scrollouAteFim && (
            <div
              className="sticky bottom-0 py-3 text-center text-xs font-medium"
              style={{
                background:
                  "linear-gradient(to top, white, rgba(255,255,255,0.95), transparent)",
                color: "#C8941A",
              }}
            >
              ↓ Role até o final para continuar
            </div>
          )}
        </div>

        <div
          className="px-6 py-4 border-t space-y-4"
          style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
        >
          <label
            className={`flex items-start gap-2 cursor-pointer text-sm ${
              !scrollouAteFim ? "opacity-40" : ""
            }`}
          >
            <input
              type="checkbox"
              checked={aceito}
              disabled={!scrollouAteFim}
              onChange={(e) => setAceito(e.target.checked)}
              className="mt-0.5"
            />
            <span style={{ color: "#3D2314" }}>
              Li e concordo integralmente com os termos acima. Autorizo a PS
              Gestão a coletar e processar os dados das instituições financeiras
              conectadas, conforme LGPD e a regulamentação BACEN do Open Finance.
            </span>
          </label>

          {aceito && (
            <div className="space-y-2">
              <label
                className="block text-sm font-medium"
                style={{ color: "#3D2314" }}
              >
                Assinatura (Lei 14.063/2020)
              </label>
              <div
                className="border-2 border-dashed rounded-lg p-2"
                style={{
                  borderColor: "rgba(61, 35, 20, 0.2)",
                  backgroundColor: "#FAF7F2",
                }}
              >
                <canvas
                  ref={canvasRef}
                  width={600}
                  height={120}
                  onPointerDown={startDraw}
                  onPointerMove={draw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                  className="w-full bg-white rounded touch-none cursor-crosshair"
                  style={{ touchAction: "none" }}
                />
              </div>
              <button
                onClick={limparAssinatura}
                className="text-xs underline hover:opacity-80"
                style={{ color: "rgba(61, 35, 20, 0.6)" }}
              >
                Limpar assinatura
              </button>
            </div>
          )}

          {error && (
            <div
              className="rounded-md border px-3 py-2 text-sm"
              style={{
                backgroundColor: "#FEF2F2",
                borderColor: "#FECACA",
                color: "#B91C1C",
              }}
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onCancelar}
              disabled={submitting}
              className="px-4 py-2 text-sm rounded-md border hover:opacity-80"
              style={{
                borderColor: "rgba(61, 35, 20, 0.2)",
                color: "#3D2314",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirmar}
              disabled={!aceito || !hasSignature || submitting}
              className="px-4 py-2 text-sm rounded-md hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: "#3D2314", color: "#FAF7F2" }}
            >
              {submitting ? "Registrando..." : "Confirmar e prosseguir"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
