"use client";

// Biblioteca padrão PS — aba SOMENTE LEITURA dentro do Catálogo de Serviços do Hub (Onda C-1 · V31, CEO 20/11).
// Mostra os serviços de referência (projetos_ref_servico_padrao) filtrados pelos RAMOS da empresa
// (empresa_hub_perfil.ramos; sem perfil = edificacao). Busca por etapa/subetapa (projetos_eap_padrao) e descrição;
// mostra unidade, custo de material e mão de obra (mediana) e a faixa mín–máx. O botão "Usar" copia o serviço para
// o catálogo da empresa (fn_projetos_usar_servico_padrao) e leva ao serviço copiado. Esconde especifico_obra=true.
// Leitura direta das tabelas (RLS: ref/eap são leitura liberada a authenticated; perfil é por empresa) — sem RPC nova.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, Search, ArrowRight, Loader2 } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { erroAmigavel } from "@/lib/erroAmigavel";

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

interface RefServico {
  codigo: string;
  eap_codigo: string | null;
  nome: string;
  unidade: string | null;
  custo_material_ref: number | null;
  custo_mao_obra_ref: number | null;
  custo_material_min: number | null;
  custo_material_max: number | null;
  custo_mao_obra_min: number | null;
  custo_mao_obra_max: number | null;
}

interface EapNo {
  codigo: string;
  nome: string;
  nivel: number;
}

function faixa(min: number | null, max: number | null): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && min !== max) return `${moeda.format(min)} – ${moeda.format(max)}`;
  return null;
}

