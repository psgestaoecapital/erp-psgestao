"use client";
// Mostra o briefing FORMATADO (negrito, itálico, listas, links) a partir da marcação leve — elementos React, nunca HTML cru.
import type { ReactNode } from "react";
import { blocos, type Trecho } from "@/lib/pm/markdownLeve";

function desenhar(ts: Trecho[], k = ""): ReactNode[] {
  return ts.map((t, i) => {
    const key = `${k}${i}`;
    if (t.t === "negrito") return <strong key={key}>{desenhar(t.v, `${key}.`)}</strong>;
    if (t.t === "italico") return <em key={key}>{desenhar(t.v, `${key}.`)}</em>;
    if (t.t === "link") return <a key={key} href={t.href} target="_blank" rel="noopener noreferrer nofollow" className="text-[#8A6212] underline">{t.v}</a>;
    return <span key={key}>{t.v}</span>;
  });
}

export function BriefingTexto({ texto, vazio = "Sem texto de briefing.", testid = "briefing-formatado" }: { texto: string | null | undefined; vazio?: string; testid?: string }) {
  const bs = blocos(texto);
  if (!bs.length) return <p className="text-[13px] italic text-[#3D2314]/50" data-testid={testid}>{vazio}</p>;
  return (
    <div className="space-y-2 text-[13.5px] leading-relaxed text-[#3D2314]" data-testid={testid}>
      {bs.map((b, i) => b.t === "lista"
        ? (b.numerada
          ? <ol key={i} className="list-decimal space-y-0.5 pl-5">{b.itens.map((it, j) => <li key={j}>{desenhar(it)}</li>)}</ol>
          : <ul key={i} className="list-disc space-y-0.5 pl-5">{b.itens.map((it, j) => <li key={j}>{desenhar(it)}</li>)}</ul>)
        : <p key={i}>{b.linhas.map((l, j) => <span key={j}>{j > 0 && <br />}{desenhar(l)}</span>)}</p>)}
    </div>
  );
}
