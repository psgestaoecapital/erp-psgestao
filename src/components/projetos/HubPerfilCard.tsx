"use client";

// Onda M0 (CEO 21/11) — card "Tipo de empresa no Hub" no topo de /dashboard/projetos/configuracoes.
// O TIPO (modo) filtra a NAVEGAÇÃO (menu lateral por module_catalog.ramos_aplicaveis). Prestadora, escritório
// e pessoa física veem as MESMAS telas do seu tipo; o que muda entre as especialidades (piso, gesso, elétrica…)
// é só o CONTEÚDO da biblioteca — por isso aqui não há "menu por ramo". RPCs: fn_hub_perfil_obter / _salvar.

import { useCallback, useEffect, useState } from "react";
import { Building2, HardHat, Compass, Home, Check, Loader2, Lock } from "lucide-react";
import { supabaseBrowser } from "@/lib/authFetch";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { erroAmigavel } from "@/lib/erroAmigavel";
import { comPrazo } from "@/lib/comPrazo";

type Modo = "construtora" | "prestadora" | "escritorio" | "pessoa_fisica";
type RamoOpcao = { codigo: string; nome: string; descricao: string };
type Perfil = {
  configurado: boolean;
  modo: Modo;
  ramos: string[];
  pode_editar: boolean;
  opcoes_ramo: RamoOpcao[];
};
type HistItem = { id: string; depois: { modo?: string; ramos?: string[] } | null; criado_em: string };

const ROTA = "/dashboard/projetos/configuracoes";

const MODOS: { codigo: Modo; titulo: string; frase: string; Icon: typeof Building2 }[] = [
  {
    codigo: "construtora",
    titulo: "Construtora",
    frase: "Você vê o Hub inteiro: obras, orçamentos, catálogo, insumos, mão de obra, frota e o comercial completo.",
    Icon: Building2,
  },
  {
    codigo: "prestadora",
    titulo: "Prestadora de serviço",
    frase: "Você vê as telas de prestadora e a biblioteca da sua especialidade (piso, gesso, elétrica…). Escolha suas especialidades abaixo.",
    Icon: HardHat,
  },
  {
    codigo: "escritorio",
    titulo: "Escritório de arquitetura/gestão",
    frase: "Você vê as telas de projeto e acompanhamento, com a biblioteca de arquitetura.",
    Icon: Compass,
  },
  {
    codigo: "pessoa_fisica",
    titulo: "Pessoa física (minha obra)",
    frase: "Versão enxuta para acompanhar a sua própria obra, sem o comercial.",
    Icon: Home,
  },
];

// Prévia do tamanho do menu por tipo (matriz V30 §5 — a mesma do backend). Serve só para a frase "Seu menu terá N itens".
const PREVIEW_TOTAL: Record<Modo, number> = { construtora: 28, prestadora: 26, escritorio: 22, pessoa_fisica: 12 };

const MODO_ROTULO: Record<string, string> = {
  construtora: "Construtora",
  prestadora: "Prestadora de serviço",
  escritorio: "Escritório de arquitetura/gestão",
  pessoa_fisica: "Pessoa física",
};