export default function BibliotecaPadraoPS({ companyId, rota }: { companyId: string; rota: string }) {
  const router = useRouter();
  const [ramos, setRamos] = useState<string[] | null>(null);
  const [servicos, setServicos] = useState<RefServico[]>([]);
  const [eap, setEap] = useState<EapNo[]>([]);
  const [busca, setBusca] = useState("");
  const [etapa, setEtapa] = useState("");
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [usando, setUsando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const supabase = supabaseBrowser();
      // Ramos da empresa (sem perfil = edificação, conforme V31).
      const { data: perfil } = await supabase
        .from("empresa_hub_perfil")
        .select("ramos")
        .eq("company_id", companyId)
        .maybeSingle();
      const ramosEmpresa: string[] =
        perfil?.ramos && Array.isArray(perfil.ramos) && perfil.ramos.length ? perfil.ramos : ["edificacao"];
      setRamos(ramosEmpresa);

      const [{ data: refs, error: e1 }, { data: eaps, error: e2 }] = await Promise.all([
        supabase
          .from("projetos_ref_servico_padrao")
          .select(
            "codigo,eap_codigo,nome,unidade,custo_material_ref,custo_mao_obra_ref,custo_material_min,custo_material_max,custo_mao_obra_min,custo_mao_obra_max"
          )
          .eq("ativo", true)
          .eq("especifico_obra", false)
          .overlaps("ramos", ramosEmpresa)
          .order("eap_codigo", { ascending: true })
          .order("nome", { ascending: true }),
        supabase.from("projetos_eap_padrao").select("codigo,nome,nivel").eq("ativo", true),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      setServicos((refs as RefServico[]) || []);
      setEap((eaps as EapNo[]) || []);
    } catch (e) {
      setErro(erroAmigavel(e, "Não foi possível carregar a biblioteca padrão."));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const eapNome = useMemo(() => {
    const m = new Map<string, EapNo>();
    for (const n of eap) m.set(n.codigo, n);
    return m;
  }, [eap]);

  // Etapas de nível 1 que de fato têm serviço na biblioteca da empresa (para o filtro).
  const etapas = useMemo(() => {
    const codigos = new Set<string>();
    for (const s of servicos) {
      const top = (s.eap_codigo || "").split(".")[0];
      if (top) codigos.add(top);
    }
    return [...codigos]
      .map((c) => ({ codigo: c, nome: eapNome.get(c)?.nome || c }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [servicos, eapNome]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return servicos.filter((s) => {
      if (etapa && (s.eap_codigo || "").split(".")[0] !== etapa) return false;
      if (!q) return true;
      const etapaNome = eapNome.get((s.eap_codigo || "").split(".")[0])?.nome || "";
      const subNome = s.eap_codigo ? eapNome.get(s.eap_codigo)?.nome || "" : "";
      return (
        s.nome.toLowerCase().includes(q) ||
        s.codigo.toLowerCase().includes(q) ||
        etapaNome.toLowerCase().includes(q) ||
        subNome.toLowerCase().includes(q)
      );
    });
  }, [servicos, busca, etapa, eapNome]);

  const usar = useCallback(
    async (codigo: string) => {
      setUsando(codigo);
      setErro(null);
      setAviso(null);
      try {
        const supabase = supabaseBrowser();
        const { data, error } = await supabase.rpc("fn_projetos_usar_servico_padrao", {
          p_company_id: companyId,
          p_ref_codigo: codigo,
        });
        if (error) throw error;
        if (data) {
          router.push(`${rota}/${data}`);
        } else {
          setAviso("Serviço copiado para o seu catálogo.");
        }
      } catch (e) {
        setErro(erroAmigavel(e, "Não foi possível copiar este serviço para o seu catálogo."));
      } finally {
        setUsando(null);
      }
    },
    [companyId, rota, router]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-[#3D2314]/8 bg-white p-10 text-sm text-[#3D2314]/60 shadow-sm">
        <Loader2 size={16} className="animate-spin" /> Carregando a biblioteca padrão…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#C8941A]/20 bg-[#C8941A]/5 p-4">
        <BookMarked size={18} className="mt-0.5 shrink-0 text-[#C8941A]" />
        <div className="text-sm text-[#3D2314]/75">
          Serviços de referência da PS para os ramos da sua empresa. São valores de mercado (mediana) só para
          consulta — ao clicar em <strong>Usar</strong>, o serviço é copiado para o seu catálogo e você ajusta o
          custo à sua realidade.
          {ramos && ramos.length > 0 && (
            <span className="mt-1 block text-xs text-[#3D2314]/55">
              Ramos da empresa: {ramos.join(", ")}
            </span>
          )}
        </div>
      </div>

      {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
      {aviso && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>}

      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-4 shadow-sm md:grid-cols-5">
        <div data-ajuda="projetos.catalogo.biblioteca.busca" className="md:col-span-3">
          <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
            Buscar
            <AjudaCampo chave="projetos.catalogo.biblioteca.busca" rota={rota} />
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3D2314]/40" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Etapa, subetapa, código ou descrição…"
              className="w-full rounded-lg border border-[#3D2314]/12 bg-[#FAF7F2] py-2 pl-9 pr-3 text-sm text-[#3D2314] outline-none focus:border-[#C8941A]"
            />
          </div>
        </div>
        <div data-ajuda="projetos.catalogo.biblioteca.filtro_etapa" className="md:col-span-2">
          <label className="mb-1 flex items-center text-xs uppercase tracking-wider text-[#3D2314]/60">
            Etapa
            <AjudaCampo chave="projetos.catalogo.biblioteca.filtro_etapa" rota={rota} />
          </label>
          <select
            value={etapa}
            onChange={(e) => setEtapa(e.target.value)}
            className="w-full rounded-lg border border-[#3D2314]/12 bg-[#FAF7F2] px-3 py-2 text-sm text-[#3D2314] outline-none focus:border-[#C8941A]"
          >
            <option value="">Todas as etapas</option>
            {etapas.map((et) => (
              <option key={et.codigo} value={et.codigo}>
                {et.nome}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="mb-3 text-xs text-[#3D2314]/55">
        {filtrados.length} serviço{filtrados.length === 1 ? "" : "s"} na biblioteca padrão
      </p>

      {filtrados.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#3D2314]/15 bg-white p-10 text-center text-sm text-[#3D2314]/55">
          Nenhum serviço de referência para a busca atual.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtrados.map((s) => {
            const topCod = (s.eap_codigo || "").split(".")[0];
            const etapaNome = eapNome.get(topCod)?.nome || topCod;
            const subNome = s.eap_codigo ? eapNome.get(s.eap_codigo)?.nome : null;
            const fMat = faixa(s.custo_material_min, s.custo_material_max);
            const fMo = faixa(s.custo_mao_obra_min, s.custo_mao_obra_max);
            return (
              <div
                key={s.codigo}
                className="flex flex-col gap-3 rounded-xl border border-[#3D2314]/8 bg-white p-4 shadow-sm"
              >
                <div>
                  {etapaNome && (
                    <span className="inline-block rounded-full bg-[#3D2314]/5 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#3D2314]/60">
                      {etapaNome}
                      {subNome && subNome !== etapaNome ? ` · ${subNome}` : ""}
                    </span>
                  )}
                  <h3 className="mt-1.5 text-sm font-medium leading-snug text-[#3D2314]">{s.nome}</h3>
                  <p className="text-xs text-[#3D2314]/50">
                    {s.codigo}
                    {s.unidade ? ` · unidade ${s.unidade}` : ""}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 border-t border-[#3D2314]/8 pt-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[#3D2314]/45">Material (mediana)</p>
                    <p className="text-sm font-semibold text-[#3D2314]">
                      {s.custo_material_ref != null ? moeda.format(s.custo_material_ref) : "—"}
                    </p>
                    {fMat && <p className="text-[11px] text-[#3D2314]/45">faixa {fMat}</p>}
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-[#3D2314]/45">Mão de obra (mediana)</p>
                    <p className="text-sm font-semibold text-[#3D2314]">
                      {s.custo_mao_obra_ref != null ? moeda.format(s.custo_mao_obra_ref) : "—"}
                    </p>
                    {fMo && <p className="text-[11px] text-[#3D2314]/45">faixa {fMo}</p>}
                  </div>
                </div>
                <div data-ajuda="projetos.catalogo.biblioteca.usar" className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => usar(s.codigo)}
                    disabled={usando === s.codigo}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#3D2314] px-4 py-2 text-sm font-medium text-[#FAF7F2] hover:bg-[#3D2314]/90 disabled:opacity-50"
                  >
                    {usando === s.codigo ? (
                      <>
                        <Loader2 size={14} className="animate-spin" /> Copiando…
                      </>
                    ) : (
                      <>
                        Usar <ArrowRight size={14} />
                      </>
                    )}
                    <AjudaCampo chave="projetos.catalogo.biblioteca.usar" rota={rota} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
