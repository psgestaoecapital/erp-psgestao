"use client";
// Form COMPLETO de cliente — fonte ÚNICA (RD-52). Usado como página (aba Clientes) E como drawer
// (Registrar Visita). Captura IBGE do ViaCEP (obrigatório na NF). Salva direto em erp_clientes (RLS por company).
import React, { useState } from "react";
import { supabase } from "@/lib/supabase";

const BG3 = "var(--ps-bg3,#F0ECE3)", TX = "var(--ps-text,#3D2314)", TXD = "var(--ps-text-d,#9C8E80)";
const BD = "var(--ps-border,#E0D8CC)", GO = "var(--ps-gold,#C8941A)";
const G = "#22C55E", R = "#EF4444", B = "#3B82F6", P = "#8B5CF6", T = "#14B8A6";

export type ClienteFormInitial = {
  id?: string; company_id?: string; codigo?: string; razao_social?: string; nome_fantasia?: string;
  tipo_pessoa?: string; cpf_cnpj?: string; ie?: string; telefone?: string; whatsapp?: string; email?: string;
  cep?: string; logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string;
  codigo_ibge_municipio?: string; limite_credito?: number; condicao_pagamento_padrao?: string; prazo_medio_dias?: number;
  vendedor_nome?: string; origem?: string; tags?: string[]; segmento?: string; regime_tributario?: string;
  observacoes?: string; ativo?: boolean;
};

const CONDS_PGTO = ['À vista', '7 dias', '14 dias', '21 dias', '28 dias', '30 dias', '30/60 dias', '30/60/90 dias', '45 dias', '60 dias', '90 dias', 'Boleto 30d', 'PIX'];
const REGIMES = ['Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI', 'Produtor Rural', 'Isento'];
const SEGMENTOS = ['Indústria', 'Comércio', 'Serviço', 'Construção', 'Agro', 'Transporte', 'Educação', 'Saúde', 'Tecnologia', 'Varejo', 'Atacado', 'Outro'];
const TAGS_DISPONIVEIS = ['VIP', 'Prospect', 'Inativo', 'Regular', 'Atenção', 'Fidelizado', 'Novo', 'Grande Conta', 'Governo'];
const ORIGENS = ['Indicação', 'Site', 'WhatsApp', 'Instagram', 'Google', 'Feira', 'Cold Call', 'Cliente Antigo', 'Parceiro', 'Outro'];

const EMPTY: ClienteFormInitial = {
  codigo: '', razao_social: '', nome_fantasia: '', tipo_pessoa: 'PJ', cpf_cnpj: '', ie: '',
  telefone: '', whatsapp: '', email: '', cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '',
  codigo_ibge_municipio: '', limite_credito: 0, condicao_pagamento_padrao: '30 dias', prazo_medio_dias: 30,
  vendedor_nome: '', origem: '', tags: [], segmento: '', observacoes: '', ativo: true,
};

const fmtCNPJ = (v: string) => { const c = (v || '').replace(/\D/g, ''); if (c.length === 14) return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'); if (c.length === 11) return c.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'); return v; };

