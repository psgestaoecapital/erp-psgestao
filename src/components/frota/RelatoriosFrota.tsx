// src/components/frota/RelatoriosFrota.tsx
// Hub · Frota · relatórios para a logística (chamado #5214). Consumo, rodagem, multas e manutenção por período,
// com tabela, gráfico em linhas, impressão e CSV. Os números vêm das RPCs fn_hub_frota_relatorio_* (banco).
"use client";

import { useCallback, useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/lib/supabase";
import { AjudaCampo } from "@/components/ajuda/AjudaCampo";

const ROTA = "/dashboard/projetos/frota";
const ESP = "#3D2314", BRANCO = "#FFFFFF", BD = "#E7DED3", TXM = "#6B5D4F";
const CORES = ["#3D2314", "#B45309", "#166534", "#1D4ED8", "#B91C1C", "#7C3AED", "#0E7490"];
const inp = "w-full rounded-lg border px-3 py-2 text-sm";

const RELATORIOS = [["consumo", "Consumo (km/l)"], ["rodagem", "Rodagem (km)"], ["multas", "Multas"], ["manutencao", "Manutenção"]] as const;
const AGRUPAMENTOS = [["motorista", "Motorista"], ["viagem", "Viagem"], ["veiculo", "Veículo"], ["periodo", "Mês"]] as const;

type Tipo = (typeof RELATORIOS)[number][0];
type Agrupar = (typeof AGRUPAMENTOS)[number][0];
type Veic = { id: string; placa: string; modelo: string | null };
type Linha = Record<string, unknown>;

const num = (n: unknown) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 0 }));
const dec = (n: unknown) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const moeda = (n: unknown) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const dataBR = (d: unknown) => (d ? String(d).split("-").reverse().join("/") : "—");
const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const inicioMesIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};

// Transforma a série (uma linha por mês e chave) em uma linha por mês, com uma coluna por chave, para o gráfico.
function pivotar(itens: Linha[], chave: string, valor: string) {
  const meses = [...new Set(itens.map((i) => String(i.mes)))].sort();
  const keys = [...new Set(itens.map((i) => String(i[chave])))];
  const data = meses.map((mes) => {
    const row: Record<string, string | number | null> = { mes };
    for (const k of keys) row[k] = null;
    for (const it of itens) {
      if (String(it.mes) !== mes) continue;
      const v = it[valor];
      row[String(it[chave])] = v == null ? null : Number(v);
    }
    return row;
  });
  return { data, keys };
}

