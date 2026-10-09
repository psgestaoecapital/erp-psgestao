// Hub · Mão de obra · "Importar planilha" (CEO 07/10 · FC Pisos). Lê o modelo padrão, mostra a PRÉVIA linha a linha (ok/erro com o motivo),
// e só grava as linhas certas pelas RPCs que já existem (sem caminho paralelo). Só gestor/financeiro vê (o botão já vem filtrado pela tela).
"use client";

import { useState } from "react";
import { X, Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { supabase } from "@/lib/supabase";
import { fichaDaLinha, lerEncargos, norm, validarFuncionarios, type EncargosLidos, type LinhaFunc } from "@/lib/hub/importarMaoObra";

type FuncaoRef = { id: string; nome: string; ativo: boolean };
type EquipeRef = { id: string; funcionario_id: string | null; tipo: string; ativo: boolean };
type Resultado = { linha: number; nome: string; ok: boolean; msg: string };

const btnPri = "px-3 py-2 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center gap-1.5";
const btnSec = "px-3 py-2 rounded-md border border-[#3D2314]/15 text-[13px] text-[#3D2314] hover:bg-[#3D2314]/5 disabled:opacity-50 inline-flex items-center gap-1.5";

export default function ImportarMaoObraModal({ companyId, funcoes, equipe, onClose, onConcluido }: {
  companyId: string; funcoes: FuncaoRef[]; equipe: EquipeRef[]; onClose: () => void; onConcluido: () => Promise<void> | void;
}) {
  const [arquivo, setArquivo] = useState("");
  const [linhas, setLinhas] = useState<LinhaFunc[] | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [enc, setEnc] = useState<EncargosLidos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const [resultado, setResultado] = useState<Resultado[] | null>(null);

  async function escolher(f: File | undefined) {
    if (!f) return;
    setErro(null); setLinhas(null); setResultado(null); setArquivo(f.name);
    try {
      const { lerPlanilhaMaoObra } = await import("@/lib/hub/planilhaMaoObra");
      const p = await lerPlanilhaMaoObra(await f.arrayBuffer());
      if (p.faltaAba) { setErro(`Não achei a aba "${p.faltaAba}" — use o modelo do botão "Baixar modelo".`); return; }
      const v = validarFuncionarios(p.funcionarios);
      const e = lerEncargos(p.encargos);
      setLinhas(v.linhas); setEnc(e); setAvisos([...v.avisos, ...e.avisos]);
      if (!v.linhas.length) setErro("A aba 2_Funcionarios não tem nenhuma linha preenchida.");
    } catch { setErro("Não consegui ler o arquivo. Envie o modelo .xlsx preenchido."); }
  }

  async function chamar(fn: string, args: Record<string, unknown>) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) throw new Error(error.message);
    const r = data as { ok?: boolean; erro?: string; id?: string; funcionario_id?: string } | null;
    if (r && r.ok === false) throw new Error(r.erro ?? "Não foi possível salvar.");
    return r;
  }

  async function importar() {
    if (!linhas) return;
    const certas = linhas.filter((l) => l.ok);
    setGravando(true); setErro(null);
    const out: Resultado[] = linhas.filter((l) => !l.ok).map((l) => ({ linha: l.linha, nome: l.nome, ok: false, msg: l.erros.join(" ") }));
    let encGravado = false;
    try {
      if (enc?.dados) { await chamar("fn_mao_obra_encargos_salvar", { p_company_id: companyId, p_dados: enc.dados, p_confirmar: false }); encGravado = true; }
    } catch (e) { setErro(`Encargos não gravados: ${(e as Error).message}. As pessoas não foram importadas.`); setGravando(false); return; }

    // funções: usa a que já existe (mesmo nome) ou cria — nunca duplica
    const mapa = new Map<string, string>(funcoes.filter((f) => f.ativo).map((f) => [norm(f.nome), f.id]));
    // pessoa que já existe (mesmo CPF) → nova vigência; nunca duplica
    const { data: existentes } = await supabase.from("compliance_funcionarios").select("id, cpf").eq("company_id", companyId).eq("ativo", true);
    const porCpf = new Map<string, string>(((existentes as { id: string; cpf: string | null }[] | null) ?? []).map((x) => [(x.cpf ?? "").replace(/\D/g, ""), x.id]));
    for (const l of certas) {
      try {
        let fid = mapa.get(norm(l.funcao));
        if (!fid) {
          const forma = l.forma === "m2" ? "producao" : l.forma;
          const r = await chamar("fn_mao_obra_funcao_salvar", { p_company_id: companyId, p_id: null, p_dados: { nome: l.funcao, cbo: l.cbo, forma_pagamento: forma, unidade_producao: forma === "producao" ? "m2" : "", custo_hora_manual: "", ativo: true } });
          fid = r?.id; if (!fid) throw new Error("Não consegui criar a função.");
          mapa.set(norm(l.funcao), fid);
        }
        const funcId = porCpf.get(l.cpf) ?? null;
        const { ficha, pessoa } = fichaDaLinha(l, fid, funcId);
        const atual = funcId ? equipe.find((q) => q.funcionario_id === funcId && q.tipo === "pessoa" && q.ativo) : undefined;
        if (atual) await chamar("fn_mao_obra_ficha_reajustar", { p_ficha_id: atual.id, p_dados: ficha, p_vigencia: l.vigencia, p_motivo: "importação de planilha" });
        else await chamar("fn_mao_obra_ficha_salvar", { p_company_id: companyId, p_ficha: ficha, p_pessoa: pessoa });
        out.push({ linha: l.linha, nome: l.nome, ok: true, msg: atual ? "nova vigência gravada (pessoa já existia)" : funcId ? "ficha criada para pessoa já cadastrada" : "pessoa e ficha gravadas — falta conferir" });
      } catch (e) { out.push({ linha: l.linha, nome: l.nome, ok: false, msg: (e as Error).message }); }
    }
    out.sort((a, b) => a.linha - b.linha);
    try {
      await chamar("fn_mao_obra_importacao_registrar", { p_company_id: companyId, p_resumo: { arquivo, lidas: linhas.length, gravadas: out.filter((o) => o.ok).length, recusadas: out.filter((o) => !o.ok).length, encargos: encGravado } });
    } catch { /* o registro é trilha; a gravação já foi feita */ }
    setResultado(out); setGravando(false);
    await onConcluido();
  }

  const nOk = linhas?.filter((l) => l.ok).length ?? 0;
  const nErro = (linhas?.length ?? 0) - nOk;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-3" data-testid="mao-obra-importar-modal">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl my-6 p-4 space-y-3 text-[#3D2314]">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Importar planilha de mão de obra</h2>
          <button onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {!resultado && (
          <div className="flex items-center gap-1">
            <label className={`${btnSec} cursor-pointer`}>
              <Upload size={14} /> {arquivo || "Escolher arquivo .xlsx"}
              <input type="file" accept=".xlsx" className="hidden" data-testid="mao-obra-importar-arquivo" onChange={(e) => void escolher(e.target.files?.[0])} />
              <AjudaCampo chave="projetos.mao_obra.importar.arquivo" />
            </label>
          </div>
        )}
        {erro && <div className="rounded-md bg-[#F7E1E1] text-[#791F1F] px-3 py-2 text-[12.5px]" data-testid="mao-obra-importar-erro">{erro}</div>}
        {avisos.length > 0 && <ul className="rounded-md bg-[#FAEEDA]/60 border border-[#C8941A]/40 px-3 py-2 text-[12px] list-disc pl-6">{avisos.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        {enc && enc.erros.length > 0 && <div className="rounded-md bg-[#F7E1E1] text-[#791F1F] px-3 py-2 text-[12.5px]">Encargos da empresa: {enc.erros.join(" ")} (corrija a aba 1_Encargos_empresa; enquanto isso as pessoas ficam sem importar os encargos).</div>}
        {linhas && !resultado && (
          <>
            <p className="text-[12.5px]" data-testid="mao-obra-importar-resumo"><b>{nOk}</b> linha(s) certa(s) · <b>{nErro}</b> com erro (não serão gravadas) · {enc?.dados ? "encargos da empresa serão atualizados (provisórios)" : "encargos da empresa não mudam"}.</p>
            <div className="overflow-x-auto max-h-[45vh] overflow-y-auto">
              <table className="w-full text-[12px]" data-testid="mao-obra-importar-previa">
                <thead><tr className="text-left text-[#3D2314]/60 border-b border-[#3D2314]/10"><th className="py-1 pr-2">Linha</th><th className="pr-2">Nome</th><th className="pr-2">Função</th><th className="pr-2">Situação</th></tr></thead>
                <tbody>{linhas.map((l) => (
                  <tr key={l.linha} className="border-b border-[#3D2314]/5 align-top" data-testid={l.ok ? "previa-ok" : "previa-erro"}>
                    <td className="py-1 pr-2">{l.linha}</td><td className="pr-2">{l.nome || "—"}</td><td className="pr-2">{l.funcao || "—"}</td>
                    <td>{l.ok ? <span className="text-[#2F5A1F] inline-flex items-center gap-1"><CheckCircle2 size={12} /> ok{l.avisos.length ? ` · ${l.avisos.join(" ")}` : ""}</span>
                      : <span className="text-[#791F1F]"><AlertTriangle size={12} className="inline -mt-0.5 mr-1" />{l.erros.join(" ")}</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button className={btnSec} onClick={onClose}>Cancelar</button>
              <button className={btnPri} disabled={gravando || nOk === 0 || (enc?.erros.length ?? 0) > 0} onClick={() => void importar()} data-testid="mao-obra-importar-confirmar">
                {gravando ? "Gravando…" : `Importar ${nOk} linha(s) certa(s)`}
              </button>
            </div>
          </>
        )}
        {resultado && (
          <>
            <p className="text-[13px]" data-testid="mao-obra-importar-final"><b>{resultado.filter((r) => r.ok).length}</b> gravada(s) · <b>{resultado.filter((r) => !r.ok).length}</b> recusada(s). As fichas entraram como <b>não conferidas</b>: confira na aba Equipe para entrarem no custo da função.</p>
            <ul className="text-[12px] max-h-[40vh] overflow-y-auto space-y-0.5">{resultado.map((r) => <li key={r.linha} className={r.ok ? "text-[#2F5A1F]" : "text-[#791F1F]"}>Linha {r.linha} · {r.nome || "—"}: {r.msg}</li>)}</ul>
            <div className="flex justify-end"><button className={btnPri} onClick={onClose}>Fechar</button></div>
          </>
        )}
      </div>
    </div>
  );
}
