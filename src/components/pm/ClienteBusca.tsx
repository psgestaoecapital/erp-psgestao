"use client";
// Busca de cliente do P&M (Bloco 1, CEO 02/10): clientes = erp_clientes (o cadastro da empresa, regra do blueprint).
// Ao escolher, o banco devolve o "perfil P&M" do cliente (agency_clientes, ligado por erp_cliente_id) — criando-o só
// se ainda não existir (fn_pm_cliente_garantir). No filtro da Pauta (modo "filtro") nada é criado: só procura o perfil.

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { termoBusca } from "@/lib/pm/briefing";

export type ErpCliente = { id: string; nome_fantasia: string | null; razao_social: string | null; cpf_cnpj: string | null; cnpj_cpf: string | null; cidade: string | null; ativo?: boolean | null };
export const nomeErp = (c: Pick<ErpCliente, "nome_fantasia" | "razao_social">) => (c.nome_fantasia?.trim() || c.razao_social?.trim() || "Cliente sem nome");

export async function buscarClientesErp(empresa: string, q: string, limite = 15): Promise<ErpCliente[]> {
  const t = termoBusca(q);
  let req = supabase.from("erp_clientes").select("id, nome_fantasia, razao_social, cpf_cnpj, cnpj_cpf, cidade, ativo")
    .eq("company_id", empresa).order("nome_fantasia", { nullsFirst: false }).limit(limite + 5);
  if (t) {
    const d = t.replace(/\D/g, "");
    req = req.or([`nome_fantasia.ilike.*${t}*`, `razao_social.ilike.*${t}*`, ...(d.length >= 3 ? [`cpf_cnpj.ilike.*${d}*`, `cnpj_cpf.ilike.*${d}*`] : [])].join(","));
  }
  const { data } = await req;
  // inativo fica de fora (ativo nulo conta como ativo)
  return ((data ?? []) as ErpCliente[]).filter((c) => c.ativo !== false).slice(0, limite);
}

export function ClienteBusca({ empresa, valorNome, onEscolher, onLimpar, modo = "garantir", rotulo = "Cliente", ajuda = "pm.cliente.busca", testId = "cliente-busca", obrigatorio }: {
  empresa: string; valorNome: string; onEscolher: (agencyId: string, nome: string) => void; onLimpar?: () => void;
  modo?: "garantir" | "filtro"; rotulo?: string; ajuda?: string; testId?: string; obrigatorio?: boolean;
}) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<ErpCliente[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    const minha = ++seq.current;
    const t = setTimeout(() => { void buscarClientesErp(empresa, q).then((r) => { if (minha === seq.current) setLista(r); }); }, 220);
    return () => clearTimeout(t);
  }, [q, aberto, empresa]);

  async function escolher(c: ErpCliente) {
    setOcupado(true); setErro(null);
    const nome = nomeErp(c);
    if (modo === "filtro") {
      const { data } = await supabase.from("agency_clientes").select("id").eq("company_id", empresa).eq("erp_cliente_id", c.id).limit(1);
      const id = (data?.[0] as { id: string } | undefined)?.id ?? c.id; // sem perfil P&M: o filtro mostra 0 jobs (correto)
      onEscolher(id, nome);
    } else {
      const { data, error } = await supabase.rpc("fn_pm_cliente_garantir", { p_company_id: empresa, p_erp_cliente_id: c.id });
      if (error || !data) { setErro(error?.message ?? "Não foi possível usar este cliente."); setOcupado(false); return; }
      onEscolher(data as string, nome);
    }
    setOcupado(false); setAberto(false); setQ("");
  }

  return (
    <label className="relative block" data-testid={testId}>
      <span className="mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]">{rotulo}{obrigatorio ? " *" : ""}<AjudaCampo chave={ajuda} /></span>
      {valorNome && !aberto ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2 text-[13.5px]">
          <button type="button" className="min-w-0 flex-1 truncate text-left" onClick={() => setAberto(true)} data-testid={`${testId}-valor`}>{valorNome}</button>
          {onLimpar && <button type="button" onClick={onLimpar} aria-label="limpar cliente" className="text-[#3D2314]/50 hover:text-[#3D2314]"><X size={15} /></button>}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-[#3D2314]/15 bg-white px-3 focus-within:border-[#C8941A]">
          <Search size={15} className="text-[#3D2314]/45" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)}
            placeholder="Buscar pelo nome, razão social ou CNPJ…" className="w-full border-0 bg-transparent py-2 text-[13.5px] focus:outline-none" data-testid={`${testId}-input`} />
        </div>
      )}
      {aberto && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-[#3D2314]/15 bg-white shadow-xl" data-testid={`${testId}-lista`}>
          {lista.map((c) => (
            <button key={c.id} type="button" disabled={ocupado} onClick={() => void escolher(c)}
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#FAEEDA] disabled:opacity-50" data-testid={`${testId}-opcao`}>
              <span className="font-medium">{nomeErp(c)}</span>
              <span className="block text-[11.5px] text-[#3D2314]/55">{[c.razao_social && c.razao_social !== c.nome_fantasia ? c.razao_social : null, c.cpf_cnpj || c.cnpj_cpf, c.cidade].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {!lista.length && <div className="px-3 py-2 text-[12.5px] text-[#3D2314]/55">{q ? "Nenhum cliente com esse nome." : "Digite para buscar…"}</div>}
          <button type="button" className="sticky bottom-0 block w-full border-t border-[#3D2314]/10 bg-[#FAF7F2] px-3 py-1.5 text-left text-[12px] text-[#3D2314]/70" onClick={() => { setAberto(false); setQ(""); }}>fechar</button>
        </div>
      )}
      {erro && <div className="mt-1 text-[12px] text-[#791F1F]">{erro}</div>}
    </label>
  );
}