function dataCurta(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function HubPerfilCard({ companyId }: { companyId: string }) {
  const supabase = supabaseBrowser();
  const [loading, setLoading] = useState(true);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [modo, setModo] = useState<Modo>("construtora");
  const [ramos, setRamos] = useState<string[]>([]);
  const [hist, setHist] = useState<HistItem[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { data, error } = await comPrazo(
        async () => await supabase.rpc("fn_hub_perfil_obter", { p_company_id: companyId }),
        { ms: 8000, tentativas: 1, label: "hub_perfil_obter" }
      );
      if (error) throw error;
      const p = data as Perfil;
      setPerfil(p);
      setModo(p.modo);
      setRamos(Array.isArray(p.ramos) ? p.ramos : []);
      const { data: h } = await supabase
        .from("empresa_hub_perfil_historico")
        .select("id, depois, criado_em")
        .eq("company_id", companyId)
        .order("criado_em", { ascending: false })
        .limit(5);
      setHist((h as HistItem[]) || []);
    } catch (e) {
      setErro(erroAmigavel(e));
    } finally {
      setLoading(false);
    }
  }, [companyId, supabase]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const podeEditar = perfil?.pode_editar ?? false;
  const ehPrestadora = modo === "prestadora";
  const podeSalvar = podeEditar && !salvando && (!ehPrestadora || ramos.length > 0);
  const previewN = PREVIEW_TOTAL[modo];
  const opcoes = perfil?.opcoes_ramo ?? [];

  const escolherModo = (m: Modo) => {
    if (!podeEditar) return;
    setModo(m);
    setAviso(null);
    setErro(null);
  };

  const alternarRamo = (codigo: string) => {
    if (!podeEditar) return;
    setRamos((r) => (r.includes(codigo) ? r.filter((x) => x !== codigo) : [...r, codigo]));
  };

  const salvar = async () => {
    if (!podeSalvar) return;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const { data, error } = await supabase.rpc("fn_hub_perfil_salvar", {
        p_company_id: companyId,
        p_modo: modo,
        p_ramos: ehPrestadora ? ramos : [],
      });
      if (error) throw error;
      const r = data as { sucesso: boolean; erro?: string };
      if (!r?.sucesso) {
        setErro(r?.erro || "Não foi possível salvar o tipo de empresa.");
        setSalvando(false);
        return;
      }
      setAviso("ALTEROU o tipo de empresa no Hub. Atualizando seu menu…");
      // O menu lateral recarrega na hora: um reload garante que o filtro por tipo seja aplicado em todo o app.
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setErro(erroAmigavel(e));
      setSalvando(false);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-[#3D2314]/8 bg-white p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <Building2 size={16} className="text-[#C8941A]" />
        <h2 className="text-base font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
          Tipo de empresa no Hub
        </h2>
        <AjudaCampo chave="hub.perfil.modo" rota={ROTA} />
      </div>
      <p className="mb-4 text-sm text-[#3D2314]/60">
        O tipo define o que aparece no menu do Hub. Nenhum dado é escondido — só a navegação muda.
      </p>

      {loading ? (
        <div className="py-10 text-center">
          <Loader2 className="mx-auto animate-spin text-[#C8941A]" size={24} />
          <p className="mt-2 text-sm text-[#3D2314]/60">Carregando o tipo de empresa…</p>
        </div>
      ) : (
        <>
          {perfil && !perfil.configurado && (
            <div className="mb-4 rounded-lg border border-[#C8941A]/30 bg-[#C8941A]/8 p-3 text-sm text-[#3D2314]">
              Defina o tipo da sua empresa para o Hub mostrar só o que você usa.
            </div>
          )}
          {erro && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{erro}</div>}
          {aviso && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">✓ {aviso}</div>}

          {!podeEditar && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-[#3D2314]/5 p-3 text-sm text-[#3D2314]/70">
              <Lock size={14} /> O tipo de empresa e as especialidades são definidos pela PS na liberação do Hub. Você vê em modo leitura — fale com a PS para alterar.
            </div>
          )}

          {/* 4 cartões de tipo — 1 coluna no celular, 2 no tablet, 4 no desktop */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {MODOS.map(({ codigo, titulo, frase, Icon }) => {
              const ativo = modo === codigo;
              return (
                <button
                  key={codigo}
                  type="button"
                  onClick={() => escolherModo(codigo)}
                  disabled={!podeEditar}
                  aria-pressed={ativo}
                  className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors ${
                    ativo
                      ? "border-[#C8941A] bg-[#C8941A]/8 shadow-sm"
                      : "border-[#3D2314]/10 bg-white hover:border-[#C8941A]/50"
                  } ${podeEditar ? "cursor-pointer" : "cursor-default opacity-90"}`}
                >
                  <div className="flex w-full items-center justify-between">
                    <Icon size={22} className={ativo ? "text-[#C8941A]" : "text-[#3D2314]/60"} />
                    {ativo && <Check size={18} className="text-[#C8941A]" />}
                  </div>
                  <span className="text-sm font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
                    {titulo}
                  </span>
                  <span className="text-xs leading-relaxed text-[#3D2314]/55">{frase}</span>
                </button>
              );
            })}
          </div>

          {/* Especialidades (só prestadora) */}
          {ehPrestadora && (
            <div className="mt-5">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-medium text-[#3D2314]" style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}>
                  Suas especialidades
                </h3>
                <AjudaCampo chave="hub.perfil.ramos" rota={ROTA} />
              </div>
              <p className="mb-3 text-xs text-[#3D2314]/55">
                Escolha uma ou mais. Elas definem a biblioteca de serviços e as etapas do orçamento — não mudam as telas.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {opcoes.map((o) => {
                  const marcado = ramos.includes(o.codigo);
                  return (
                    <button
                      key={o.codigo}
                      type="button"
                      onClick={() => alternarRamo(o.codigo)}
                      disabled={!podeEditar}
                      aria-pressed={marcado}
                      title={o.descricao}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        marcado
                          ? "border-[#C8941A] bg-[#C8941A]/8 text-[#3D2314]"
                          : "border-[#3D2314]/10 bg-white text-[#3D2314]/70 hover:border-[#C8941A]/50"
                      } ${podeEditar ? "cursor-pointer" : "cursor-default"}`}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          marcado ? "border-[#C8941A] bg-[#C8941A] text-white" : "border-[#3D2314]/25"
                        }`}
                      >
                        {marcado && <Check size={12} />}
                      </span>
                      {o.nome}
                    </button>
                  );
                })}
              </div>
              {podeEditar && ramos.length === 0 && (
                <p className="mt-2 text-xs text-[#C8941A]">Escolha pelo menos uma especialidade para salvar.</p>
              )}
            </div>
          )}

          {/* Prévia + salvar */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#3D2314]/8 pt-4">
            <p className="text-sm text-[#3D2314]/70">
              Seu menu terá <span className="font-semibold text-[#3D2314]">{previewN} itens</span>.
            </p>
            {podeEditar && (
              <button
                type="button"
                onClick={salvar}
                disabled={!podeSalvar}
                className={`inline-flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-medium text-white transition-colors ${
                  podeSalvar ? "bg-[#C8941A] hover:bg-[#b3820f]" : "cursor-not-allowed bg-[#C8941A]/40"
                }`}
                style={{ fontFamily: "var(--ps-font-body)", fontStyle: "normal" }}
              >
                {salvando ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Salvar tipo de empresa
              </button>
            )}
          </div>

          {/* Histórico */}
          {hist.length > 0 && (
            <div className="mt-5 border-t border-[#3D2314]/8 pt-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[#3D2314]/50">Alterações recentes</h3>
              <ul className="space-y-1.5">
                {hist.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-2 text-xs text-[#3D2314]/60">
                    <span className="text-[#3D2314]/40">{dataCurta(h.criado_em)}</span>
                    <span>·</span>
                    <span className="text-[#3D2314]/80">{MODO_ROTULO[h.depois?.modo ?? ""] ?? h.depois?.modo ?? "—"}</span>
                    {h.depois?.ramos && h.depois.ramos.length > 0 && (
                      <span className="text-[#3D2314]/50">({h.depois.ramos.join(", ")})</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
