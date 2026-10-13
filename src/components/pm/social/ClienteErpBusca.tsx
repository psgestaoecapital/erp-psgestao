"use client";
// Social (CEO 03/10): o planejamento guarda o cliente do CADASTRO ÚNICO (erp_clientes.id) — não o perfil P&M. Mesma
// busca do Bloco 1 (nome, razão social ou CNPJ), sem criar nada: o perfil P&M só nasce quando um post vira job.

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { buscarClientesErp, nomeErp, type ErpCliente } from "@/components/pm/ClienteBusca";

export function ClienteErpBusca({ empresa, valorNome, onEscolher, onLimpar, ajuda, testId, desabilitado }: {
  empresa: string; valorNome: string; onEscolher: (erpId: string, nome: string) => void; onLimpar?: () => void;
  ajuda: string; testId: string; desabilitado?: boolean;
}) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<ErpCliente[]>([]);
  const seq = useRef(0);

  useEffect(() => {
    if (!aberto) return;
    const minha = ++seq.current;
    const t = setTimeout(() => { void buscarClientesErp(empresa, q).then((r) => { if (minha === seq.current) setLista(r); }); }, 220);
    return () => clearTimeout(t);
  }, [q, aberto, empresa]);

  return (
    <label className="relative block" data-testid={testId}>
      <span className="mb-1 flex items-center text-[12px] font-semibold text-[#3D2314]">Cliente *<AjudaCampo chave={ajuda} /></span>
      {valorNome && !aberto ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[#3D2314]/15 bg-white px-3 py-2.5 text-[14px]">
          <button type="button" disabled={desabilitado} className="min-w-0 flex-1 truncate text-left disabled:cursor-not-allowed" onClick={() => setAberto(true)} data-testid={`${testId}-valor`}>{valorNome}</button>
          {onLimpar && !desabilitado && <button type="button" onClick={onLimpar} aria-label="limpar cliente" className="text-[#3D2314]/50 hover:text-[#3D2314]"><X size={15} /></button>}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-[#3D2314]/15 bg-white px-3 focus-within:border-[#C8941A]">
          <Search size={15} className="text-[#3D2314]/45" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setAberto(true); }} onFocus={() => setAberto(true)} disabled={desabilitado}
            placeholder="Buscar pelo nome, razão social ou CNPJ…" className="w-full border-0 bg-transparent py-2.5 text-[14px] focus:outline-none" data-testid={`${testId}-input`} />
        </div>
      )}
      {aberto && (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-[#3D2314]/15 bg-white shadow-xl" data-testid={`${testId}-lista`}>
          {lista.map((c) => (
            <button key={c.id} type="button" onClick={() => { onEscolher(c.id, nomeErp(c)); setAberto(false); setQ(""); }}
              className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#FAEEDA]" data-testid={`${testId}-opcao`}>
              <span className="font-medium">{nomeErp(c)}</span>
              <span className="block text-[11.5px] text-[#3D2314]/55">{[c.razao_social && c.razao_social !== c.nome_fantasia ? c.razao_social : null, c.cpf_cnpj || c.cnpj_cpf, c.cidade].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {!lista.length && <div className="px-3 py-2 text-[12.5px] text-[#3D2314]/55">{q ? "Nenhum cliente com esse nome." : "Digite para buscar…"}</div>}
          <button type="button" className="sticky bottom-0 block w-full border-t border-[#3D2314]/10 bg-[#FAF7F2] px-3 py-1.5 text-left text-[12px] text-[#3D2314]/70" onClick={() => { setAberto(false); setQ(""); }}>fechar</button>
        </div>
      )}
    </label>
  );
}
