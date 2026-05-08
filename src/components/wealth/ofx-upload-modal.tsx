"use client";

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { X, Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";

interface OFXUploadModalProps {
  clienteId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface UploadResult {
  ok: boolean;
  upload_id: string;
  corretora_detectada: string;
  total_transactions: number;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  message: string;
}

const MAX_SIZE = 5 * 1024 * 1024;

const corretoraLabels: Record<string, string> = {
  rico_xp: "Rico / XP",
  btg: "BTG Pactual",
  inter: "Inter",
  nubank: "Nubank / Nu Invest",
  bradesco: "Bradesco",
  itau: "Itaú",
  bb: "Banco do Brasil",
  desconhecida: "Não detectada",
};

export function OFXUploadModal({ clienteId, onClose, onSuccess }: OFXUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (f: File) => {
    setError(null);
    setResult(null);

    if (!f.name.toLowerCase().match(/\.(ofx|qfx)$/)) {
      setError("Apenas arquivos .ofx ou .qfx são aceitos");
      return;
    }
    if (f.size > MAX_SIZE) {
      setError(
        `Arquivo muito grande (${(f.size / 1024 / 1024).toFixed(1)}MB). Limite: 5MB.`
      );
      return;
    }

    try {
      const text = await f.text();
      if (
        !text.includes("OFX") &&
        !text.includes("<STMTTRN>") &&
        !text.includes("<INVTRAN>")
      ) {
        setError(
          "Arquivo não parece ser um OFX válido. Verifique se exportou no formato correto da sua corretora."
        );
        return;
      }
      setFile(f);
      setContent(text);
    } catch (e) {
      setError(`Erro ao ler arquivo: ${(e as Error).message}`);
    }
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  const handleSubmit = async () => {
    if (!file || !content) return;
    setUploading(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sessão expirada");

      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ofx-upload`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            client_id: clienteId,
            filename: file.name,
            ofx_content: content,
          }),
        }
      );

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);

      setResult(data as UploadResult);
    } catch (e) {
      setError(`Erro no upload: ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  };

  const handleConcluir = () => {
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-2 md:p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl shadow-2xl">
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
        >
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5" style={{ color: "#C8941A" }} />
            <h2 className="text-lg font-semibold" style={{ color: "#3D2314" }}>
              Upload OFX
            </h2>
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-70"
            style={{ color: "rgba(61, 35, 20, 0.5)" }}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!result && !file && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition"
              style={{
                borderColor: dragActive ? "#C8941A" : "rgba(61, 35, 20, 0.2)",
                backgroundColor: dragActive
                  ? "rgba(200, 148, 26, 0.05)"
                  : "#FAF7F2",
              }}
            >
              <Upload
                className="h-10 w-10 mx-auto mb-3"
                style={{ color: "#C8941A" }}
              />
              <p className="font-medium" style={{ color: "#3D2314" }}>
                Arraste o arquivo OFX aqui ou clique para selecionar
              </p>
              <p
                className="text-sm mt-2"
                style={{ color: "rgba(61, 35, 20, 0.6)" }}
              >
                Formatos: .ofx, .qfx · Máximo 5MB
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "rgba(61, 35, 20, 0.5)" }}
              >
                Suporta: Rico/XP, BTG, Inter, Nubank, Bradesco, Itaú, BB
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".ofx,.qfx"
                onChange={handleSelect}
                className="hidden"
              />
            </div>
          )}

          {file && !result && (
            <div className="space-y-3">
              <div
                className="rounded-lg border p-4"
                style={{
                  borderColor: "rgba(61, 35, 20, 0.1)",
                  backgroundColor: "#FAF7F2",
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8" style={{ color: "#C8941A" }} />
                    <div>
                      <p className="font-medium" style={{ color: "#3D2314" }}>
                        {file.name}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "rgba(61, 35, 20, 0.6)" }}
                      >
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null);
                      setContent(null);
                      setError(null);
                    }}
                    className="text-xs underline hover:opacity-80"
                    style={{ color: "rgba(61, 35, 20, 0.6)" }}
                  >
                    Trocar arquivo
                  </button>
                </div>
              </div>

              <div
                className="rounded-md border p-3 text-sm"
                style={{
                  backgroundColor: "#EFF6FF",
                  borderColor: "#BFDBFE",
                  color: "#1E3A8A",
                }}
              >
                <p>
                  Ao enviar, o arquivo será processado para extrair transações
                  e movimentações. Os dados ficam disponíveis para análise da
                  carteira.
                </p>
              </div>
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div
                className="rounded-lg border p-4"
                style={{
                  borderColor: "#A7F3D0",
                  backgroundColor: "#ECFDF5",
                }}
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    className="h-5 w-5 flex-shrink-0 mt-0.5"
                    style={{ color: "#059669" }}
                  />
                  <div className="space-y-1 flex-1">
                    <p className="font-medium" style={{ color: "#064E3B" }}>
                      Upload realizado com sucesso
                    </p>
                    <p className="text-sm" style={{ color: "#065F46" }}>
                      {result.message}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Stat label="Corretora" value={corretoraLabels[result.corretora_detectada] || result.corretora_detectada} />
                <Stat label="Transações" value={result.total_transactions.toString()} />
                {result.periodo_inicio && (
                  <div
                    className="rounded-md border p-3 col-span-2"
                    style={{
                      backgroundColor: "#FAF7F2",
                      borderColor: "rgba(61, 35, 20, 0.1)",
                    }}
                  >
                    <p
                      className="text-xs"
                      style={{ color: "rgba(61, 35, 20, 0.6)" }}
                    >
                      Período
                    </p>
                    <p
                      className="text-sm font-medium"
                      style={{ color: "#3D2314" }}
                    >
                      {new Date(result.periodo_inicio).toLocaleDateString("pt-BR")}{" "}
                      →{" "}
                      {result.periodo_fim
                        ? new Date(result.periodo_fim).toLocaleDateString("pt-BR")
                        : "—"}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div
              className="rounded-md border p-3 flex items-start gap-2 text-sm"
              style={{
                backgroundColor: "#FEF2F2",
                borderColor: "#FECACA",
                color: "#B91C1C",
              }}
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div
          className="px-6 py-4 border-t flex justify-end gap-2"
          style={{ borderColor: "rgba(61, 35, 20, 0.1)" }}
        >
          {!result ? (
            <>
              <button
                onClick={onClose}
                disabled={uploading}
                className="px-4 py-2 text-sm rounded-md border hover:opacity-80 disabled:opacity-50"
                style={{
                  borderColor: "rgba(61, 35, 20, 0.2)",
                  color: "#3D2314",
                }}
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!file || uploading}
                className="px-4 py-2 text-sm rounded-md hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: "#3D2314", color: "#FAF7F2" }}
              >
                {uploading ? "Enviando..." : "Enviar arquivo"}
              </button>
            </>
          ) : (
            <button
              onClick={handleConcluir}
              className="px-4 py-2 text-sm rounded-md hover:opacity-90"
              style={{ backgroundColor: "#3D2314", color: "#FAF7F2" }}
            >
              Concluir
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md border p-3"
      style={{
        backgroundColor: "#FAF7F2",
        borderColor: "rgba(61, 35, 20, 0.1)",
      }}
    >
      <p className="text-xs" style={{ color: "rgba(61, 35, 20, 0.6)" }}>
        {label}
      </p>
      <p className="text-sm font-medium" style={{ color: "#3D2314" }}>
        {value}
      </p>
    </div>
  );
}
