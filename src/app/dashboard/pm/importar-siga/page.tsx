"use client";
// P&M · Importar jobs do SIGA (PM-J, CEO 02/10). 1) escolher a planilha; 2) conferir o mapa das colunas (o sistema
// sugere pelo cabeçalho); 3) prévia: quantos entram pela regra do CEO (últimos 60 dias + em aberto, sem os "em aprovação"
// antigos), quantos ficam de fora e por quê; o banco confere de novo (já existe, cliente e responsável não achados);
// 4) importar. Nada é gravado sem a prévia; rodar de novo não duplica. Todo campo tem o "?".

import { useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";
import { CAMPOS, MOTIVO_TEXTO, adivinharMapa, ehCsv, selecionar, textoCsv, type CampoSiga, type Motivo } from "@/lib/pm/importSiga";

type Conferencia = { ok: boolean; erro?: string; mensagem?: string; total: number; novos: number; ja_existem: number; gravados: number;
  clientes_nao_encontrados: string[] | null; responsaveis_nao_encontrados: string[] | null; pecas_nao_encontradas: string[] | null };
const card = "rounded-2xl border border-[#3D2314]/10 bg-white p-4";
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

export default function ImportarSigaPage() {
  const { selInfo, companyIds } = useCompanyIds();
  const empresa = selInfo.tipo === "empresa" && companyIds.length === 1 ? companyIds[0] : (companyIds[0] ?? null);
  const [arquivo, setArquivo] = useState<string>("");
  const [cab, setCab] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<unknown[][]>([]);
  const [mapa, setMapa] = useState<Partial<Record<CampoSiga, number>>>({});
  const [conf, setConf] = useState<Conferencia | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<number | null>(null);

  async function ler(f: File) {
    setErro(null); setConf(null); setFeito(null);
    try {
      // CSV: texto com acentos certos e datas sem conversão (lidas por dataSiga, dd/mm/aaaa); Excel: como está
      const wb = ehCsv(f.name, f.type)
        ? XLSX.read(textoCsv(new Uint8Array(await f.arrayBuffer())), { type: "string", raw: true })
        : XLSX.read(await f.arrayBuffer(), { cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      const i = m.findIndex((r) => (r as unknown[]).filter((x) => String(x ?? "").trim()).length >= 2); // pula títulos em cima
      if (i < 0) { setErro("A planilha está vazia."); return; }
      const c = (m[i] as unknown[]).map((x) => String(x ?? "").trim());
      setArquivo(f.name); setCab(c); setLinhas(m.slice(i + 1) as unknown[][]); setMapa(adivinharMapa(c));
    } catch (e) { setErro(`Não consegui ler a planilha: ${(e as Error).message}`); }
  }

  const sel = useMemo(() => (linhas.length ? selecionar(linhas, mapa, hojeSP()) : null), [linhas, mapa]);
  const porMotivo = useMemo(() => {
    const r: Partial<Record<Motivo, number>> = {};
    for (const f of sel?.fora ?? []) r[f.motivo] = (r[f.motivo] ?? 0) + 1;
    return r;
  }, [sel]);
  const faltaObrigatorio = CAMPOS.filter((c) => c.obrigatorio && mapa[c.id] == null);

  async function chamar(gravar: boolean) {
    if (!empresa || !sel) return;
    setOcupado(true); setErro(null);
    const payload = sel.entra.map((l) => ({ numero: l.numero, rodada: l.rodada, titulo: l.titulo, cliente: l.cliente, responsavel: l.responsavel,
      situacao: l.situacao, prazo: l.prazo, criacao: l.criacao, peca: l.peca, briefing: l.briefing }));
    const { data, error } = await supabase.rpc("fn_pm_importar_jobs_siga", { p_company_id: empresa, p_linhas: payload, p_gravar: gravar });
    setOcupado(false);
    const r = data as Conferencia | null;
    if (error || !r?.ok) { setErro(r?.mensagem || error?.message || r?.erro || "Não foi possível conferir."); return; }
    setConf(r);
    if (gravar) setFeito(r.gravados);
  }

  if (!empresa) return <div className="p-6 text-[13px] text-[#3D2314]/70">Escolha uma empresa no seletor.</div>;

  return (
    <div className="min-h-screen bg-[#FAF7F2] p-4 text-[#3D2314] md:p-6" data-testid="importar-siga-page">
      <div className="mx-auto max-w-4xl space-y-3">
        <Link href="/dashboard/pm/pauta" className="inline-flex items-center gap-1 text-[12.5px] text-[#3D2314]/60 hover:underline"><ArrowLeft size={13} /> Pauta</Link>
        <header>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8941A]"><FileSpreadsheet size={13} /> P&amp;M · Implantação</div>
          <h1 className="text-[26px] font-medium leading-tight">Importar jobs do SIGA</h1>
          <p className="text-[13px] text-[#3D2314]/60">Entram os jobs dos últimos 60 dias e todos os que estão em aberto. Os &ldquo;em aprovação&rdquo; parados há mais de 60 dias ficam de fora. Nada é gravado antes da prévia.</p>
        </header>

        <section className={card}>
          <label className="block">
            <span className="mb-1 flex items-center text-[12px] font-semibold">1 · Planilha do SIGA<AjudaCampo chave="pm.siga.arquivo" /></span>
            <span className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#C8941A]/60 bg-[#FAEEDA]/40 px-4 py-4 text-[13.5px] hover:bg-[#FAEEDA]">
              <Upload size={16} /> {arquivo ? `${arquivo} · ${linhas.length} linha(s)` : "Escolher arquivo (.xlsx, .xls ou .csv)"}
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); }} data-testid="siga-arquivo" />
            </span>
          </label>
        </section>

        {!!cab.length && (
          <section className={card} data-testid="siga-mapa">
            <div className="mb-2 flex items-center text-[12px] font-semibold">2 · Colunas da planilha<AjudaCampo chave="pm.siga.mapa" /></div>
            <div className="grid gap-2 sm:grid-cols-3">
              {CAMPOS.map((c) => (
                <label key={c.id} className="block text-[12px]">
                  <span className="mb-0.5 flex items-center text-[#3D2314]/70">{c.rotulo}{c.obrigatorio ? " *" : ""}<AjudaCampo chave="pm.siga.mapa" /></span>
                  <select className="w-full rounded-lg border border-[#3D2314]/15 bg-white px-2 py-1.5 text-[13px]" value={mapa[c.id] ?? ""} data-testid={`siga-mapa-${c.id}`}
                    onChange={(e) => setMapa((m) => ({ ...m, [c.id]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                    <option value="">— não tem —</option>
                    {cab.map((h, i) => <option key={i} value={i}>{h || `coluna ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {!!faltaObrigatorio.length && <div className="mt-2 text-[12.5px] text-[#791F1F]">Escolha a coluna de: {faltaObrigatorio.map((c) => c.rotulo).join(", ")}.</div>}
          </section>
        )}

        {sel && !faltaObrigatorio.length && (
          <section className={card} data-testid="siga-previa">
            <div className="mb-2 flex items-center text-[12px] font-semibold">3 · Prévia<AjudaCampo chave="pm.siga.previa" /></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-[#E5F2E1] p-3"><div className="text-[11px] text-[#2F5A1F]">entram</div><div className="text-[22px] font-medium" data-testid="siga-n-entram">{sel.entra.length}</div></div>
              <div className="rounded-xl bg-[#FAF7F2] p-3"><div className="text-[11px] text-[#3D2314]/60">ficam de fora</div><div className="text-[22px] font-medium" data-testid="siga-n-fora">{sel.fora.length}</div></div>
              {conf && <div className="rounded-xl bg-[#FAF7F2] p-3"><div className="text-[11px] text-[#3D2314]/60">já estão no sistema</div><div className="text-[22px] font-medium" data-testid="siga-n-existem">{conf.ja_existem}</div></div>}
              {conf && <div className="rounded-xl bg-[#FAEEDA] p-3"><div className="text-[11px] text-[#6B4A0E]">novos de verdade</div><div className="text-[22px] font-medium" data-testid="siga-n-novos">{conf.novos}</div></div>}
            </div>
            {!!sel.fora.length && (
              <ul className="mt-2 text-[12.5px] text-[#3D2314]/70">
                {(Object.entries(porMotivo) as [Motivo, number][]).map(([m, n]) => <li key={m}>· {n} {MOTIVO_TEXTO[m]}</li>)}
              </ul>
            )}
            <div className="mt-3 overflow-x-auto rounded-xl border border-[#3D2314]/10">
              <table className="w-full text-[12.5px]">
                <thead className="bg-[#FAF7F2] text-left text-[11px] uppercase tracking-wider text-[#3D2314]/55"><tr><th className="px-2 py-1.5">Nº</th><th className="px-2">Título</th><th className="px-2">Cliente</th><th className="px-2">Responsável</th><th className="px-2">Situação</th><th className="px-2">Prazo</th></tr></thead>
                <tbody>
                  {sel.entra.slice(0, 12).map((l) => (
                    <tr key={l.numero} className="border-t border-[#3D2314]/6"><td className="px-2 py-1">{l.numero}{l.rodada ? String.fromCharCode(64 + Math.min(l.rodada, 26)) : ""}</td><td className="px-2">{l.titulo}</td><td className="px-2">{l.cliente ?? "—"}</td><td className="px-2">{l.responsavel ?? "—"}</td><td className="px-2">{l.situacao_original ?? "—"}</td><td className="px-2">{l.prazo?.split("-").reverse().join("/") ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
              {sel.entra.length > 12 && <div className="px-2 py-1 text-[11.5px] text-[#3D2314]/55">… e mais {sel.entra.length - 12}</div>}
            </div>
            {conf && (
              <div className="mt-3 space-y-1 text-[12.5px]" data-testid="siga-conferencia">
                {!!conf.clientes_nao_encontrados?.length && <div className="flex gap-1.5 text-[#6B4A0E]"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Clientes não encontrados no cadastro (o job entra sem cliente): {conf.clientes_nao_encontrados.join(", ")}</div>}
                {!!conf.responsaveis_nao_encontrados?.length && <div className="flex gap-1.5 text-[#6B4A0E]"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Responsáveis sem usuário (fica o nome escrito): {conf.responsaveis_nao_encontrados.join(", ")}</div>}
                {!!conf.pecas_nao_encontradas?.length && <div className="flex gap-1.5 text-[#3D2314]/60">Peças fora do catálogo (fica o texto): {conf.pecas_nao_encontradas.join(", ")}</div>}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-xl border border-[#3D2314]/15 bg-white px-4 py-2 text-[13px] disabled:opacity-40" disabled={ocupado || !sel.entra.length} onClick={() => void chamar(false)} data-testid="siga-conferir">Conferir no sistema</button>
              <button className="rounded-xl bg-[#3D2314] px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40" disabled={ocupado || !conf || !conf.novos || feito != null} onClick={() => void chamar(true)} data-testid="siga-importar">
                {conf ? `Importar ${conf.novos} job(s)` : "Importar"}
              </button>
            </div>
          </section>
        )}

        {erro && <div className="rounded-xl bg-[#F7E1E1] px-3 py-2 text-[12.5px] text-[#791F1F]" data-testid="siga-erro">{erro}</div>}
        {feito != null && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-[#E5F2E1] px-4 py-3 text-[13.5px] text-[#2F5A1F]" data-testid="siga-feito">
            <span className="flex items-center gap-1.5"><CheckCircle2 size={16} /> {feito} job(s) importado(s) do SIGA.</span>
            <Link href="/dashboard/pm/pauta" className="font-semibold underline">Abrir a Pauta</Link>
          </div>
        )}
      </div>
    </div>
  );
}
