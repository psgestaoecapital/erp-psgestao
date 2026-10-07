"use client";
// Editor do briefing (P&M · Bloco 1, CEO 02/10): negrito, itálico, listas e links — como o do SIGA, mas guardando
// TEXTO com marcação leve (markdown), nunca HTML (sem risco de script na tela de ninguém). Usado no Briefing e no Job.
// "Ver formatado" desenha o texto com BriefingTexto (elementos React, link só http(s)).

import { useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, Link2 } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { linkSeguro } from "@/lib/pm/briefing";
import { BriefingTexto } from "@/components/pm/BriefingTexto";
export { briefingParaJob } from "@/lib/pm/briefing";

export function BriefingEditor({ value, onChange, rotulo = "Briefing", ajuda, placeholder, linhas = 9, testid = "briefing-editor" }: {
  value: string; onChange: (v: string) => void; rotulo?: string; ajuda: string; placeholder?: string; linhas?: number; testid?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // "Ver formatado" (CEO 07/10 · Marciana): mostra como o texto vai aparecer — negrito, listas e links já desenhados
  const [ver, setVer] = useState(false);
  function aplicar(fn: (sel: string) => string, padrao: string) {
    const el = ref.current; if (!el) return;
    const ini = el.selectionStart ?? value.length; const fim = el.selectionEnd ?? value.length;
    const sel = value.slice(ini, fim) || padrao;
    const novo = fn(sel);
    onChange(value.slice(0, ini) + novo + value.slice(fim));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini, ini + novo.length); });
  }
  function prefixar(prefixo: (i: number) => string) {
    const el = ref.current; if (!el) return;
    const ini = el.selectionStart ?? value.length; const fim = el.selectionEnd ?? value.length;
    const a = value.lastIndexOf("\n", ini - 1) + 1;
    const linhasSel = value.slice(a, fim).split("\n");
    const novo = linhasSel.map((l, i) => prefixo(i) + l).join("\n");
    onChange(value.slice(0, a) + novo + value.slice(fim));
    requestAnimationFrame(() => el.focus());
  }
  function link() {
    const url = window.prompt("Endereço do link (https://…):")?.trim();
    if (!url) return;
    aplicar((t) => `[${t}](${linkSeguro(url)})`, "texto do link");
  }
  const b = "inline-flex h-8 w-8 items-center justify-center rounded-md text-[#3D2314]/75 hover:bg-[#3D2314]/8";
  return (
    <label className="block" data-testid={testid}>
      <span className="mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]">{rotulo}<AjudaCampo chave={ajuda} /></span>
      <div className="overflow-hidden rounded-xl border border-[#3D2314]/15 bg-white focus-within:border-[#C8941A]">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-[#3D2314]/10 bg-[#FAF7F2] px-1.5 py-1">
          <button type="button" className={b} onClick={() => aplicar((t) => `**${t}**`, "texto")} title="Negrito" aria-label="negrito"><Bold size={15} /></button>
          <button type="button" className={b} onClick={() => aplicar((t) => `_${t}_`, "texto")} title="Itálico" aria-label="itálico"><Italic size={15} /></button>
          <button type="button" className={b} onClick={() => prefixar(() => "- ")} title="Lista" aria-label="lista"><List size={15} /></button>
          <button type="button" className={b} onClick={() => prefixar((i) => `${i + 1}. `)} title="Lista numerada" aria-label="lista numerada"><ListOrdered size={15} /></button>
          <button type="button" className={b} onClick={link} title="Link" aria-label="link" data-testid={`${testid}-link`}><Link2 size={15} /></button>
          <button type="button" onClick={() => setVer(!ver)} aria-pressed={ver} data-testid={`${testid}-ver`}
            className="ml-auto rounded-md px-2 py-1 text-[12px] font-medium text-[#3D2314]/75 hover:bg-[#3D2314]/8">{ver ? "Escrever" : "Ver formatado"}</button>
        </div>
        {ver ? <div className="min-h-[120px] px-3 py-2.5"><BriefingTexto texto={value} vazio="Nada escrito ainda." testid={`${testid}-formatado`} /></div> : <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} rows={linhas}
          placeholder={placeholder ?? "Contexto · mensagem principal · entregáveis e formatos · prazos · o que evitar"}
          className="block w-full resize-y border-0 px-3 py-2.5 text-[13.5px] leading-relaxed text-[#3D2314] focus:outline-none" data-testid={`${testid}-texto`} />}
      </div>
    </label>
  );
}