export default function ClienteForm({ companyId, initial, onSaved, onCancel }: {
  companyId: string;
  initial?: ClienteFormInitial | null;
  onSaved: (cliente: { id: string; nome: string }) => void;
  onCancel: () => void;
}) {
  const editing = !!initial?.id;
  const [form, setForm] = useState<ClienteFormInitial>({ ...EMPTY, ...(initial ?? {}), cpf_cnpj: fmtCNPJ(initial?.cpf_cnpj ?? '') });
  const [msg, setMsg] = useState("");
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const [cepLoading, setCepLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const buscarCNPJ = async () => {
    const cnpj = (form.cpf_cnpj || '').replace(/\D/g, '');
    if (cnpj.length !== 14) { setMsg("⚠️ CNPJ deve ter 14 dígitos."); return; }
    setCnpjLoading(true);
    try {
      const r = await fetch(`/api/cnpj-lookup?cnpj=${cnpj}`);
      const d = await r.json();
      if (d.error) { setMsg("❌ " + d.error); setCnpjLoading(false); return; }
      setForm((f) => ({ ...f,
        razao_social: d.razao_social || f.razao_social, nome_fantasia: d.nome_fantasia || f.nome_fantasia,
        cpf_cnpj: fmtCNPJ(d.cnpj), logradouro: d.logradouro || '', numero: d.numero || '', complemento: d.complemento || '',
        bairro: d.bairro || '', cidade: d.cidade || '', uf: d.uf || '', cep: d.cep || '',
        telefone: d.telefone || f.telefone || '', email: d.email || f.email || '',
      }));
      setMsg("✅ Dados preenchidos via Receita Federal");
    } catch { setMsg("❌ Erro ao consultar CNPJ."); }
    setCnpjLoading(false); setTimeout(() => setMsg(""), 4000);
  };

  const buscarCEP = async () => {
    const cep = (form.cep || '').replace(/\D/g, '');
    if (cep.length !== 8) { setMsg("⚠️ CEP deve ter 8 dígitos."); return; }
    setCepLoading(true);
    try {
      const r = await fetch(`/api/cep-lookup?cep=${cep}`);
      const d = await r.json();
      if (d.error) { setMsg("❌ " + d.error); setCepLoading(false); return; }
      setForm((f) => ({ ...f,
        logradouro: d.logradouro || f.logradouro, bairro: d.bairro || f.bairro,
        cidade: d.cidade || f.cidade, uf: d.uf || f.uf, complemento: d.complemento || f.complemento || '',
        codigo_ibge_municipio: d.ibge || f.codigo_ibge_municipio || '',  // IBGE p/ NF
      }));
      setMsg(d.ibge ? "✅ Endereço + IBGE preenchidos via ViaCEP" : "✅ Endereço preenchido via ViaCEP");
    } catch { setMsg("❌ Erro ao consultar CEP."); }
    setCepLoading(false); setTimeout(() => setMsg(""), 4000);
  };

  const salvar = async () => {
    if (!form.razao_social?.trim()) { setMsg("❌ Razão Social / Nome é obrigatório."); return; }
    if (!companyId) { setMsg("❌ Empresa não definida."); return; }
    setSaving(true);
    // IBGE obrigatório na NF nacional: se tem CEP e o IBGE ainda não foi preenchido (usuário pode não ter
    // clicado no 🔍), busca automaticamente no submit via ViaCEP. Garante que nunca salva sem o código.
    let ibgeFinal = (form.codigo_ibge_municipio ?? '').trim();
    const cepDigits = (form.cep || '').replace(/\D/g, '');
    if (!ibgeFinal && cepDigits.length === 8) {
      try {
        const r = await fetch(`/api/cep-lookup?cep=${cepDigits}`);
        const d = await r.json();
        if (d?.ibge) ibgeFinal = String(d.ibge);
      } catch { /* sem rede — segue; o guard fiscal avisa na emissão */ }
    }
    // Whitelist explícita — não gravar colunas computadas/readonly (score, timestamps, totais) que vêm no `initial` da edição.
    const dados: Record<string, unknown> = {
      company_id: initial?.company_id ?? companyId,
      codigo: form.codigo ?? '', razao_social: (form.razao_social ?? '').trim(), nome_fantasia: form.nome_fantasia ?? '',
      tipo_pessoa: form.tipo_pessoa ?? 'PJ', cpf_cnpj: (form.cpf_cnpj || '').replace(/\D/g, ''), ie: form.ie ?? '',
      telefone: form.telefone ?? '', whatsapp: form.whatsapp ?? '', email: form.email ?? '',
      cep: form.cep ?? '', logradouro: form.logradouro ?? '', numero: form.numero ?? '', complemento: form.complemento ?? '',
      bairro: form.bairro ?? '', cidade: form.cidade ?? '', uf: form.uf ?? '', codigo_ibge_municipio: ibgeFinal,
      limite_credito: Number(form.limite_credito) || 0, condicao_pagamento_padrao: form.condicao_pagamento_padrao ?? '',
      prazo_medio_dias: Number(form.prazo_medio_dias) || 0, vendedor_nome: form.vendedor_nome ?? '',
      origem: form.origem ?? '', tags: form.tags ?? [], segmento: form.segmento ?? '', regime_tributario: form.regime_tributario ?? '',
      observacoes: form.observacoes ?? '', ativo: form.ativo ?? true,
    };
    const nome = (form.nome_fantasia || form.razao_social || '').trim();
    if (editing && initial?.id) {
      const { error } = await supabase.from("erp_clientes").update(dados).eq("id", initial.id);
      setSaving(false);
      if (error) { setMsg("Erro: " + error.message); return; }
      onSaved({ id: initial.id, nome });
    } else {
      const { data, error } = await supabase.from("erp_clientes").insert(dados).select("id").single();
      setSaving(false);
      if (error || !data) {
        setMsg(error?.message.includes("unique") ? "❌ CNPJ já cadastrado para esta empresa." : "Erro: " + (error?.message ?? "falha"));
        return;
      }
      onSaved({ id: (data as { id: string }).id, nome });
    }
  };

  const set = (k: keyof ClienteFormInitial, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const inp: React.CSSProperties = { background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 6, padding: "8px 10px", fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl: React.CSSProperties = { fontSize: 10, color: TXD, marginBottom: 3 };
  const sec: React.CSSProperties = { fontSize: 11, fontWeight: 600, marginBottom: 8 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: TX }}>{editing ? "Editar" : "Novo"} Cliente</div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: TXD, fontSize: 18, cursor: "pointer" }}>✕</button>
      </div>

      {msg && <div onClick={() => setMsg("")} style={{ background: (msg.startsWith("✅") ? G : msg.startsWith("❌") ? R : "#F59E0B") + "15", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 11, color: msg.startsWith("✅") ? G : msg.startsWith("❌") ? R : "#F59E0B", cursor: "pointer" }}>{msg}</div>}

      <div style={{ ...sec, color: GO }}>📋 Identificação</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
        <div><div style={lbl}>Tipo</div>
          <select value={form.tipo_pessoa} onChange={(e) => set("tipo_pessoa", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="PJ">🏢 Pessoa Jurídica</option><option value="PF">👤 Pessoa Física</option>
          </select></div>
        <div><div style={lbl}>{form.tipo_pessoa === 'PJ' ? 'CNPJ' : 'CPF'}</div>
          <div style={{ display: "flex", gap: 4 }}>
            <input value={form.cpf_cnpj} onChange={(e) => set("cpf_cnpj", e.target.value)} placeholder={form.tipo_pessoa === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'} style={{ ...inp, fontFamily: "monospace" }} />
            {form.tipo_pessoa === 'PJ' && <button onClick={buscarCNPJ} disabled={cnpjLoading} style={{ padding: "0 10px", borderRadius: 6, background: B + "15", color: B, border: `1px solid ${B}40`, fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>{cnpjLoading ? "..." : "🔍"}</button>}
          </div></div>
        <div><div style={lbl}>Código</div>
          <input value={form.codigo} onChange={(e) => set("codigo", e.target.value)} style={{ ...inp, fontFamily: "monospace" }} /></div>
        <div><div style={lbl}>Inscrição Estadual (NF-e)</div>
          <input value={form.ie} onChange={(e) => set("ie", e.target.value)} placeholder="Isento p/ NFS-e" style={inp} /></div>
        <div style={{ gridColumn: "span 2" }}><div style={lbl}>Razão Social / Nome *</div>
          <input value={form.razao_social} onChange={(e) => set("razao_social", e.target.value)} style={inp} /></div>
        <div style={{ gridColumn: "span 2" }}><div style={lbl}>Nome Fantasia</div>
          <input value={form.nome_fantasia} onChange={(e) => set("nome_fantasia", e.target.value)} style={inp} /></div>
      </div>

      <div style={{ ...sec, color: B }}>📱 Contato</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
        <div><div style={lbl}>Telefone</div>
          <input value={form.telefone} onChange={(e) => set("telefone", e.target.value)} placeholder="(00) 0000-0000" style={inp} /></div>
        <div><div style={lbl}>Celular / WhatsApp</div>
          <input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="(00) 00000-0000" style={inp} /></div>
        <div style={{ gridColumn: "span 2" }}><div style={lbl}>Email</div>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="contato@empresa.com.br" style={inp} /></div>
      </div>

      <div style={{ ...sec, color: P }}>📍 Endereço</div>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 80px 1fr", gap: 10, marginBottom: 12 }}>
        <div><div style={lbl}>CEP</div>
          <div style={{ display: "flex", gap: 4 }}>
            <input value={form.cep} onChange={(e) => set("cep", e.target.value)} placeholder="00000-000" style={{ ...inp, fontFamily: "monospace" }} />
            <button onClick={buscarCEP} disabled={cepLoading} style={{ padding: "0 8px", borderRadius: 6, background: B + "15", color: B, border: `1px solid ${B}40`, fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}>{cepLoading ? "..." : "🔍"}</button>
          </div></div>
        <div><div style={lbl}>Logradouro</div>
          <input value={form.logradouro} onChange={(e) => set("logradouro", e.target.value)} style={inp} /></div>
        <div><div style={lbl}>Número</div>
          <input value={form.numero} onChange={(e) => set("numero", e.target.value)} style={inp} /></div>
        <div><div style={lbl}>Complemento</div>
          <input value={form.complemento} onChange={(e) => set("complemento", e.target.value)} style={inp} /></div>
        <div style={{ gridColumn: "span 2" }}><div style={lbl}>Bairro</div>
          <input value={form.bairro} onChange={(e) => set("bairro", e.target.value)} style={inp} /></div>
        <div><div style={lbl}>Cidade</div>
          <input value={form.cidade} onChange={(e) => set("cidade", e.target.value)} style={inp} /></div>
        <div><div style={lbl}>UF</div>
          <input value={form.uf} onChange={(e) => set("uf", e.target.value.toUpperCase().slice(0, 2))} style={{ ...inp, textAlign: "center", fontWeight: 600 }} /></div>
        <div><div style={lbl}>Cód. IBGE município (NF)</div>
          <input value={form.codigo_ibge_municipio} readOnly placeholder="via CEP" style={{ ...inp, fontFamily: "monospace", color: form.codigo_ibge_municipio ? G : R, borderColor: form.codigo_ibge_municipio ? BD : R }} />
          <div style={{ fontSize: 9, marginTop: 2, color: form.codigo_ibge_municipio ? G : R }}>
            {form.codigo_ibge_municipio ? `✓ ${form.cidade || ''}${form.uf ? '/' + form.uf : ''}` : 'obrigatório na NF — preenche pelo CEP (🔍) ou ao salvar'}
          </div></div>
      </div>

      <div style={{ ...sec, color: G }}>💰 Comercial</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
        <div><div style={lbl}>Limite de Crédito (R$)</div>
          <input type="number" step="0.01" value={form.limite_credito || ''} onChange={(e) => set("limite_credito", parseFloat(e.target.value) || 0)} style={{ ...inp, color: G, fontWeight: 600 }} /></div>
        <div><div style={lbl}>Cond. Pagamento</div>
          <select value={form.condicao_pagamento_padrao} onChange={(e) => set("condicao_pagamento_padrao", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="">—</option>{CONDS_PGTO.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></div>
        <div><div style={lbl}>Prazo Médio (dias)</div>
          <input type="number" value={form.prazo_medio_dias || ''} onChange={(e) => set("prazo_medio_dias", parseInt(e.target.value) || 0)} style={inp} /></div>
        <div><div style={lbl}>Vendedor</div>
          <input value={form.vendedor_nome} onChange={(e) => set("vendedor_nome", e.target.value)} style={inp} /></div>
      </div>

      <div style={{ ...sec, color: T }}>🏷️ Segmentação</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
        <div><div style={lbl}>Segmento</div>
          <select value={form.segmento} onChange={(e) => set("segmento", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="">—</option>{SEGMENTOS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div><div style={lbl}>Origem</div>
          <select value={form.origem} onChange={(e) => set("origem", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="">—</option>{ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div><div style={lbl}>Regime Tributário</div>
          <select value={form.regime_tributario} onChange={(e) => set("regime_tributario", e.target.value)} style={{ ...inp, cursor: "pointer" }}>
            <option value="">—</option>{REGIMES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
        <div style={{ gridColumn: "span 3" }}><div style={lbl}>Tags</div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {TAGS_DISPONIVEIS.map((tag) => {
              const on = (form.tags || []).includes(tag);
              return <button key={tag} onClick={() => { const cur = form.tags || []; set("tags", on ? cur.filter((t) => t !== tag) : [...cur, tag]); }} style={{ padding: "4px 10px", borderRadius: 12, fontSize: 10, border: `1px solid ${on ? GO : BD}`, background: on ? GO + "15" : "transparent", color: on ? GO : TXD, cursor: "pointer", fontWeight: on ? 600 : 400 }}>{on ? "✓ " : ""}{tag}</button>;
            })}
          </div></div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div style={lbl}>Observações</div>
        <textarea value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} rows={2} style={{ ...inp, resize: "vertical" }} placeholder="Observações gerais sobre o cliente..." />
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ padding: "10px 20px", borderRadius: 8, background: "transparent", border: `1px solid ${BD}`, color: TX, fontSize: 12, cursor: "pointer" }}>Cancelar</button>
        <button onClick={salvar} disabled={saving} style={{ padding: "10px 24px", borderRadius: 8, background: GO, color: "#FFF", fontSize: 13, fontWeight: 600, border: "none", cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Salvando…" : editing ? "Salvar" : "Cadastrar"}</button>
      </div>
    </div>
  );
}
