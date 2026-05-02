// src/components/projetos/BdiSlider.tsx
// Slider + input numerico vinculado para um componente do BDI
// Cor por categoria (admin=cinza, lucro=dourado, impostos=marrom)

"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";

export type BdiSliderCor = "espresso" | "gold" | "brown" | "gray";

interface Props {
  label: string;
  hint: string;
  valor: number;
  onChange: (v: number) => void;
  cor?: BdiSliderCor;
  max?: number;
  step?: number;
  destaque?: boolean;
}

const CORES: Record<BdiSliderCor, { accent: string; chip: string }> = {
  espresso: { accent: "accent-[#3D2314]", chip: "bg-[#3D2314]/10 text-[#3D2314]" },
  gold: { accent: "accent-[#C8941A]", chip: "bg-[#C8941A]/15 text-[#C8941A]" },
  brown: { accent: "accent-[#3D2314]", chip: "bg-[#3D2314]/10 text-[#3D2314]" },
  gray: { accent: "accent-[#3D2314]/60", chip: "bg-[#3D2314]/8 text-[#3D2314]/70" },
};

export function BdiSlider({
  label,
  hint,
  valor,
  onChange,
  cor = "gray",
  max = 30,
  step = 0.1,
  destaque = false,
}: Props) {
  const [showHint, setShowHint] = useState(false);
  const c = CORES[cor];
  const safe = Number.isFinite(valor) ? valor : 0;
  const pctBar = Math.min(100, Math.max(0, (safe / max) * 100));

  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${
        destaque
          ? "border-[#C8941A]/40 bg-[#C8941A]/5"
          : "border-[#3D2314]/8 bg-white"
      }`}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <label className="text-sm font-medium text-[#3D2314]">{label}</label>
          <button
            type="button"
            onMouseEnter={() => setShowHint(true)}
            onMouseLeave={() => setShowHint(false)}
            onClick={() => setShowHint((v) => !v)}
            className="relative text-[#3D2314]/40 hover:text-[#3D2314]/70"
            aria-label="Ajuda"
          >
            <HelpCircle size={13} />
            {showHint && (
              <span className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-lg bg-[#3D2314] px-3 py-2 text-left text-[11px] font-normal text-[#FAF7F2] shadow-lg">
                {hint}
              </span>
            )}
          </button>
        </div>
        <div
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-mono font-medium ${c.chip}`}
        >
          {safe.toFixed(2)}%
        </div>
      </div>

      <div className="grid grid-cols-[1fr_88px] items-center gap-3">
        <div className="relative">
          <input
            type="range"
            min={0}
            max={max}
            step={step}
            value={safe}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className={`w-full ${c.accent}`}
            aria-label={label}
          />
          <div className="mt-0.5 flex justify-between text-[10px] text-[#3D2314]/40">
            <span>0%</span>
            <span>{max}%</span>
          </div>
          <div className="pointer-events-none mt-[-22px] h-1 w-full">
            <div
              className="h-1 rounded-full opacity-0"
              style={{ width: `${pctBar}%` }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            step={step}
            value={safe}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onChange(Number.isFinite(v) ? v : 0);
            }}
            className="w-full rounded-lg !border !border-[#3D2314]/12 !bg-white px-2 py-1.5 text-right font-mono text-sm !text-[#3D2314] placeholder:!text-[#3D2314]/40 focus:!border-[#C8941A] focus:outline-none"
          />
          <span className="text-xs text-[#3D2314]/50">%</span>
        </div>
      </div>
    </div>
  );
}
