"use client";

// HB0 item 6 · OS de OBRA: na ficha da OS, a empresa de obra diz de qual obra, etapa (tarefa do cronograma), serviço
// (item do escopo) e equipe a OS é. Some sozinho em empresa sem obra em andamento (oficina segue igual).
// RPCs: fn_os_obra_obter (vínculo + opções numa chamada) · fn_os_obra_salvar (guarda de empresa; etapa/serviço da obra).
import { useCallback, useEffect, useState } from "react";
import { HardHat } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

const ROTA_AJUDA = "/dashboard/os";

type Obra = { id: string; numero: string | null; nome: string | null };
type Etapa = { id: string; nome: string };
type Servico = { id: string; descricao: string | null; unidade: string | null };
type Vinculo = { obra_id: string; tarefa_id: string | null; obra_item_id: string | null; equipe: string | null };
type Dados = { ok: boolean; tem_obras: boolean; vinculo: Vinculo | null; obras: Obra[]; etapas: Etapa[]; servicos: Servico[] };

const rot = "mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#3D2314]/70";
const inp = "w-full min-h-[44px] rounded-lg border border-[#3D2314]/15 bg-white px-3 text-sm text-[#3D2314] focus:border-[#C8941A] focus:outline-none disabled:bg-[#FAF7F2]";

export default function OsObraVinculo({ osId, readOnly = false }: { osId: string; readOnly?: boolean }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [form, setForm] = useState<Vinculo | null>(null);   // null = sem edição: vale o vínculo gravado
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);

  const carregar = useCallback(async (obra?: string) => {
    const { data, error } = await supabase.rpc("fn_os_obra_obter", { p_os_id: osId, p_obra_id: obra || null });
    if (error || !data) { setMsg({ ok: false, texto: `Não carregou as obras: ${error?.message ?? "erro desconhecido"}` }); return; }
    setDados(data as Dados);
  }, [osId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o vínculo e as obras quando a ficha abre
  useEffect(() => { void carregar(); }, [carregar]);

  if (!dados?.tem_obras) return null;

  const salvo = dados.vinculo;
  const atual: Vinculo = form ?? salvo ?? { obra_id: "", tarefa_id: null, obra_item_id: null, equipe: null };
  const obraId = atual.obra_id, tarefaId = atual.tarefa_id ?? "", itemId = atual.obra_item_id ?? "", equipe = atual.equipe ?? "";
  const editar = (m: Partial<Vinculo>) => { setForm({ ...atual, ...m }); setMsg(null); };
  const mudou = obraId !== (salvo?.obra_id ?? "") || tarefaId !== (salvo?.tarefa_id ?? "")
    || itemId !== (salvo?.obra_item_id ?? "") || equipe.trim() !== (salvo?.equipe ?? "");

  async function trocarObra(id: string) {
    editar({ obra_id: id, tarefa_id: null, obra_item_id: null });
    await carregar(id);   // etapas e serviços da obra escolhida
  }

  async function salvar() {
    setSalvando(true); setMsg(null);
    const { data, error } = await supabase.rpc("fn_os_obra_salvar", {
      p_os_id: osId, p_obra_id: obraId || null, p_tarefa_id: tarefaId || null, p_obra_item_id: itemId || null, p_equipe: equipe,
    });
    setSalvando(false);
    const j = data as { ok?: boolean; erro?: string; vinculo?: Vinculo | null } | null;
    if (error || !j?.ok) { setMsg({ ok: false, texto: `Não salvou: ${error?.message || j?.erro || "erro desconhecido"}` }); return; }
    setDados({ ...dados!, vinculo: j.vinculo ?? null });
    setForm(null);
    setMsg({ ok: true, texto: obraId ? "Obra da OS SALVA." : "OS desligada da obra." });
  }

  return (
    <section data-testid="os-obra" className="rounded-xl border border-[#3D2314]/10 bg-[#FAF7F2] p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#3D2314]">
        <HardHat size={16} className="text-[#C8941A]" /> Obra
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={rot}>Obra <AjudaCampo chave="os.ficha.obra" rota={ROTA_AJUDA} /></span>
          <select data-testid="os-obra-obra" value={obraId} disabled={readOnly} onChange={(e) => void trocarObra(e.target.value)} className={inp}>
            <option value="">Sem obra</option>
            {dados.obras.map((o) => <option key={o.id} value={o.id}>{[o.numero, o.nome].filter(Boolean).join(" · ")}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={rot}>Etapa <AjudaCampo chave="os.ficha.etapa" rota={ROTA_AJUDA} /></span>
          <select data-testid="os-obra-etapa" value={tarefaId} disabled={readOnly || !obraId} onChange={(e) => editar({ tarefa_id: e.target.value || null })} className={inp}>
            <option value="">{obraId && dados.etapas.length === 0 ? "Obra sem cronograma" : "Sem etapa"}</option>
            {dados.etapas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={rot}>Serviço da obra <AjudaCampo chave="os.ficha.servico" rota={ROTA_AJUDA} /></span>
          <select data-testid="os-obra-servico" value={itemId} disabled={readOnly || !obraId} onChange={(e) => editar({ obra_item_id: e.target.value || null })} className={inp}>
            <option value="">{obraId && dados.servicos.length === 0 ? "Obra sem escopo" : "Sem serviço"}</option>
            {dados.servicos.map((i) => <option key={i.id} value={i.id}>{i.descricao}{i.unidade ? ` (${i.unidade})` : ""}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={rot}>Equipe <AjudaCampo chave="os.ficha.equipe" rota={ROTA_AJUDA} /></span>
          <input data-testid="os-obra-equipe" value={equipe} readOnly={readOnly} maxLength={200} onChange={(e) => editar({ equipe: e.target.value })}
            placeholder="Ex.: 2 montadores + 1 ajudante" className={inp} />
        </label>
      </div>
      {!readOnly && mudou && (
        <div className="mt-3 flex items-center gap-1">
          <button type="button" data-testid="os-obra-salvar" disabled={salvando} onClick={() => void salvar()}
            className="min-h-[44px] rounded-lg bg-[#C8941A] px-4 text-sm font-semibold text-[#3D2314] disabled:opacity-50">
            {salvando ? "Salvando…" : "Salvar obra da OS"}
          </button>
          <AjudaCampo chave="os.ficha.obra_salvar" rota={ROTA_AJUDA} />
        </div>
      )}
      {msg && <div data-testid="os-obra-msg" className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.texto}</div>}
    </section>
  );
}
