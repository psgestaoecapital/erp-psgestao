"use client";
import React, { Suspense, useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// ═══ CORES (adaptam ao tema claro/escuro) ═══
const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

const fmtR=(v:number)=>v===0?"—":`R$ ${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtP=(v:number)=>v===0?"—":`${v>0?"+":""}${v.toFixed(1)}%`;
const STATUS_EXCL=new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

type Lanc={valor:number;categoria:string;catCod:string;tipo:string;nome:string;doc:string;data:string;status:string;linha:string};

// ═══ PLANO DE CONTAS REFERENCIAL RFB ═══
const PLANO_CONTAS_REF: Record<string,{codigo:string;descricao:string;natureza:string}>={
  // Receitas
  "receita":{codigo:"3.01",descricao:"RECEITA BRUTA DE VENDAS E SERVIÇOS",natureza:"C"},
  "venda":{codigo:"3.01.01",descricao:"Venda de Mercadorias",natureza:"C"},
  "servico":{codigo:"3.01.02",descricao:"Prestação de Serviços",natureza:"C"},
  // Deduções
  "imposto":{codigo:"3.02",descricao:"DEDUÇÕES DA RECEITA BRUTA",natureza:"D"},
  "icms":{codigo:"3.02.01",descricao:"ICMS sobre Vendas",natureza:"D"},
  "iss":{codigo:"3.02.02",descricao:"ISS sobre Serviços",natureza:"D"},
  "pis":{codigo:"3.02.03",descricao:"PIS sobre Faturamento",natureza:"D"},
  "cofins":{codigo:"3.02.04",descricao:"COFINS sobre Faturamento",natureza:"D"},
  "simples":{codigo:"3.02.05",descricao:"Simples Nacional (DAS)",natureza:"D"},
  "irpj":{codigo:"3.02.06",descricao:"IRPJ",natureza:"D"},
  "csll":{codigo:"3.02.07",descricao:"CSLL",natureza:"D"},
  // CMV
  "cmv":{codigo:"3.03",descricao:"CUSTO DAS MERCADORIAS VENDIDAS",natureza:"D"},
  "material":{codigo:"3.03.01",descricao:"Matéria-prima e Materiais",natureza:"D"},
  "mao de obra":{codigo:"3.03.02",descricao:"Mão de Obra Direta",natureza:"D"},
  "folha":{codigo:"3.03.03",descricao:"Folha de Pagamento",natureza:"D"},
  "encargo":{codigo:"3.03.04",descricao:"Encargos Sociais (FGTS/INSS)",natureza:"D"},
  // Despesas operacionais
  "aluguel":{codigo:"3.04.01",descricao:"Aluguel e Condomínio",natureza:"D"},
  "energia":{codigo:"3.04.02",descricao:"Energia Elétrica",natureza:"D"},
  "telefone":{codigo:"3.04.03",descricao:"Telecomunicações",natureza:"D"},
  "marketing":{codigo:"3.04.04",descricao:"Marketing e Publicidade",natureza:"D"},
  "manutencao":{codigo:"3.04.05",descricao:"Manutenção e Reparos",natureza:"D"},
  "seguro":{codigo:"3.04.06",descricao:"Seguros",natureza:"D"},
  "honorario":{codigo:"3.04.07",descricao:"Honorários Profissionais",natureza:"D"},
  "viagem":{codigo:"3.04.08",descricao:"Viagens e Deslocamentos",natureza:"D"},
  "software":{codigo:"3.04.09",descricao:"Software e Tecnologia",natureza:"D"},
  // Financeiro
  "juros":{codigo:"3.05.01",descricao:"Juros Pagos",natureza:"D"},
  "financiamento":{codigo:"3.05.02",descricao:"Financiamentos e Empréstimos",natureza:"D"},
  "taxa bancária":{codigo:"3.05.03",descricao:"Tarifas Bancárias",natureza:"D"},
  "iof":{codigo:"3.05.04",descricao:"IOF",natureza:"D"},
};

function matchPlanoContas(cat:string,nome:string):{codigo:string;descricao:string;natureza:string}{
  const lc=cat.toLowerCase()+" "+nome.toLowerCase();
  for(const[kw,ref]of Object.entries(PLANO_CONTAS_REF)){
    if(lc.includes(kw))return ref;
  }
  if(lc.includes("receb")||lc.includes("fatura"))return PLANO_CONTAS_REF["receita"];
  return{codigo:"3.09.99",descricao:"Outras Despesas/Receitas",natureza:"D"};
}

function classifyDRE(cat:string,nome:string):string{
  const c=cat.toLowerCase(),n=nome.toLowerCase();
  if(c.startsWith("3.04")||n.includes("imposto")||n.includes("icms")||n.includes("iss")||n.includes("pis")||n.includes("cofins")||n.includes("das")||n.includes("irpj")||n.includes("csll")||n.includes("simples")||n.includes("darf")||n.includes("tribut"))return"impostos";
  if(c.startsWith("4.")||c.startsWith("5.")||n.includes("juros")||n.includes("financiamento")||n.includes("parcela")||n.includes("empréstimo")||n.includes("emprestimo")||n.includes("pronampe")||n.includes("bndes")||n.includes("taxa bancária")||n.includes("iof"))return"financeiro";
  if(c.startsWith("2.01")||c.startsWith("2.02")||c.startsWith("2.03")||n.includes("cmv")||n.includes("matéria")||n.includes("material")||n.includes("insumo")||n.includes("mercadoria")||n.includes("mão de obra")||n.includes("mao de obra")||n.includes("folha")||n.includes("salário")||n.includes("salario")||n.includes("encargo")||n.includes("fgts")||n.includes("inss")||n.includes("férias")||n.includes("13")||n.includes("gps"))return"custos";
  return"despesas";
}

// ═══ TABS ═══
const TABS=["DRE","Balancete","Razão","Impostos","SPED","Reforma","Exportar"] as const;
type Tab=typeof TABS[number];

function ContadorPageInner(){
  const searchParams=useSearchParams();
  const empresaParam=searchParams.get("empresa");
  const[companies,setCompanies]=useState<any[]>([]);
  const[sel,setSel]=useState("");
  const[selName,setSelName]=useState("");
  const[selCNPJ,setSelCNPJ]=useState("");
  const[mesAno,setMesAno]=useState(()=>{const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const[loading,setLoading]=useState(true);
  const[tab,setTab]=useState<Tab>("DRE");
  const[lancamentos,setLancamentos]=useState<Lanc[]>([]);
  const[razaoCat,setRazaoCat]=useState("");
  const[ano,mes]=mesAno.split("-").map(Number);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel)loadData();},[sel,mesAno]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=empresaParam||(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;const chosen=m||d[0];setSel(chosen.id);setSelName(chosen.nome_fantasia||chosen.razao_social||"");setSelCNPJ(chosen.cnpj||"");}
    setLoading(false);
  };

  const parseMesAno=(dt:string):boolean=>{
    if(!dt)return false;
    const p1=dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(p1){let a=parseInt(p1[3]);if(p1[3].length===2)a+=2000;return a===ano&&parseInt(p1[2])===mes;}
    const p2=dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if(p2)return parseInt(p2[1])===ano&&parseInt(p2[2])===mes;
    return false;
  };

  const loadData=async()=>{
    setLoading(true);
    const comp=companies.find(c=>c.id===sel);
    if(comp){setSelName(comp.nome_fantasia||comp.razao_social||"");setSelCNPJ(comp.cnpj||"");}
    const cIds=[sel];
    const[{data:imports},{data:blData}]=await Promise.all([
      supabase.from("omie_imports").select("import_type,import_data").in("company_id",cIds),
      supabase.from("business_lines").select("*,business_line_keywords(keyword,prioridade)").in("company_id",cIds).order("ln_number"),
    ]);
    const cliMap:Record<string,string>={};const catMap:Record<string,string>={};
    if(imports)for(const imp of imports){
      if(imp.import_type==="clientes"){const cls=imp.import_data?.clientes_cadastro||[];if(Array.isArray(cls))for(const c of cls){const cod=c.codigo_cliente_omie||c.codigo_cliente||c.codigo;cliMap[String(cod)]=c.nome_fantasia||c.razao_social||c.nome||"";}}
      if(imp.import_type==="categorias"){const cats=imp.import_data?.categoria_cadastro||[];if(Array.isArray(cats))for(const c of cats){const cod=c.codigo||c.cCodigo||"";if(cod)catMap[cod]=c.descricao||c.cDescricao||"";}}
    }
    const lns=(blData||[]).map((b:any)=>({id:b.id,nome:b.name||b.nome||"",keywords:(b.business_line_keywords||[]).map((k:any)=>({kw:(k.keyword||"").toLowerCase(),pr:k.prioridade||1})).sort((a:any,b:any)=>b.pr-a.pr)}));
    const matchLinha=(catN:string):string=>{let best="Geral";let bestScore=0;for(const ln of lns){const catLow=catN.toLowerCase();for(const k of ln.keywords){if(catLow.includes(k.kw)&&k.pr>bestScore){bestScore=k.pr;best=ln.nome;}}if(bestScore===0&&ln.nome&&catLow.includes(ln.nome.toLowerCase())){bestScore=1;best=ln.nome;}}return best;};

    const result:Lanc[]=[];
    if(imports)for(const imp of imports){
      if(imp.import_type==="contas_receber"){const regs=imp.import_data?.conta_receber_cadastro||[];if(Array.isArray(regs))for(const r of regs){const st=(r.status_titulo||"").toUpperCase();if(STATUS_EXCL.has(st))continue;const v=Number(r.valor_documento)||0;if(v<=0)continue;const dt=r.data_previsao||r.data_vencimento||"";if(!parseMesAno(dt))continue;const cf=String(r.codigo_cliente_fornecedor||"");const nome=cliMap[cf]||`Cliente ${cf}`;const cat=r.codigo_categoria||"";const catN=catMap[cat]||r.descricao_categoria||cat;result.push({valor:v,categoria:catN,catCod:cat,tipo:"receber",nome,doc:r.numero_documento||"",data:dt,status:r.status_titulo||"",linha:matchLinha(catN)});}}
      if(imp.import_type==="contas_pagar"){const regs=imp.import_data?.conta_pagar_cadastro||[];if(Array.isArray(regs))for(const r of regs){const st=(r.status_titulo||"").toUpperCase();if(STATUS_EXCL.has(st))continue;const v=Number(r.valor_documento)||0;if(v<=0)continue;const dt=r.data_previsao||r.data_vencimento||"";if(!parseMesAno(dt))continue;const cat=r.codigo_categoria||"sem_cat";const catN=catMap[cat]||r.descricao_categoria||cat;const cf=String(r.codigo_cliente_fornecedor||"");const forn=r.observacao||cliMap[cf]||`Forn ${cf}`;result.push({valor:v,categoria:catN,catCod:cat,tipo:"pagar",nome:forn,doc:r.numero_documento||"",data:dt,status:r.status_titulo||"",linha:matchLinha(catN)});}}
    }
    const{data:erpRec}=await supabase.from("erp_lancamentos").select("*").eq("tipo","receber").in("company_id",cIds).neq("status","CANCELADO");
    if(erpRec)for(const r of erpRec){const v=Number(r.valor_documento)||0;if(v<=0)continue;const dt=r.data_previsao||r.data_vencimento||"";if(!parseMesAno(dt))continue;result.push({valor:v,categoria:r.subcategoria||r.categoria||"Outros",catCod:"",tipo:"receber",nome:r.nome_pessoa||"Cliente",doc:r.numero_documento||"",data:dt,status:r.status||"",linha:matchLinha(r.subcategoria||r.categoria||"")});}
    const{data:erpPag}=await supabase.from("erp_lancamentos").select("*").eq("tipo","pagar").in("company_id",cIds).neq("status","CANCELADO");
    if(erpPag)for(const r of erpPag){const v=Number(r.valor_documento)||0;if(v<=0)continue;const dt=r.data_previsao||r.data_vencimento||"";if(!parseMesAno(dt))continue;result.push({valor:v,categoria:r.subcategoria||r.categoria||"Outros",catCod:"",tipo:"pagar",nome:r.nome_pessoa||"Fornecedor",doc:r.numero_documento||"",data:dt,status:r.status||"",linha:matchLinha(r.subcategoria||r.categoria||"")});}
    setLancamentos(result);setLoading(false);
  };

  // ═══ CÁLCULOS ═══
  const receitas=lancamentos.filter(l=>l.tipo==="receber");
  const despesas=lancamentos.filter(l=>l.tipo==="pagar");
  const tRec=receitas.reduce((s,l)=>s+l.valor,0);
  const impostos=despesas.filter(l=>classifyDRE(l.catCod,l.categoria)==="impostos");
  const custos=despesas.filter(l=>classifyDRE(l.catCod,l.categoria)==="custos");
  const despOp=despesas.filter(l=>classifyDRE(l.catCod,l.categoria)==="despesas");
  const financeiro=despesas.filter(l=>classifyDRE(l.catCod,l.categoria)==="financeiro");
  const tImp=impostos.reduce((s,l)=>s+l.valor,0);
  const tCst=custos.reduce((s,l)=>s+l.valor,0);
  const tDsp=despOp.reduce((s,l)=>s+l.valor,0);
  const tFin=financeiro.reduce((s,l)=>s+l.valor,0);
  const margem=tRec-tImp-tCst;const ebitda=margem-tDsp;const resultado=ebitda-tFin;

  const linhas=useMemo(()=>{
    const map:Record<string,{rec:number;imp:number;cst:number;dsp:number;fin:number}>={};
    for(const l of receitas){if(!map[l.linha])map[l.linha]={rec:0,imp:0,cst:0,dsp:0,fin:0};map[l.linha].rec+=l.valor;}
    for(const l of despesas){const cls=classifyDRE(l.catCod,l.categoria);if(!map[l.linha])map[l.linha]={rec:0,imp:0,cst:0,dsp:0,fin:0};if(cls==="impostos")map[l.linha].imp+=l.valor;else if(cls==="custos")map[l.linha].cst+=l.valor;else if(cls==="financeiro")map[l.linha].fin+=l.valor;else map[l.linha].dsp+=l.valor;}
    return Object.entries(map).sort((a,b)=>b[1].rec-a[1].rec);
  },[lancamentos]);

  const balancete=useMemo(()=>{
    const map:Record<string,{debito:number;credito:number;ref:ReturnType<typeof matchPlanoContas>}>={};
    for(const l of lancamentos){const cat=l.categoria||"Sem Categoria";if(!map[cat])map[cat]={debito:0,credito:0,ref:matchPlanoContas(l.catCod,l.categoria)};if(l.tipo==="pagar")map[cat].debito+=l.valor;else map[cat].credito+=l.valor;}
    return Object.entries(map).sort((a,b)=>(a[1].ref.codigo).localeCompare(b[1].ref.codigo));
  },[lancamentos]);

  const razaoLancs=useMemo(()=>{
    const filtered=razaoCat?lancamentos.filter(l=>l.categoria===razaoCat):lancamentos;
    return filtered.sort((a,b)=>a.data.localeCompare(b.data));
  },[lancamentos,razaoCat]);

  const impostosDetail=useMemo(()=>{
    const map:Record<string,number>={};
    for(const l of impostos){const k=l.categoria||"Outros Impostos";map[k]=(map[k]||0)+l.valor;}
    return Object.entries(map).sort((a,b)=>b[1]-a[1]);
  },[impostos]);

  // ═══ EXPORTS ═══
  const downloadFile=(content:string,filename:string,mime:string)=>{
    const blob=new Blob(["\ufeff"+content],{type:mime+";charset=utf-8;"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  };

  const exportDRE=()=>{
    const rows=[`DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO`,`Empresa: ${selName}`,`CNPJ: ${selCNPJ}`,`Período: ${mesAno}`,`Gerado em: ${new Date().toLocaleString("pt-BR")}`,``,
      `Conta;Valor (R$);AV (%)`,
      `RECEITA BRUTA;${tRec.toFixed(2)};100.0%`,
      `(-) Impostos e Tributos;${tImp.toFixed(2)};${tRec>0?((tImp/tRec)*100).toFixed(1):"0.0"}%`,
      `(-) Custos Diretos (CMV);${tCst.toFixed(2)};${tRec>0?((tCst/tRec)*100).toFixed(1):"0.0"}%`,
      `= MARGEM BRUTA;${margem.toFixed(2)};${tRec>0?((margem/tRec)*100).toFixed(1):"0.0"}%`,
      `(-) Despesas Operacionais;${tDsp.toFixed(2)};${tRec>0?((tDsp/tRec)*100).toFixed(1):"0.0"}%`,
      `= EBITDA;${ebitda.toFixed(2)};${tRec>0?((ebitda/tRec)*100).toFixed(1):"0.0"}%`,
      `(-) Resultado Financeiro;${tFin.toFixed(2)};${tRec>0?((tFin/tRec)*100).toFixed(1):"0.0"}%`,
      `= RESULTADO LÍQUIDO;${resultado.toFixed(2)};${tRec>0?((resultado/tRec)*100).toFixed(1):"0.0"}%`,
      ``,`DRE POR LINHA DE NEGÓCIO`,`Linha;Receita;Impostos;Custos;Despesas;Financeiro;Resultado;Margem`,
      ...linhas.map(([n,v])=>{const res=v.rec-v.imp-v.cst-v.dsp-v.fin;return`${n};${v.rec.toFixed(2)};${v.imp.toFixed(2)};${v.cst.toFixed(2)};${v.dsp.toFixed(2)};${v.fin.toFixed(2)};${res.toFixed(2)};${v.rec>0?((res/v.rec)*100).toFixed(1):"0.0"}%`;}),
    ].join("\n");
    downloadFile(rows,`DRE_${selName.replace(/\s/g,"_")}_${mesAno}.csv`,"text/csv");
  };

  const exportBalancete=()=>{
    const rows=[`BALANCETE DE VERIFICAÇÃO`,`Empresa: ${selName}`,`CNPJ: ${selCNPJ}`,`Período: ${mesAno}`,``,
      `Código Ref.;Conta;Descrição Referencial;Natureza;Débito;Crédito;Saldo`,
      ...balancete.map(([cat,v])=>`${v.ref.codigo};${cat};${v.ref.descricao};${v.ref.natureza};${v.debito.toFixed(2)};${v.credito.toFixed(2)};${(v.credito-v.debito).toFixed(2)}`),
      `;;TOTAL;;${balancete.reduce((s,[,v])=>s+v.debito,0).toFixed(2)};${balancete.reduce((s,[,v])=>s+v.credito,0).toFixed(2)};${resultado.toFixed(2)}`,
    ].join("\n");
    downloadFile(rows,`Balancete_${selName.replace(/\s/g,"_")}_${mesAno}.csv`,"text/csv");
  };

  const exportRazao=()=>{
    const rows=[`LIVRO RAZÃO`,`Empresa: ${selName}`,`CNPJ: ${selCNPJ}`,`Período: ${mesAno}`,``,
      `Data;Tipo;Cód. Ref;Categoria;Pessoa;Documento;Débito;Crédito;Linha Negócio`,
      ...lancamentos.sort((a,b)=>a.data.localeCompare(b.data)).map(l=>{const ref=matchPlanoContas(l.catCod,l.categoria);return`${l.data};${l.tipo==="receber"?"C":"D"};${ref.codigo};${l.categoria};${l.nome};${l.doc};${l.tipo==="pagar"?l.valor.toFixed(2):"0.00"};${l.tipo==="receber"?l.valor.toFixed(2):"0.00"};${l.linha}`;}),
    ].join("\n");
    downloadFile(rows,`Razao_${selName.replace(/\s/g,"_")}_${mesAno}.csv`,"text/csv");
  };

  const exportSPED=()=>{
    const dtIni=`01${String(mes).padStart(2,"0")}${ano}`;
    const dtFim=`${new Date(ano,mes,0).getDate()}${String(mes).padStart(2,"0")}${ano}`;
    const cnpj=(selCNPJ||"").replace(/\D/g,"");
    const lines:string[]=[
      `|0000|LECD|${dtIni}|${dtFim}|${selName}|${cnpj}|||SC|0||`,
      `|0001|0|`,
      `|I001|0|`,
      `|I010|G|`,
    ];
    // I050 — Plano de contas
    const usedRefs=new Set<string>();
    for(const[,v]of balancete){usedRefs.add(v.ref.codigo);}
    const sortedRefs=[...usedRefs].sort();
    for(const cod of sortedRefs){
      const ref=Object.values(PLANO_CONTAS_REF).find(r=>r.codigo===cod);
      if(ref)lines.push(`|I050|${dtIni}|${ref.codigo}|${ref.natureza==="D"?"02":"01"}|A|${ref.codigo}|1|${ref.descricao}|`);
    }
    // I150 — Saldos periódicos
    lines.push(`|I150|${dtIni}|${dtFim}|`);
    for(const[cat,v]of balancete){
      const saldo=v.credito-v.debito;
      lines.push(`|I155|${v.ref.codigo}|${v.ref.codigo}|0,00|${saldo>=0?"C":"D"}|${v.debito.toFixed(2).replace(".",",")}|${v.credito.toFixed(2).replace(".",",")}|${Math.abs(saldo).toFixed(2).replace(".",",")}|${saldo>=0?"C":"D"}|`);
    }
    // I200 + I250 — Lançamentos
    let seqLcto=1;
    for(const l of lancamentos.sort((a,b)=>a.data.localeCompare(b.data))){
      const ref=matchPlanoContas(l.catCod,l.categoria);
      const dtLcto=l.data.replace(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/,"$1$2$3").replace(/(\d{4})[\/\-](\d{2})[\/\-](\d{2})/,"$3$2$1");
      lines.push(`|I200|${String(seqLcto).padStart(6,"0")}|${dtLcto}|${l.valor.toFixed(2).replace(".",",")}|${l.tipo==="pagar"?"D":"C"}|`);
      lines.push(`|I250|${ref.codigo}|${ref.codigo}|${l.valor.toFixed(2).replace(".",",")}|${l.tipo==="pagar"?"D":"C"}|||${l.nome} - ${l.doc||"S/DOC"}|`);
      seqLcto++;
    }
    lines.push(`|I990|${lines.length+2}|`);
    lines.push(`|9999|${lines.length+1}|`);
    downloadFile(lines.join("\n"),`SPED_ECD_${selName.replace(/\s/g,"_")}_${mesAno}.txt`,"text/plain");
  };

  const exportTudo=()=>{exportDRE();setTimeout(()=>exportBalancete(),500);setTimeout(()=>exportRazao(),1000);setTimeout(()=>exportSPED(),1500);};

  // ═══ UI ═══
  const mOps:string[]=[];for(let a=2025;a<=2027;a++)for(let m=1;m<=12;m++)mOps.push(`${a}-${String(m).padStart(2,"0")}`);
  const nMes=(ma:string)=>{const[a,m]=ma.split("-");return`${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(m)-1]} ${a}`;};
  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};

  const Card=({children,style}:{children:React.ReactNode;style?:React.CSSProperties})=><div style={{background:BG2,borderRadius:10,border:`1px solid ${BD}`,overflow:"hidden",...style}}>{children}</div>;

  const dreRow=(label:string,valor:number,cor:string,bold:boolean,indent:number=0)=>(
    <tr key={label} style={{borderBottom:`0.5px solid ${BD}`,background:bold?BG3+"80":"transparent"}}>
      <td style={{padding:"8px 12px",paddingLeft:12+indent*20,fontSize:13,fontWeight:bold?700:400,color:bold?TX:TXM}}>{label}</td>
      <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,fontWeight:bold?700:400,color:valor>0?cor:valor<0?R:TXD}}>{valor===0?"—":fmtR(valor)}</td>
      <td style={{padding:"8px 12px",textAlign:"right",fontSize:11,color:TXD}}>{tRec>0?`${((Math.abs(valor)/tRec)*100).toFixed(1)}%`:"—"}</td>
    </tr>
  );

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>📒 Módulo Contador</div>
          <div style={{fontSize:11,color:TXD}}>Portal contábil completo — DRE, Balancete, Razão, Impostos, SPED ECD, Reforma Tributária</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <select value={mesAno} onChange={e=>setMesAno(e.target.value)} style={selSt}>
            {mOps.map(m=><option key={m} value={m}>{nMes(m)}</option>)}
          </select>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:6,marginBottom:16}}>
        {[{l:"Receita Bruta",v:fmtR(tRec),c:G},{l:"Impostos",v:fmtR(tImp),c:P},{l:"Margem Bruta",v:tRec>0?`${((margem/tRec)*100).toFixed(1)}%`:"—",c:margem>0?G:R},{l:"EBITDA",v:fmtR(ebitda),c:ebitda>0?G:R},{l:"Resultado",v:fmtR(resultado),c:resultado>=0?G:R},{l:"Lançamentos",v:String(lancamentos.length),c:B}].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"8px 12px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:2,marginBottom:16,borderBottom:`1px solid ${BD}`,paddingBottom:4,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"6px 14px",borderRadius:"8px 8px 0 0",fontSize:11,fontWeight:tab===t?700:400,cursor:"pointer",background:tab===t?BG2:"transparent",color:tab===t?GO:TXM,border:tab===t?`1px solid ${BD}`:"1px solid transparent",borderBottom:tab===t?`2px solid ${GO}`:"none",whiteSpace:"nowrap"}}>{t}</button>
        ))}
      </div>

      {loading&&<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando dados contábeis...</div>}

      {/* ═══ DRE ═══ */}
      {!loading&&tab==="DRE"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div><div style={{fontSize:15,fontWeight:600,color:TX}}>Demonstração do Resultado — {nMes(mesAno)}</div><div style={{fontSize:10,color:TXD}}>{selName} · CNPJ: {selCNPJ||"Não informado"}</div></div>
            <button onClick={exportDRE} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:`${G}15`,color:G,border:`1px solid ${G}30`}}>Exportar DRE</button>
          </div>
          <Card><table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{borderBottom:`2px solid ${BD}`}}><th style={{padding:"10px 12px",textAlign:"left",fontSize:10,color:TXD}}>Conta</th><th style={{padding:"10px 12px",textAlign:"right",fontSize:10,color:TXD}}>Valor (R$)</th><th style={{padding:"10px 12px",textAlign:"right",fontSize:10,color:TXD}}>AV (%)</th></tr></thead>
            <tbody>
              {dreRow("RECEITA BRUTA",tRec,G,true)}
              {dreRow("(-) Impostos e Tributos",-tImp,P,false,1)}
              {dreRow("(-) Custos Diretos (CMV)",-tCst,Y,false,1)}
              {dreRow("= MARGEM BRUTA",margem,margem>0?G:R,true)}
              {dreRow("(-) Despesas Operacionais",-tDsp,B,false,1)}
              {dreRow("= EBITDA",ebitda,ebitda>0?G:R,true)}
              {dreRow("(-) Resultado Financeiro",-tFin,R,false,1)}
              {dreRow("= RESULTADO LÍQUIDO",resultado,resultado>=0?G:R,true)}
            </tbody>
          </table></Card>

          {linhas.length>1&&(<div style={{marginTop:20}}>
            <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:10}}>DRE por Linha de Negócio</div>
            <Card style={{overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
                <th style={{padding:"8px 10px",textAlign:"left",color:TXD,fontSize:10}}>Linha</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:G,fontSize:10}}>Receita</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:P,fontSize:10}}>Impostos</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:Y,fontSize:10}}>Custos</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:B,fontSize:10}}>Desp.Op.</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:R,fontSize:10}}>Financ.</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:TX,fontSize:10,fontWeight:700}}>Resultado</th>
                <th style={{padding:"8px 10px",textAlign:"right",color:TXD,fontSize:10}}>Margem</th>
              </tr></thead>
              <tbody>{linhas.map(([nome,v])=>{const res=v.rec-v.imp-v.cst-v.dsp-v.fin;return(
                <tr key={nome} style={{borderBottom:`0.5px solid ${BD}`}}>
                  <td style={{padding:"7px 10px",fontWeight:600,color:TX}}>{nome}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:G}}>{fmtR(v.rec)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:P}}>{fmtR(v.imp)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:Y}}>{fmtR(v.cst)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:B}}>{fmtR(v.dsp)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:R}}>{fmtR(v.fin)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",fontWeight:700,color:res>=0?G:R}}>{fmtR(res)}</td>
                  <td style={{padding:"7px 10px",textAlign:"right",color:TXD}}>{v.rec>0?`${((res/v.rec)*100).toFixed(1)}%`:"—"}</td>
                </tr>);})}</tbody>
            </table></Card>
          </div>)}
        </div>
      )}

      {/* ═══ BALANCETE ═══ */}
      {!loading&&tab==="Balancete"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:15,fontWeight:600,color:TX}}>Balancete de Verificação — {nMes(mesAno)}</div>
            <button onClick={exportBalancete} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:`${B}15`,color:B,border:`1px solid ${B}30`}}>Exportar Balancete</button>
          </div>
          <Card style={{overflow:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
              <th style={{padding:"8px 10px",textAlign:"left",color:TXD,fontSize:10}}>Cód. Ref.</th>
              <th style={{padding:"8px 10px",textAlign:"left",color:TXD,fontSize:10}}>Conta / Categoria</th>
              <th style={{padding:"8px 10px",textAlign:"left",color:TXD,fontSize:10}}>Descrição Referencial</th>
              <th style={{padding:"8px 10px",textAlign:"center",color:TXD,fontSize:10}}>Nat.</th>
              <th style={{padding:"8px 10px",textAlign:"right",color:R,fontSize:10}}>Débito</th>
              <th style={{padding:"8px 10px",textAlign:"right",color:G,fontSize:10}}>Crédito</th>
              <th style={{padding:"8px 10px",textAlign:"right",color:TX,fontSize:10}}>Saldo</th>
            </tr></thead>
            <tbody>
              {balancete.map(([cat,v])=>(
                <tr key={cat} style={{borderBottom:`0.5px solid ${BD}`,cursor:"pointer"}} onClick={()=>{setRazaoCat(cat);setTab("Razão");}}>
                  <td style={{padding:"6px 10px",color:P,fontFamily:"monospace",fontSize:11}}>{v.ref.codigo}</td>
                  <td style={{padding:"6px 10px",color:TX}}>{cat}</td>
                  <td style={{padding:"6px 10px",color:TXM,fontSize:10}}>{v.ref.descricao}</td>
                  <td style={{padding:"6px 10px",textAlign:"center",color:v.ref.natureza==="D"?R:G,fontWeight:600,fontSize:10}}>{v.ref.natureza}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:v.debito>0?R:TXD}}>{v.debito>0?fmtR(v.debito):"—"}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",color:v.credito>0?G:TXD}}>{v.credito>0?fmtR(v.credito):"—"}</td>
                  <td style={{padding:"6px 10px",textAlign:"right",fontWeight:600,color:v.credito-v.debito>=0?G:R}}>{fmtR(v.credito-v.debito)}</td>
                </tr>
              ))}
              <tr style={{borderTop:`2px solid ${BD}`,background:BG3}}>
                <td colSpan={4} style={{padding:"8px 10px",fontWeight:700,color:TX}}>TOTAL</td>
                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:R}}>{fmtR(balancete.reduce((s,[,v])=>s+v.debito,0))}</td>
                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:G}}>{fmtR(balancete.reduce((s,[,v])=>s+v.credito,0))}</td>
                <td style={{padding:"8px 10px",textAlign:"right",fontWeight:700,color:resultado>=0?G:R}}>{fmtR(resultado)}</td>
              </tr>
            </tbody>
          </table></Card>
          <div style={{fontSize:10,color:TXD,marginTop:8}}>Plano de Contas Referencial RFB mapeado automaticamente. Clique em qualquer conta para ver o Razão.</div>
        </div>
      )}

      {/* ═══ RAZÃO ═══ */}
      {!loading&&tab==="Razão"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:8,flexWrap:"wrap"}}>
            <div style={{fontSize:15,fontWeight:600,color:TX}}>Livro Razão — {nMes(mesAno)}</div>
            <div style={{display:"flex",gap:8}}>
              <select value={razaoCat} onChange={e=>setRazaoCat(e.target.value)} style={{...selSt,minWidth:200}}>
                <option value="">Todas as categorias</option>
                {balancete.map(([cat])=><option key={cat} value={cat}>{cat}</option>)}
              </select>
              <button onClick={exportRazao} style={{padding:"6px 14px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",background:`${T}15`,color:T,border:`1px solid ${T}30`}}>Exportar Razão</button>
            </div>
          </div>
          <Card style={{overflow:"auto",maxHeight:"60vh"}}><table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}><tr style={{borderBottom:`2px solid ${BD}`}}>
              <th style={{padding:"8px 8px",textAlign:"left",color:TXD,fontSize:10}}>Data</th>
              <th style={{padding:"8px 8px",textAlign:"center",color:TXD,fontSize:10}}>D/C</th>
              <th style={{padding:"8px 8px",textAlign:"left",color:TXD,fontSize:10}}>Cód.</th>
              <th style={{padding:"8px 8px",textAlign:"left",color:TXD,fontSize:10}}>Categoria</th>
              <th style={{padding:"8px 8px",textAlign:"left",color:TXD,fontSize:10}}>Pessoa</th>
              <th style={{padding:"8px 8px",textAlign:"left",color:TXD,fontSize:10}}>Doc.</th>
              <th style={{padding:"8px 8px",textAlign:"right",color:R,fontSize:10}}>Débito</th>
              <th style={{padding:"8px 8px",textAlign:"right",color:G,fontSize:10}}>Crédito</th>
            </tr></thead>
            <tbody>{razaoLancs.map((l,i)=>{const ref=matchPlanoContas(l.catCod,l.categoria);return(
              <tr key={i} style={{borderBottom:`0.5px solid ${BD}`}}>
                <td style={{padding:"5px 8px",color:TX,whiteSpace:"nowrap"}}>{l.data}</td>
                <td style={{padding:"5px 8px",textAlign:"center",color:l.tipo==="receber"?G:R,fontWeight:700,fontSize:10}}>{l.tipo==="receber"?"C":"D"}</td>
                <td style={{padding:"5px 8px",color:P,fontFamily:"monospace",fontSize:10}}>{ref.codigo}</td>
                <td style={{padding:"5px 8px",color:TXM,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.categoria}</td>
                <td style={{padding:"5px 8px",color:TX,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{l.nome}</td>
                <td style={{padding:"5px 8px",color:TXD,fontSize:10}}>{l.doc||"—"}</td>
                <td style={{padding:"5px 8px",textAlign:"right",color:l.tipo==="pagar"?R:TXD}}>{l.tipo==="pagar"?fmtR(l.valor):"—"}</td>
                <td style={{padding:"5px 8px",textAlign:"right",color:l.tipo==="receber"?G:TXD}}>{l.tipo==="receber"?fmtR(l.valor):"—"}</td>
              </tr>);})}</tbody>
          </table></Card>
          <div style={{fontSize:10,color:TXD,marginTop:8}}>{razaoLancs.length} lançamentos {razaoCat?`na categoria "${razaoCat}"`:"em todas as categorias"}</div>
        </div>
      )}

      {/* ═══ IMPOSTOS ═══ */}
      {!loading&&tab==="Impostos"&&(
        <div>
          <div style={{fontSize:15,fontWeight:600,color:TX,marginBottom:12}}>Impostos e Tributos — {nMes(mesAno)}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
            {[{l:"Total Impostos",v:fmtR(tImp),c:P},{l:"Carga Tributária",v:tRec>0?`${((tImp/tRec)*100).toFixed(1)}%`:"—",c:P},{l:"Alíquota Efetiva",v:tRec>0?`${(((tImp)/(tRec))*100).toFixed(2)}%`:"—",c:Y},{l:"Categorias",v:String(impostosDetail.length),c:B}].map((k,i)=>(
              <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
                <div style={{fontSize:8,color:TXD,textTransform:"uppercase"}}>{k.l}</div>
                <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
              </div>
            ))}
          </div>
          <Card><table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
              <th style={{padding:"8px 12px",textAlign:"left",color:TXD,fontSize:10}}>Imposto / Tributo</th>
              <th style={{padding:"8px 12px",textAlign:"right",color:TXD,fontSize:10}}>Valor (R$)</th>
              <th style={{padding:"8px 12px",textAlign:"right",color:TXD,fontSize:10}}>% Total Imp.</th>
              <th style={{padding:"8px 12px",textAlign:"right",color:TXD,fontSize:10}}>% Receita</th>
            </tr></thead>
            <tbody>{impostosDetail.map(([nome,valor])=>(
              <tr key={nome} style={{borderBottom:`0.5px solid ${BD}`}}>
                <td style={{padding:"7px 12px",color:TX}}>{nome}</td>
                <td style={{padding:"7px 12px",textAlign:"right",color:P,fontWeight:600}}>{fmtR(valor)}</td>
                <td style={{padding:"7px 12px",textAlign:"right",color:TXD}}>{tImp>0?`${((valor/tImp)*100).toFixed(1)}%`:"—"}</td>
                <td style={{padding:"7px 12px",textAlign:"right",color:TXD}}>{tRec>0?`${((valor/tRec)*100).toFixed(2)}%`:"—"}</td>
              </tr>
            ))}</tbody>
          </table></Card>
        </div>
      )}

      {/* ═══ SPED ═══ */}
      {!loading&&tab==="SPED"&&(
        <div>
          <div style={{fontSize:15,fontWeight:600,color:TX,marginBottom:12}}>SPED ECD — Escrituração Contábil Digital</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
            <Card style={{padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Gerar SPED ECD</div>
              <div style={{fontSize:11,color:TXM,marginBottom:4}}>Arquivo texto no layout oficial da RFB com registros I050 (Plano de Contas), I150/I155 (Saldos), I200/I250 (Lançamentos).</div>
              <div style={{fontSize:10,color:TXD,marginBottom:12}}>
                Empresa: {selName}<br/>
                CNPJ: {selCNPJ||"Não informado"}<br/>
                Período: 01/{String(mes).padStart(2,"0")}/{ano} a {new Date(ano,mes,0).getDate()}/{String(mes).padStart(2,"0")}/{ano}<br/>
                Lançamentos: {lancamentos.length}<br/>
                Contas utilizadas: {balancete.length}
              </div>
              <button onClick={exportSPED} style={{padding:"10px 24px",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer",background:`${P}15`,color:P,border:`1px solid ${P}30`}}>Gerar arquivo SPED ECD (.txt)</button>
            </Card>
            <Card style={{padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Registros incluídos</div>
              <div style={{fontSize:11,color:TXM,lineHeight:2}}>
                |0000| — Abertura e identificação<br/>
                |I010| — Forma de escrituração<br/>
                |I050| — Plano de Contas ({balancete.length} contas)<br/>
                |I150| — Saldos periódicos<br/>
                |I155| — Detalhes dos saldos ({balancete.length} linhas)<br/>
                |I200| — Lançamentos ({lancamentos.length} registros)<br/>
                |I250| — Partidas dos lançamentos<br/>
                |I990| — Encerramento Bloco I<br/>
                |9999| — Encerramento do arquivo
              </div>
            </Card>
          </div>
          <div style={{background:`${Y}10`,borderRadius:10,border:`1px solid ${Y}30`,padding:16,fontSize:11,color:TXM}}>
            <strong style={{color:Y}}>Nota importante:</strong> Este é o SPED ECD simplificado gerado a partir dos dados financeiros disponíveis no PS Gestão. Para o SPED oficial completo, o contador deve validar no PVA (Programa Validador e Assinador) da RFB e complementar com os registros obrigatórios adicionais conforme o regime tributário da empresa.
          </div>
        </div>
      )}

      {/* ═══ REFORMA TRIBUTÁRIA ═══ */}
      {!loading&&tab==="Reforma"&&(
        <div>
          <div style={{fontSize:15,fontWeight:600,color:TX,marginBottom:4}}>Reforma Tributária — CBS/IBS</div>
          <div style={{fontSize:11,color:TXD,marginBottom:16}}>Cronograma de implementação e impacto estimado para {selName}</div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:16}}>
            {[{l:"Carga atual",v:tRec>0?`${((tImp/tRec)*100).toFixed(1)}%`:"—",c:P,sub:"PIS+COFINS+ICMS+ISS"},{l:"CBS+IBS estimada",v:"26.5%",c:Y,sub:"Alíquota padrão proposta"},{l:"Impacto estimado",v:tRec>0?`${(26.5-((tImp/tRec)*100)).toFixed(1)}pp`:"—",c:tRec>0&&26.5>((tImp/tRec)*100)?R:G,sub:"Diferença na carga"}].map((k,i)=>(
              <div key={i} style={{background:BG2,borderRadius:10,padding:"12px 16px",border:`1px solid ${BD}`}}>
                <div style={{fontSize:8,color:TXD,textTransform:"uppercase"}}>{k.l}</div>
                <div style={{fontSize:20,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
                <div style={{fontSize:9,color:TXD,marginTop:2}}>{k.sub}</div>
              </div>
            ))}
          </div>

          <Card style={{padding:0}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${BD}`,fontWeight:600,color:TX,fontSize:13}}>Cronograma da Reforma Tributária</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`}}>
                <th style={{padding:"8px 12px",textAlign:"left",color:TXD,fontSize:10}}>Ano</th>
                <th style={{padding:"8px 12px",textAlign:"left",color:TXD,fontSize:10}}>Fase</th>
                <th style={{padding:"8px 12px",textAlign:"left",color:TXD,fontSize:10}}>O que muda</th>
                <th style={{padding:"8px 12px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
              </tr></thead>
              <tbody>
                {[
                  {ano:"2026",fase:"Teste CBS",desc:"CBS (federal) começa a ser cobrada a 0,9% como teste. PIS/COFINS continuam.",status:"Em vigor",cor:G},
                  {ano:"2027",fase:"Teste IBS",desc:"IBS (estadual/municipal) começa a 0,1%. ICMS e ISS continuam integralmente.",status:"Próximo",cor:Y},
                  {ano:"2029-2032",fase:"Transição",desc:"Redução gradual de ICMS/ISS e aumento proporcional do IBS. Split payment obrigatório.",status:"Futuro",cor:B},
                  {ano:"2033",fase:"Extinção",desc:"ICMS e ISS extintos. CBS+IBS em vigor pleno. Alíquota única estimada 26,5%.",status:"Futuro",cor:B},
                  {ano:"2027+",fase:"Split Payment",desc:"Recolhimento automático na liquidação financeira. Banco retém e repassa CBS/IBS.",status:"Em definição",cor:P},
                ].map((item,i)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${BD}`}}>
                    <td style={{padding:"8px 12px",fontWeight:600,color:TX}}>{item.ano}</td>
                    <td style={{padding:"8px 12px",color:TXM,fontWeight:600}}>{item.fase}</td>
                    <td style={{padding:"8px 12px",color:TXM,fontSize:11}}>{item.desc}</td>
                    <td style={{padding:"8px 12px",textAlign:"center"}}><span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:`${item.cor}15`,color:item.cor,fontWeight:600}}>{item.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div style={{marginTop:16,background:`${T}08`,borderRadius:10,border:`1px solid ${T}25`,padding:16}}>
            <div style={{fontSize:13,fontWeight:600,color:T,marginBottom:6}}>Como o PS Gestão está se preparando</div>
            <div style={{fontSize:11,color:TXM,lineHeight:1.8}}>
              O sistema já está sendo desenvolvido para suportar o Split Payment CBS/IBS quando entrar em vigor. Na prática, o ERP vai calcular automaticamente os valores de CBS e IBS em cada transação, gerar os registros fiscais no formato exigido, e preparar os arquivos para transmissão. O módulo será atualizado conforme a regulamentação for publicada pela RFB.
            </div>
          </div>
        </div>
      )}

      {/* ═══ EXPORTAR ═══ */}
      {!loading&&tab==="Exportar"&&(
        <div>
          <div style={{fontSize:15,fontWeight:600,color:TX,marginBottom:16}}>Exportar Dados Contábeis — {nMes(mesAno)}</div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <Card style={{padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:G,marginBottom:4}}>DRE Completo</div>
              <div style={{fontSize:11,color:TXM,marginBottom:12}}>DRE consolidado + breakdown por linha de negócio. Formato CSV com separador ponto-e-vírgula, compatível com Excel.</div>
              <button onClick={exportDRE} style={{padding:"8px 20px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:`${G}15`,color:G,border:`1px solid ${G}30`}}>Baixar DRE (.csv)</button>
            </Card>
            <Card style={{padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:B,marginBottom:4}}>Balancete de Verificação</div>
              <div style={{fontSize:11,color:TXM,marginBottom:12}}>Todas as contas com Código Referencial RFB, natureza, débito, crédito e saldo. Importável em Domínio/Questor/Fortes.</div>
              <button onClick={exportBalancete} style={{padding:"8px 20px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:`${B}15`,color:B,border:`1px solid ${B}30`}}>Baixar Balancete (.csv)</button>
            </Card>
            <Card style={{padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:T,marginBottom:4}}>Livro Razão Analítico</div>
              <div style={{fontSize:11,color:TXM,marginBottom:12}}>Todos os lançamentos do período com data, tipo D/C, código referencial, categoria, pessoa, documento e valores.</div>
              <button onClick={exportRazao} style={{padding:"8px 20px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:`${T}15`,color:T,border:`1px solid ${T}30`}}>Baixar Razão (.csv)</button>
            </Card>
            <Card style={{padding:20}}>
              <div style={{fontSize:14,fontWeight:600,color:P,marginBottom:4}}>SPED ECD</div>
              <div style={{fontSize:11,color:TXM,marginBottom:12}}>Arquivo texto no layout oficial RFB com Plano de Contas (I050), Saldos (I155) e Lançamentos (I200/I250).</div>
              <button onClick={exportSPED} style={{padding:"8px 20px",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer",background:`${P}15`,color:P,border:`1px solid ${P}30`}}>Baixar SPED ECD (.txt)</button>
            </Card>
          </div>

          <Card style={{padding:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:14,fontWeight:600,color:GO}}>Pacote Completo</div>
                <div style={{fontSize:11,color:TXM}}>Baixa os 4 arquivos de uma vez: DRE + Balancete + Razão + SPED ECD</div>
              </div>
              <button onClick={exportTudo} style={{padding:"10px 24px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",background:`${GO}15`,color:GO,border:`1px solid ${GO}40`}}>Baixar Tudo</button>
            </div>
          </Card>

          <div style={{marginTop:16,background:BG2,borderRadius:10,border:`1px solid ${BD}`,padding:20}}>
            <div style={{fontSize:13,fontWeight:600,color:TX,marginBottom:8}}>Resumo do período</div>
            <div style={{fontSize:12,color:TXM,lineHeight:1.8}}>
              Empresa: {selName}<br/>
              CNPJ: {selCNPJ||"Não informado"}<br/>
              Período: {nMes(mesAno)}<br/>
              Total de lançamentos: {lancamentos.length} ({receitas.length} receitas + {despesas.length} despesas)<br/>
              Receita bruta: {fmtR(tRec)}<br/>
              Resultado líquido: {fmtR(resultado)} ({tRec>0?`${((resultado/tRec)*100).toFixed(1)}%`:"—"} margem líquida)<br/>
              Contas do plano referencial: {balancete.length}<br/>
              Linhas de negócio: {linhas.length}
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:24}}>PS Gestão e Capital — Módulo Contador v3.0 — Portal Contábil Completo</div>
    </div>
  );
}

export default function ContadorPage(){
  return(<Suspense fallback={<div style={{padding:40,textAlign:"center",fontSize:13,color:"#9C8E80"}}>Carregando módulo contábil...</div>}><ContadorPageInner/></Suspense>);
}
