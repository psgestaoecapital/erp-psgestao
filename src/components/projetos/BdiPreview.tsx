// src/components/projetos/BdiPreview.tsx
// Preview em tempo real do BDI total + formula + impacto nos servicos + status margens

"use client";

import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";

export interface BdiComponentes {
  ac: number; // administracao central
  sg: number; // seguros
  ri: number; // riscos
  ga: number; // garantias
  df: number; // despesas financeiras
  lu: number; // lucro
  im: number; // impostos
}

export interface ImpactoServico {
  servico_id?: string;
  nome: string;
  custo: number | null;
  preco_venda: number | null;
  margem_aparente_pct?: number | null;
}

interface Props {
  componentes: BdiComponentes;
  bdiTotalPct: number; // valor autoritativo do backend (apos refetch)
  impactos: ImpactoServico[];
  margemAlvoPct: number | null;
  margemMinimaPct: number | null;
}

function fmtBRL(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtPct(v: number | null | undefined, casas = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(casas)}%`;
}

// Formula AEC TCU/SINAPI: BDI = ((1+AC+SG+RI+GA)*(1+DF)*(1+LU))/(1-IM) - 1
export function calcularBdiAec(c: BdiComponentes): number {
  const ac = c.ac / 100;
  const sg = c.sg / 100;
  const ri = c.ri / 100;
  const ga = c.ga / 100;
  const df = c.df / 100;
  const lu = c.lu / 100;
  const im = c.im / 100;
  const den = 1 - im;
  if (den <= 0) return 0;
  const bdi = ((1 + ac + sg + ri + ga) * (1 + df) * (1 + lu)) / den - 1;
  return bdi * 100;
}

function statusMargem(
  m: number | null | undefined,
  alvo: number | null,
  minimo: number | null
): "ok" | "alerta" | "critico" | "indef" {
  if (m === null || m === undefined || !Number.isFinite(m)) return "indef";
  if (alvo != null && m >= alvo) return "ok";
  if (minimo != null && m < minimo) return "critico";
  return "alerta";
}

export function BdiPreview({
  componentes,
  bdiTotalPct,
  impactos,
  margemAlvoPct,
  margemMinimaPct,
}: Props) {
  const bdiCalc = calcularBdiAec(componentes);
  // Em geral o backend recalcula igual ao calculo client-side. Se divergir,
  // mostra o numero do backend mas com indicador discreto.
  const divergencia = Math.abs(bdiCalc - bdiTotalPct) > 0.05;

  const formula = `((1+${componentes.ac.toFixed(2)}%+${componentes.sg.toFixed(
    2
  )}%+${componentes.ri.toFixed(2)}%+${componentes.ga.toFixed(2)}%)*(1+${componentes.df.toFixed(
    2
  )}%)*(1+${componentes.lu.toFixed(2)}%))/(1-${componentes.im.toFixed(2)}%)-1`;

  // Resumo de status por margem
  const totais = impactos.reduce(
    (acc, s) => {
      const st = statusMargem(s.margem_aparente_pct, margemAlvoPct, margemMinimaPct);
      if (st === "ok") acc.ok++;
      else if (st === "alerta") acc.alerta++;
      else if (st === "critico") acc.critico++;
      else acc.indef++;
      return acc;
    },
    { ok: 0, alerta: 0, critico: 0, indef: 0 }
  );

  return (
    <div className="space-y-4">
      {/* BDI Total */}
      <div className="rounded-2xl border border-[#C8941A]/30 bg-gradient-to-br from-white to-[#C8941A]/5 p-5 shadow-sm">
        <p
          className="text-xs uppercase tracking-wider text-[#3D2314]/60"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
        >
          BDI Total
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className="text-5xl font-medium text-[#C8941A]"
            style={{
              fontFamily: "var(--ps-font-body)",
              fontStyle: "normal",
              letterSpacing: "-0.02em",
            }}
          >
            {fmtPct(bdiCalc, 2)}
          </span>
          {divergencia && (
            <span
              className="text-xs text-[#3D2314]/50"
              title={`Backend reporta ${fmtPct(bdiTotalPct, 2)}`}
            >
              · backend: {fmtPct(bdiTotalPct, 2)}
            </span>
          )}
        </div>
        <p className="mt-3 break-all rounded-lg bg-[#3D2314]/5 px-3 py-2 font-mono text-[10px] text-[#3D2314]/60">
          {formula}
        </p>
        <p className="mt-2 text-[11px] text-[#3D2314]/50">
          Fórmula AEC (TCU/SINAPI). O backend recalcula o BDI total
          automaticamente após cada alteração.
        </p>
      </div>

      {/* Impacto nos servicos */}
      <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <h3
          className="mb-3 text-sm font-medium uppercase tracking-wider text-[#3D2314]/60"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
        >
          Impacto nos serviços
        </h3>
        {impactos.length === 0 ? (
          <p className="text-xs text-[#3D2314]/50">
            Nenhum serviço cadastrado. Adicione serviços ao catálogo para ver o
            impacto.
          </p>
        ) : (
          <ul className="divide-y divide-[#3D2314]/8">
            {impactos.slice(0, 5).map((s, idx) => {
              const st = statusMargem(
                s.margem_aparente_pct,
                margemAlvoPct,
                margemMinimaPct
              );
              const cor =
                st === "ok"
                  ? "text-emerald-700"
                  : st === "alerta"
                    ? "text-yellow-700"
                    : st === "critico"
                      ? "text-red-700"
                      : "text-[#3D2314]/40";
              return (
                <li
                  key={s.servico_id || `${s.nome}-${idx}`}
                  className="py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-[#3D2314]">
                      {s.nome}
                    </span>
                    <span className={`shrink-0 font-mono text-xs ${cor}`}>
                      {fmtPct(s.margem_aparente_pct, 1)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-[#3D2314]/60">
                    <span className="font-mono">{fmtBRL(s.custo)}</span>
                    <span className="text-[#3D2314]/30">→</span>
                    <span className="font-mono font-medium text-[#3D2314]">
                      {fmtBRL(s.preco_venda)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Status margens */}
      <div className="rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
        <h3
          className="mb-3 text-sm font-medium uppercase tracking-wider text-[#3D2314]/60"
          style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
        >
          Status de margem
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <StatusChip
            icon={CheckCircle2}
            cor="emerald"
            label="OK"
            qtd={totais.ok}
          />
          <StatusChip
            icon={AlertTriangle}
            cor="yellow"
            label="Abaixo da meta"
            qtd={totais.alerta}
          />
          <StatusChip
            icon={AlertOctagon}
            cor="red"
            label="Abaixo do mínimo"
            qtd={totais.critico}
          />
        </div>
        {totais.indef > 0 && (
          <p className="mt-2 text-[11px] text-[#3D2314]/50">
            {totais.indef} serviço{totais.indef !== 1 ? "s" : ""} sem margem
            calculada (BOM incompleto).
          </p>
        )}
      </div>
    </div>
  );
}

function StatusChip({
  icon: Icon,
  cor,
  label,
  qtd,
}: {
  icon: typeof CheckCircle2;
  cor: "emerald" | "yellow" | "red";
  label: string;
  qtd: number;
}) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    red: "bg-red-50 text-red-700 border-red-200",
  };
  return (
    <div
      className={`rounded-xl border px-3 py-2 text-center ${map[cor]}`}
    >
      <Icon size={16} className="mx-auto" />
      <div className="mt-1 text-2xl font-medium">{qtd}</div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">
        {label}
      </div>
    </div>
  );
}
