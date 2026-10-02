"use client";
// Ajuda de campo (CEO 01/10, regra de TODO o Hub de Projetos): o "?" ao lado do rótulo abre um cartão curto com 4 blocos
// fixos — O que preencher · Para que serve no cálculo · Exemplo · Erro comum — e "ver mais" com o artigo da Central de
// Ajuda. Os textos vêm do banco (erp_ajuda_campo, editáveis sem deploy) numa chamada só por tela; cada abertura e cada
// "ver mais" ficam em erp_ajuda_uso. No celular o cartão sobe de baixo (bottom sheet); no computador abre junto do "?".
// O gate scripts/gates/check-ajuda-campo.ts reprova campo do Hub sem "?" e chave que não exista no banco.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";

type TextoCampo = { rotulo: string; o_que_preencher: string; para_que_serve: string; exemplo: string; erro_comum: string; artigo_id: string | null };
type Artigo = { titulo: string; resumo: string | null; corpo_md: string | null };
type Dados = { campos: Record<string, TextoCampo>; artigos: Record<string, Artigo> };

// uma busca por tela, compartilhada por todos os "?" dela
const cache = new Map<string, Promise<Dados>>();
function carregar(rota: string): Promise<Dados> {
  let p = cache.get(rota);
  if (!p) {
    p = Promise.resolve(supabase.rpc("fn_ajuda_campo_listar", { p_rota: rota })).then(({ data, error }) => {
      if (error || !data) { cache.delete(rota); return { campos: {}, artigos: {} }; }
      return data as Dados;
    });
    cache.set(rota, p);
  }
  return p;
}

export function AjudaCampo({ chave, rota }: { chave: string; rota?: string }) {
  const pathname = usePathname();
  const tela = rota ?? pathname ?? "";
  const { sel } = useCompanyIds();
  const empresa = sel && !sel.startsWith("group_") && sel !== "consolidado" ? sel : null;
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<Dados | null>(null);
  const [verMais, setVerMais] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [celular, setCelular] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const cartao = useRef<HTMLDivElement>(null);

  const registrar = useCallback((acao: "abriu" | "ver_mais") => {
    void supabase.rpc("fn_ajuda_campo_uso", { p_chave: chave, p_company_id: empresa, p_rota: tela, p_acao: acao });
  }, [chave, empresa, tela]);

  function abrir(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();   // dentro de <label>: não marca/foca o campo
    if (aberto) { setAberto(false); return; }
    setVerMais(false);
    setAberto(true);
    void carregar(tela).then(setDados);
    registrar("abriu");
  }

  // posição: junto do "?" no computador; bottom sheet no celular
  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    const larg = Math.min(340, window.innerWidth - 24);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- posição medida no DOM ao abrir
    setCelular(window.innerWidth < 640);
    setPos({ top: Math.min(r.bottom + 6, window.innerHeight - 40), left: Math.max(12, Math.min(r.left - 8, window.innerWidth - larg - 12)) });
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!cartao.current?.contains(e.target as Node) && !botao.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    const rolar = () => { if (window.innerWidth >= 640) setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", rolar, true);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", rolar, true); };
  }, [aberto]);

  const t = dados?.campos[chave];
  const artigo = t?.artigo_id ? dados?.artigos[t.artigo_id] : undefined;

  const corpo = (
    <div ref={cartao} role="dialog" aria-label={t ? `Ajuda: ${t.rotulo}` : "Ajuda do campo"} data-testid={`ajuda-cartao-${chave}`}
      onClick={(e) => e.stopPropagation()}
      className={celular
        ? "fixed inset-x-0 bottom-0 z-[130] max-h-[75vh] overflow-y-auto rounded-t-2xl bg-white px-4 pb-6 pt-3 shadow-2xl text-[#3D2314]"
        : "fixed z-[130] w-[340px] max-w-[calc(100vw-24px)] max-h-[70vh] overflow-y-auto rounded-xl border border-[#3D2314]/15 bg-white p-3 shadow-xl text-[#3D2314]"}
      style={celular ? undefined : { top: pos?.top ?? 0, left: pos?.left ?? 0 }}>
      {celular && <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[#3D2314]/20" />}
      {!dados && <p className="text-[12.5px] text-[#3D2314]/60">Carregando…</p>}
      {dados && !t && <p className="text-[12.5px] text-[#3D2314]/60">A ajuda deste campo ainda não foi escrita.</p>}
      {t && (
        <div className="space-y-2 text-[12.5px] leading-snug">
          <p className="text-[13.5px] font-medium">{t.rotulo}</p>
          {([["O que preencher", t.o_que_preencher], ["Para que serve no cálculo", t.para_que_serve], ["Exemplo", t.exemplo], ["Erro comum", t.erro_comum]] as const).map(([titulo, texto]) => (
            <div key={titulo}>
              <p className={`text-[10.5px] uppercase tracking-wide ${titulo === "Erro comum" ? "text-[#791F1F]" : "text-[#8A5A00]"}`}>{titulo}</p>
              <p>{texto}</p>
            </div>
          ))}
          {artigo && !verMais && (
            <button type="button" className="text-[12px] underline text-[#3D2314]" data-testid="ajuda-ver-mais" onClick={() => { setVerMais(true); registrar("ver_mais"); }}>
              Ver mais na Central de Ajuda
            </button>
          )}
          {artigo && verMais && (
            <div className="rounded-md bg-[#FAF7F2] p-2" data-testid="ajuda-artigo">
              <p className="font-medium">{artigo.titulo}</p>
              <p className="whitespace-pre-wrap text-[12px] text-[#3D2314]/80">{artigo.corpo_md || artigo.resumo || ""}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      <button ref={botao} type="button" onClick={abrir} aria-label="Ajuda deste campo" aria-expanded={aberto} data-testid={`ajuda-${chave}`}
        className="ml-1 inline-flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full border border-[#C8941A] align-middle text-[10px] font-semibold leading-none text-[#8A5A00] hover:bg-[#FAEEDA]">
        ?
      </button>
      {aberto && typeof document !== "undefined" && createPortal(
        <>
          {celular && <div className="fixed inset-0 z-[125] bg-black/30" onClick={() => setAberto(false)} />}
          {corpo}
        </>, document.body)}
    </>
  );
}

export default AjudaCampo;