function baixarCsv(nome: string, cab: string[], linhas: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v).replace(/"/g, '""');
    return /[;"\n]/.test(s) ? `"${s}"` : s;
  };
  const texto = "﻿" + [cab, ...linhas].map((l) => l.map(esc).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${nome}.csv`; a.click();
  URL.revokeObjectURL(url);
}

export function RelatoriosFrota({ companyId, veiculos }: { companyId: string; veiculos: Veic[] }) {
  const [tipo, setTipo] = useState<Tipo>("consumo");
  const [de, setDe] = useState(inicioMesIso);
  const [ate, setAte] = useState(hojeIso);
  const [veiculoId, setVeiculoId] = useState("");
  const [agrupar, setAgrupar] = useState<Agrupar>("motorista");
  const [grafico, setGrafico] = useState(true);
  const [dados, setDados] = useState<Linha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const veic = veiculoId || null;
    const chamadas: Record<Tipo, { fn: string; args: Record<string, unknown> }> = {
      consumo: { fn: "fn_hub_frota_relatorio_consumo", args: { p_company_id: companyId, p_de: de, p_ate: ate, p_veiculo_id: veic } },
      rodagem: { fn: "fn_hub_frota_relatorio_rodagem", args: { p_company_id: companyId, p_de: de, p_ate: ate, p_agrupar: agrupar, p_veiculo_id: veic } },
      multas: { fn: "fn_hub_frota_relatorio_multas", args: { p_company_id: companyId, p_de: de, p_ate: ate, p_veiculo_id: veic } },
      manutencao: { fn: "fn_hub_frota_relatorio_manutencao", args: { p_company_id: companyId, p_de: de, p_ate: ate, p_veiculo_id: veic } },
    };
    const { fn, args } = chamadas[tipo];
    const { data, error } = await supabase.rpc(fn, args);
    setCarregando(false);
    if (error) { setErro(error.message); setDados(null); return; }
    setDados(data as Linha);
  }, [companyId, tipo, de, ate, veiculoId, agrupar]);

  useEffect(() => { void carregar(); }, [carregar]);

  const periodoValido = de && ate && de <= ate;

  return (
    <div className="space-y-4">
      {/* filtros: some na impressão */}
      <div className="grid grid-cols-1 gap-3 rounded-xl border p-3 print:hidden sm:grid-cols-2 lg:grid-cols-6" style={{ borderColor: BD, background: BRANCO }}>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold" style={{ color: TXM }}>Relatório</span>
          <AjudaCampo chave="projetos.frota.rel_tipo" rota={ROTA} />
          <select aria-label="Relatório" className={inp} value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
            {RELATORIOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
          </select>
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold" style={{ color: TXM }}>Período de</span>
          <AjudaCampo chave="projetos.frota.rel_de" rota={ROTA} />
          <input aria-label="Período de" type="date" className={inp} value={de} onChange={(e) => setDe(e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold" style={{ color: TXM }}>Período até</span>
          <AjudaCampo chave="projetos.frota.rel_ate" rota={ROTA} />
          <input aria-label="Período até" type="date" className={inp} value={ate} onChange={(e) => setAte(e.target.value)} />
        </label>
        <label className="block text-xs">
          <span className="mb-1 block font-semibold" style={{ color: TXM }}>Veículo</span>
          <AjudaCampo chave="projetos.frota.rel_veiculo" rota={ROTA} />
          <select aria-label="Veículo" className={inp} value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
            <option value="">Todos</option>
            {veiculos.map((v) => <option key={v.id} value={v.id}>{v.placa}{v.modelo ? ` · ${v.modelo}` : ""}</option>)}
          </select>
        </label>
        {tipo === "rodagem" && (
          <label className="block text-xs">
            <span className="mb-1 block font-semibold" style={{ color: TXM }}>Agrupar por</span>
            <AjudaCampo chave="projetos.frota.rel_agrupar" rota={ROTA} />
            <select aria-label="Agrupar por" className={inp} value={agrupar} onChange={(e) => setAgrupar(e.target.value as Agrupar)}>
              {AGRUPAMENTOS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 self-end text-xs">
          <input type="checkbox" checked={grafico} onChange={(e) => setGrafico(e.target.checked)} />
          <span>Gráfico em linhas</span>
          <AjudaCampo chave="projetos.frota.rel_grafico" rota={ROTA} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => window.print()} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: ESP, color: ESP }}>Imprimir</button>
        <button onClick={() => exportar(tipo, dados, agrupar)} disabled={!dados} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40" style={{ borderColor: ESP, color: ESP }}>Exportar CSV</button>
        {carregando && <span className="text-xs" style={{ color: TXM }}>Carregando…</span>}
        {!periodoValido && <span role="alert" className="text-xs text-red-700">O período “até” precisa ser igual ou depois do “de”.</span>}
      </div>

      {erro && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{erro}</div>}

      {dados && periodoValido && (
        <div className="space-y-4 rounded-xl border p-4" style={{ borderColor: BD, background: BRANCO }}>
          <div className="text-sm font-semibold">
            {RELATORIOS.find(([v]) => v === tipo)?.[1]} · {dataBR(de)} a {dataBR(ate)}
          </div>
          {tipo === "consumo" && <Consumo dados={dados} grafico={grafico} />}
          {tipo === "rodagem" && <Rodagem dados={dados} grafico={grafico} agrupar={agrupar} />}
          {tipo === "multas" && <Multas dados={dados} grafico={grafico} />}
          {tipo === "manutencao" && <Manutencao dados={dados} grafico={grafico} />}
        </div>
      )}
    </div>
  );
}

function Consumo({ dados, grafico }: { dados: Linha; grafico: boolean }) {
  const veiculos = (dados.veiculos as Linha[]) ?? [];
  const total = dados.total as Linha;
  const serie = (dados.serie as Linha[]) ?? [];
  const pv = pivotar(serie, "placa", "consumo_km_l");
  return (
    <>
      <Tabela cab={["Veículo", "Km rodado", "Litros", "Km/l"]} linhas={veiculos.map((v) => [String(v.placa), num(v.km), dec(v.litros), v.consumo_km_l == null ? "sem abastecimento" : dec(v.consumo_km_l)])}
        rodape={["Total da frota", num(total.km), dec(total.litros), dec(total.consumo_km_l)]} />
      {grafico && <Grafico data={pv.data} keys={pv.keys} unidade="km/l" />}
    </>
  );
}

function Rodagem({ dados, grafico, agrupar }: { dados: Linha; grafico: boolean; agrupar: Agrupar }) {
  const linhas = (dados.linhas as Linha[]) ?? [];
  const serie = (dados.serie as Linha[]) ?? [];
  const pv = pivotar(serie, "chave", "km");
  return (
    <>
      <Tabela cab={[AGRUPAMENTOS.find(([v]) => v === agrupar)?.[1] ?? "Grupo", "Km", "Viagens"]}
        linhas={linhas.map((l) => [String(l.rotulo), num(l.km), num(l.viagens)])}
        rodape={["Total", num(dados.total_km), num(dados.viagens)]} />
      {grafico && <Grafico data={pv.data} keys={pv.keys} unidade="km" />}
    </>
  );
}

function Multas({ dados, grafico }: { dados: Linha; grafico: boolean }) {
  const linhas = (dados.linhas as Linha[]) ?? [];
  const serie = (dados.serie as Linha[]) ?? [];
  const pv = pivotar(serie.map((s) => ({ ...s, chave: "Multas" })), "chave", "valor");
  return (
    <>
      <Tabela cab={["Data", "Veículo", "Motorista", "Descrição", "Valor"]}
        linhas={linhas.map((l) => [dataBR(l.data), String(l.placa), String(l.motorista), String(l.descricao ?? "—"), moeda(l.valor)])}
        rodape={["Total", `${num(dados.quantidade)} multa(s)`, "", "", moeda(dados.total)]} />
      {grafico && <Grafico data={pv.data} keys={pv.keys} unidade="R$" />}
    </>
  );
}

function Manutencao({ dados, grafico }: { dados: Linha; grafico: boolean }) {
  const realizadas = (dados.realizadas as Linha[]) ?? [];
  const programadas = (dados.programadas as Linha[]) ?? [];
  const serie = (dados.serie as Linha[]) ?? [];
  const pv = pivotar(serie.map((s) => ({ ...s, chave: "Manutenções (R$)" })), "chave", "valor");
  return (
    <>
      <div className="text-sm font-semibold">Realizadas no período</div>
      <Tabela cab={["Data", "Veículo", "Tipo", "Km", "Valor", "Fornecedor"]}
        linhas={realizadas.map((r) => [dataBR(r.data), String(r.placa), String(r.tipo), num(r.km), moeda(r.valor), String(r.fornecedor ?? "—")])}
        rodape={["Total", `${num(dados.realizadas_quantidade)} manutenção(ões)`, "", "", moeda(dados.realizadas_total), ""]} />
      {grafico && <Grafico data={pv.data} keys={pv.keys} unidade="R$" />}
      <div className="text-sm font-semibold">Programadas (próxima por km)</div>
      <Tabela cab={["Veículo", "Tipo", "Km atual", "Última vez", "Próxima", "Falta"]}
        linhas={programadas.map((p) => [String(p.placa), String(p.tipo), num(p.km_atual), num(p.ultimo_km), num(p.proxima_km),
          Number(p.km_para_proxima) <= 0 ? `vencida há ${num(-Number(p.km_para_proxima))} km` : `${num(p.km_para_proxima)} km`])} />
    </>
  );
}

function Tabela({ cab, linhas, rodape }: { cab: string[]; linhas: (string | number | null)[][]; rodape?: (string | number | null)[] }) {
  if (linhas.length === 0) return <div className="text-xs" style={{ color: TXM }}>Nenhum dado no período.</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr style={{ color: TXM }}>{cab.map((c) => <th key={c} className="border-b px-2 py-1 font-semibold" style={{ borderColor: BD }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>{l.map((c, j) => <td key={j} className="border-b px-2 py-1" style={{ borderColor: BD }}>{c ?? "—"}</td>)}</tr>
          ))}
          {rodape && (
            <tr className="font-semibold">{rodape.map((c, j) => <td key={j} className="px-2 py-1">{c ?? ""}</td>)}</tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Grafico({ data, keys, unidade }: { data: Record<string, string | number | null>[]; keys: string[]; unidade: string }) {
  if (data.length === 0 || keys.length === 0) return null;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={BD} />
          <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit={unidade === "R$" ? "" : ` ${unidade}`} />
          <Tooltip />
          <Legend />
          {keys.map((k, i) => (
            <Line key={k} type="monotone" dataKey={k} stroke={CORES[i % CORES.length]} strokeWidth={2} dot={{ r: 3 }} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function exportar(tipo: Tipo, dados: Linha | null, agrupar: Agrupar) {
  if (!dados) return;
  if (tipo === "consumo") {
    const veiculos = (dados.veiculos as Linha[]) ?? [];
    baixarCsv("frota-consumo", ["Veículo", "Km", "Litros", "Km/l"], veiculos.map((v) => [String(v.placa), Number(v.km), Number(v.litros), v.consumo_km_l == null ? null : Number(v.consumo_km_l)]));
  } else if (tipo === "rodagem") {
    const linhas = (dados.linhas as Linha[]) ?? [];
    baixarCsv(`frota-rodagem-${agrupar}`, [agrupar, "Km", "Viagens"], linhas.map((l) => [String(l.rotulo), Number(l.km), Number(l.viagens)]));
  } else if (tipo === "multas") {
    const linhas = (dados.linhas as Linha[]) ?? [];
    baixarCsv("frota-multas", ["Data", "Veículo", "Motorista", "Descrição", "Valor"], linhas.map((l) => [String(l.data), String(l.placa), String(l.motorista), String(l.descricao ?? ""), Number(l.valor)]));
  } else {
    const realizadas = (dados.realizadas as Linha[]) ?? [];
    baixarCsv("frota-manutencao", ["Data", "Veículo", "Tipo", "Km", "Valor", "Fornecedor"], realizadas.map((r) => [String(r.data), String(r.placa), String(r.tipo), Number(r.km), r.valor == null ? null : Number(r.valor), String(r.fornecedor ?? "")]));
  }
}
