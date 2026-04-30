// src/components/projetos/CatalogoForm.tsx
// Drawer lateral genérico para criar/editar itens de catálogo

"use client";

import { ReactNode, useEffect, useState } from "react";
import { X } from "lucide-react";

export type FieldType = "text" | "textarea" | "number" | "select" | "radio";

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  step?: string;
  min?: number;
  max?: number;
  fullWidth?: boolean;
}

interface Props<T extends Record<string, any>> {
  open: boolean;
  titulo: string;
  subtitulo?: string;
  fields: FormField[];
  initial: T;
  onClose: () => void;
  onSubmit: (values: T) => Promise<void> | void;
  salvando?: boolean;
  erro?: string | null;
  extraContent?: ReactNode;
}

export function CatalogoForm<T extends Record<string, any>>({
  open,
  titulo,
  subtitulo,
  fields,
  initial,
  onClose,
  onSubmit,
  salvando,
  erro,
  extraContent,
}: Props<T>) {
  const [values, setValues] = useState<T>(initial);
  const [erroLocal, setErroLocal] = useState<string | null>(null);

  useEffect(() => {
    setValues(initial);
    setErroLocal(null);
  }, [initial, open]);

  if (!open) return null;

  function set<K extends keyof T>(k: K, v: T[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function validar(): string | null {
    for (const f of fields) {
      if (f.required) {
        const v = values[f.key as keyof T];
        const isEmpty =
          v === null ||
          v === undefined ||
          (typeof v === "string" && v.trim() === "") ||
          (typeof v === "number" && isNaN(v));
        if (isEmpty) {
          return `Campo "${f.label}" é obrigatório`;
        }
      }
    }
    return null;
  }

  async function handleSubmit() {
    const erroV = validar();
    if (erroV) {
      setErroLocal(erroV);
      return;
    }
    setErroLocal(null);
    await onSubmit(values);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#3D2314]/60"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#3D2314]/8 p-5">
          <div>
            <h2
              className="text-lg font-semibold text-[#3D2314]"
              style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
            >
              {titulo}
            </h2>
            {subtitulo && (
              <p className="mt-1 text-xs text-[#3D2314]/60">{subtitulo}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[#3D2314]/60 hover:text-[#3D2314]"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content scrollable */}
        <div className="flex-1 overflow-y-auto p-5">
          {(erro || erroLocal) && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              {erro || erroLocal}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className={f.fullWidth ? "md:col-span-2" : ""}>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#3D2314]/60">
                  {f.label}
                  {f.required && <span className="text-red-600"> *</span>}
                </label>

                {f.type === "text" && (
                  <input
                    type="text"
                    value={values[f.key] ?? ""}
                    onChange={(e) => set(f.key as keyof T, e.target.value as any)}
                    placeholder={f.placeholder}
                    className={inputCls}
                  />
                )}

                {f.type === "number" && (
                  <input
                    type="number"
                    value={values[f.key] ?? ""}
                    onChange={(e) =>
                      set(
                        f.key as keyof T,
                        (e.target.value === "" ? null : parseFloat(e.target.value)) as any
                      )
                    }
                    placeholder={f.placeholder}
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    className={inputCls}
                  />
                )}

                {f.type === "textarea" && (
                  <textarea
                    value={values[f.key] ?? ""}
                    onChange={(e) => set(f.key as keyof T, e.target.value as any)}
                    placeholder={f.placeholder}
                    rows={3}
                    className={inputCls}
                  />
                )}

                {f.type === "select" && (
                  <select
                    value={values[f.key] ?? ""}
                    onChange={(e) => set(f.key as keyof T, e.target.value as any)}
                    className={inputCls}
                  >
                    <option value="">— selecione —</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}

                {f.type === "radio" && f.options && (
                  <div className="flex flex-wrap gap-2">
                    {f.options.map((o) => (
                      <label
                        key={o.value}
                        className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition ${
                          values[f.key] === o.value
                            ? "border-[#C8941A] bg-[#C8941A]/10 text-[#3D2314]"
                            : "border-[#3D2314]/12 bg-white text-[#3D2314]/70 hover:bg-[#3D2314]/5"
                        }`}
                      >
                        <input
                          type="radio"
                          name={f.key}
                          value={o.value}
                          checked={values[f.key] === o.value}
                          onChange={(e) => set(f.key as keyof T, e.target.value as any)}
                          className="hidden"
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                )}

                {f.hint && (
                  <p className="mt-1 text-xs text-[#3D2314]/50">{f.hint}</p>
                )}
              </div>
            ))}
          </div>

          {extraContent}
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-[#3D2314]/8 p-5">
          <button
            onClick={onClose}
            disabled={salvando}
            className="flex-1 rounded-lg bg-[#FAF7F2] py-2.5 text-sm font-medium text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={salvando}
            className="flex-1 rounded-lg bg-[#3D2314] py-2.5 text-sm font-semibold text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[#3D2314]/12 bg-white px-3 py-2 text-sm focus:border-[#C8941A] focus:outline-none";
