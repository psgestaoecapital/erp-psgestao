"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";
import AnaliseIAFlags from "../components/AnaliseIAFlags";
import BalancoPatrimonial from "../components/BalancoPatrimonial";
import IndicadoresFinanceiros from "../components/IndicadoresFinanceiros";
import FluxoCaixa from "../components/FluxoCaixa";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",T="#2DD4BF",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const tt={background:'#FFFFFF',border:'2px solid #C6973F',borderRadius:12,fontSize:12,color:'#1A1A18',padding:'12px 16px',boxShadow:'0 6px 20px rgba(0,0,0,0.4)',lineHeight:1.8};
const tl={color:'#1A1A18',fontWeight:700,fontSize:13,marginBottom:4};const ti={color:'#333',fontSize:11,fontWeight:500};

const fmtBRL=(v:any)=>{
  const n=Number(v);
  if(isNaN(n)) return "R$ 0,00";
  return `R$ ${n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
};
const fmtN=(v:any)=>{const n=Number(v);if(isNaN(n))return"0";return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});};
const fmtTooltip=(v:any,name:any)=>[fmtBRL(v),name];
const decodeHTML=(s:string)=>s?.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"')||s;
const fmtTooltipPct=(v:any,name:any)=>[`${v}%`,name];
const fmtMesLabel=(k:string)=>{
  if(!k||!k.includes("-")) return k;
  const [a,m]=k.split("-");
  const n=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  return `${n[parseInt(m)-1]}/${a.slice(2)}`;
};

const DrillPanel=({data,loading}:{data:any,loading:boolean})=>{
  if(loading) return <div style={{padding:16,textAlign:"center",fontSize:12,color:TXM}}>Carregando detalhes...</div>;
  if(!data) return null;
  return(
    <div style={{background:"#1A1918",borderRadius:12,padding:14,marginTop:8,border:`1px solid ${BD}`}}>
      <div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{background:BG3,borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
          <div style={{fontSize:17,fontWeight:700,color:GOL}}>{fmtBRL(data.total)}</div>
          <div style={{fontSize:10,color:TXM}}>Total</div>
        </div>
        <div style={{background:BG3,borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
          <div style={{fontSize:17,fontWeight:700,color:TX}}>{data.count}</div>
          <div style={{fontSize:10,color:TXM}}>Lançamentos</div>
        </div>
        {Object.entries(data.por_status||{}).map(([s,v]:any)=>(
          <div key={s} style={{background:BG3,borderRadius:8,padding:"8px 14px",textAlign:"center"}}>
            <div style={{fontSize:15,fontWeight:700,color:s==="PAGO"||s==="RECEBIDO"?G:s==="ATRASADO"?R:s==="A VENCER"?Y:TXM}}>{v.count}</div>
            <div style={{fontSize:10,color:TXM}}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{maxHeight:350,overflowY:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
            <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>DATA</th>
            <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>CLIENTE / FORNECEDOR</th>
            <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>DESCRIÇÃO</th>
            <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>DOC / NF</th>
            <th style={{padding:"8px 6px",textAlign:"center",color:GO,fontSize:10,fontWeight:600}}>STATUS</th>
            <th style={{padding:"8px 6px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>VALOR</th>
          </tr></thead>
          <tbody>
            {data.transacoes?.map((t:any,i:number)=>(
              <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`}}>
                <td style={{padding:"7px 6px",color:TXM,whiteSpace:"nowrap",fontSize:11}}>{t.data}{t.vencimento&&t.vencimento!==t.data?<div style={{fontSize:9,color:TXD}}>Venc: {t.vencimento}</div>:null}</td>
                <td style={{padding:"7px 6px"}}>
                  <div style={{color:TX,fontWeight:500,fontSize:12}}>{t.nome_cf||"—"}</div>
                  {t.cliente_fornecedor&&<div style={{fontSize:9,color:TXD}}>Cód: {t.cliente_fornecedor}</div>}
                </td>
                <td style={{padding:"7px 6px",color:TXM,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",fontSize:11}}>{t.observacao||t.desc_categoria||"—"}</td>
                <td style={{padding:"7px 6px"}}>
                  <div style={{color:TX,fontFamily:"monospace",fontSize:11}}>{t.documento||t.nf||"—"}</div>
                  {t.parcela&&<div style={{fontSize:9,color:TXD}}>Parc: {t.parcela}</div>}
                </td>
                <td style={{padding:"7px 6px",textAlign:"center"}}>
                  <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,fontWeight:500,
                    background:t.status==="PAGO"||t.status==="RECEBIDO"?G+"18":t.status==="ATRASADO"?R+"18":t.status==="A VENCER"?Y+"18":TXM+"10",
                    color:t.status==="PAGO"||t.status==="RECEBIDO"?G:t.status==="ATRASADO"?R:t.status==="A VENCER"?Y:TXM,
                    border:`1px solid ${t.status==="PAGO"||t.status==="RECEBIDO"?G+"30":t.status==="ATRASADO"?R+"30":t.status==="A VENCER"?Y+"30":BD}`
                  }}>{t.status||"—"}</span>
                </td>
                <td style={{padding:"7px 6px",textAlign:"right",fontWeight:600,color:TX,whiteSpace:"nowrap",fontSize:12}}>{fmtBRL(t.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.count>50&&<div style={{fontSize:11,color:TXM,textAlign:"center",marginTop:8,padding:6,background:BG3,borderRadius:6}}>Mostrando os 50 maiores de {data.count} lançamentos</div>}
      </div>
    </div>
  );
};

const empresa={nome:"",cidade:"",periodo:"",lns:0,colab:0};
const negocios:any[]=[];
const rev:any[]=[];
const caixa:any[]=[];

const KPI=({r,v,d,ok}:any)=>(
  <div style={{background:"linear-gradient(135deg, #161614, #1E1E1B)",borderRadius:12,padding:"12px 14px",borderLeft:`3px solid ${ok?G:ok===false?R:BD}`,border:`1px solid #2A2822`,transition:"all 0.2s"}}>
    <div style={{fontSize:10,color:TXM,letterSpacing:0.8,textTransform:"uppercase",fontWeight:500}}>{r}</div>
    <div style={{fontSize:20,fontWeight:700,color:ok?GOL:ok===false?R:TX,marginTop:4,letterSpacing:-0.3}}>{v}</div>
    <div style={{fontSize:11,color:ok?G:ok===false?R:TXM,marginTop:3,fontWeight:500}}>{d}</div>
  </div>
);

const Tit=({t}:{t:string})=>(<div style={{display:"flex",alignItems:"center",gap:10,margin:"20px 0 12px"}}><div style={{width:3,height:18,background:`linear-gradient(180deg, ${GOL}, ${GO})`,borderRadius:2}}/><span style={{fontSize:14,fontWeight:700,letterSpacing:0.2,color:TX}}>{t}</span></div>);

const Card=({children,p="16px 18px",title}:{children:React.ReactNode,p?:string,title?:string})=>(<div style={{background:"#161614",borderRadius:14,padding:p,marginBottom:10,border:`1px solid #2A2822`,transition:"all 0.2s"}}>{title&&<div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:12,letterSpacing:0.2}}>{title}</div>}{children}</div>);

export default function AnalisesPage(){
  const [aba,setAba]=useState("geral");
  const [lnAberta,setLnAberta]=useState<number|null>(null);
  const [subAba,setSubAba]=useState("visao");
  const [dreAberto,setDreAberto]=useState<Record<string,boolean>>({});
  const [custoAberto,setCustoAberto]=useState<Record<string,boolean>>({});
  const [userRole,setUserRole]=useState<string>("adm");

  const ROLE_TABS:Record<string,string[]>={
    admin:["geral","visao_diaria","negocios","resultado","balanco","indicadores","financeiro","precos","relatorio"],
    adm:["geral","visao_diaria","negocios","resultado","balanco","indicadores","financeiro","precos","relatorio"],
    adm_investimentos:["geral","visao_diaria","negocios","resultado","balanco","indicadores","financeiro","precos","relatorio"],
    acesso_total:["geral","visao_diaria","negocios","resultado","balanco","indicadores","financeiro","precos","relatorio"],
    socio:["geral","visao_diaria","negocios","resultado","balanco","indicadores","financeiro","precos","relatorio"],
    financeiro:["geral","visao_diaria","resultado","balanco","indicadores","financeiro","precos"],
    comercial:["geral","negocios","precos"],
    operacional:["geral","negocios"],
    consultor:["geral","visao_diaria","negocios","resultado","balanco","indicadores","financeiro","precos","relatorio"],
    visualizador:["geral"],
  };
  const ROLE_NAMES:Record<string,string>={adm:"Administrador",adm_investimentos:"Admin Investimentos",acesso_total:"Acesso Total",socio:"Sócio/CEO",diretor_industrial:"Diretor Industrial",gerente_planta:"Gerente Planta",financeiro:"Financeiro",comercial:"Comercial",supervisor:"Supervisor",coordenador:"Coordenador",operacional:"Operador",consultor:"Consultor",conselheiro:"Conselheiro",visualizador:"Visualizador"};

  const todasAbas=[{id:"geral",nome:"Painel Geral"},{id:"visao_diaria",nome:"Visão Diária"},{id:"negocios",nome:"Negócios"},{id:"resultado",nome:"Resultado"},{id:"balanco",nome:"Balanço"},{id:"indicadores",nome:"Indicadores"},{id:"financeiro",nome:"Financeiro"},{id:"precos",nome:"Preços"},{id:"relatorio",nome:"Relatório"}];
  const isDemoMode=typeof window!=="undefined"&&localStorage.getItem("ps_demo_mode")==="true";
  const allowedTabs=ROLE_TABS[userRole]||ROLE_TABS.admin;
  const abas=todasAbas.filter(a=>allowedTabs.includes(a.id));
  const abasDemo: string[] = [];

  const [empresaSel, setEmpresaSel] = useState(()=>{
    if(typeof window!=="undefined"){const s=localStorage.getItem("ps_empresa_sel");if(s)return s;}
    return "consolidado";
  });
  useEffect(()=>{if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",empresaSel);},[empresaSel]);
  const [filtroTipo, setFiltroTipo] = useState<"mes"|"dia"|"periodo">("mes");
  const [periodoInicio, setPeriodoInicio] = useState(()=>{
    const d=new Date();
    return `${d.getFullYear()}-01`;
  });
  const [periodoFim, setPeriodoFim] = useState(()=>{
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  });
  const [dataInicio, setDataInicio] = useState(()=>new Date().toISOString().slice(0,10));
  const [dataFim, setDataFim] = useState(()=>new Date().toISOString().slice(0,10));

  const setQuickPeriod=(tipo:string)=>{
    const hoje=new Date();
    const fmt=(d:Date)=>d.toISOString().slice(0,10);
    const fmtM=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    switch(tipo){
      case "hoje": setFiltroTipo("dia"); setDataInicio(fmt(hoje)); setDataFim(fmt(hoje)); break;
      case "semana": {
        setFiltroTipo("periodo");
        const seg=new Date(hoje); seg.setDate(hoje.getDate()-hoje.getDay()+1);
        setDataInicio(fmt(seg)); setDataFim(fmt(hoje)); break;
      }
      case "mes": {
        setFiltroTipo("mes");
        setPeriodoInicio(fmtM(hoje)); setPeriodoFim(fmtM(hoje)); break;
      }
      case "trimestre": {
        setFiltroTipo("mes");
        const ini=new Date(hoje); ini.setMonth(hoje.getMonth()-2);
        setPeriodoInicio(fmtM(ini)); setPeriodoFim(fmtM(hoje)); break;
      }
      case "semestre": {
        setFiltroTipo("mes");
        const ini=new Date(hoje); ini.setMonth(hoje.getMonth()-5);
        setPeriodoInicio(fmtM(ini)); setPeriodoFim(fmtM(hoje)); break;
      }
      case "ano": {
        setFiltroTipo("mes");
        setPeriodoInicio(`${hoje.getFullYear()}-01`); setPeriodoFim(fmtM(hoje)); break;
      }
    }
  };

  const efPeriodoInicio = filtroTipo==="mes" ? periodoInicio : dataInicio.slice(0,7);
  const efPeriodoFim = filtroTipo==="mes" ? periodoFim : dataFim.slice(0,7);

  const [drillOpen, setDrillOpen] = useState<string|null>(null);
  const [drillData, setDrillData] = useState<any>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  const [contextoTexto, setContextoTexto] = useState("");
  const [iaAnalise, setIaAnalise] = useState("");
  const [iaLoading, setIaLoading] = useState(false);

  const analisarComIA = async () => {
    if (!contextoTexto.trim() || !realData) return;
    setIaLoading(true);
    setIaAnalise("");
    try {
      const res = await fetch("/api/report/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contexto: contextoTexto,
          financial_summary: {
            receita_operacional: `${fmtBRL(realData.total_rec_operacional||realData.total_receitas||0)}`,
            despesas: `${fmtBRL(realData.total_despesas||0)}`,
            resultado: `${fmtBRL(realData.resultado_periodo||0)}`,
            margem: `${realData.margem||0}%`,
            emprestimos: `${fmtBRL(realData.total_emprestimos||0)}`,
            top_custos: (realData.top_custos||[]).slice(0,5).map((c:any)=>`${decodeHTML(c.nome)}: ${fmtBRL(c.valor)}`),
            top_receitas: (realData.top_receitas_operacionais||[]).slice(0,5).map((r:any)=>`${decodeHTML(r.nome)}: ${fmtBRL(r.valor)}`),
          },
          empresa_nome: empresaAtiva.nome,
        })
      });
      const d = await res.json();
      if (d.success) { setIaAnalise(d.analysis); }
      else { setIaAnalise("Erro: " + (d.error || "Não foi possível gerar análise. Verifique a chave da API.")); }
    } catch (e: any) { setIaAnalise("Erro: " + e.message); }
    setIaLoading(false);
  };

  const [reportText, setReportText] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSource, setReportSource] = useState("v19");
  const showToast2 = (msg:string) => { alert(msg); };

  const loadDrill = async (categoria: string, tipo: "receita"|"despesa", key: string) => {
    if (drillOpen === key) { setDrillOpen(null); setDrillData(null); return; }
    setDrillOpen(key);
    setDrillLoading(true);
    setDrillData(null);
    const compIds = empresaSel==="consolidado" ? dbCompanies.map(c=>c.id) : empresaSel.startsWith("group_") ? dbCompanies.filter(c=>c.group_id===empresaSel.replace("group_","")).map(c=>c.id) : [empresaSel];
    try {
      const res = await authFetch(`/api/omie/detail?t=${Date.now()}`, {
        method: "POST",
        body: JSON.stringify({ company_ids: compIds, categoria, tipo, periodo_inicio: efPeriodoInicio, periodo_fim: efPeriodoFim })
      });
      const d = await res.json();
      if (d.success) setDrillData(d.data);
    } catch(e) {}
    setDrillLoading(false);
  };
  const [dbCompanies, setDbCompanies] = useState<any[]>([]);
  const [dbGroups, setDbGroups] = useState<any[]>([]);
  const [loadingDb, setLoadingDb] = useState(true);
  const [omieData, setOmieData] = useState<any[]>([]);
  const [realData, setRealData] = useState<any>(null);
  const [loadingReal, setLoadingReal] = useState(false);
  const [regime, setRegime] = useState<"competencia"|"caixa">("competencia");

  useEffect(() => {
    const loadCompanies = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoadingDb(false); return; }
      
      const { data: up } = await supabase.from("users").select("org_id, role").eq("id", user.id).single();
      if (up?.role) setUserRole(up.role);

      const { data: grps } = await supabase.from("company_groups").select("*").order("nome");
      if (grps) setDbGroups(grps);

      if (up?.role === "adm" || up?.role === "acesso_total" || up?.role === "adm_investimentos") {
        const { data } = await supabase.from("companies").select("*").order("created_at");
        if (data && data.length > 0) setDbCompanies(data);
      } else {
        const { data: uc } = await supabase.from("user_companies").select("company_id, companies(*)").eq("user_id", user.id);
        const comps = (uc || []).map((u: any) => u.companies).filter(Boolean);
        if (comps.length > 0) setDbCompanies(comps);
      }
      
      setLoadingDb(false);
    };
    loadCompanies();
  }, []);

  useEffect(() => {
    if(dbCompanies.length === 0) return;
    const compIds = dbCompanies.map(c => c.id);
    supabase.from("omie_imports").select("company_id,import_type,record_count,imported_at").in("company_id", compIds).then(({data, error}:any) => {
      if(error) console.error("OMIE_IMPORTS ERROR:", error);
      if(data) setOmieData(data);
    });
  }, [dbCompanies]);

  useEffect(() => {
    if(dbCompanies.length === 0 || omieData.length === 0) return;
    setLoadingReal(true);
    let compIds: string[];
    if (empresaSel === "consolidado") {
      compIds = dbCompanies.map(c => c.id);
    } else if (empresaSel.startsWith("group_")) {
      const gid = empresaSel.replace("group_", "");
      compIds = dbCompanies.filter(c => c.group_id === gid).map(c => c.id);
    } else {
      compIds = [empresaSel];
    }
    if (compIds.length === 0) { setLoadingReal(false); return; }
    authFetch(`/api/omie/process?t=${Date.now()}`, {
      method: "POST",
      headers: {"Cache-Control":"no-cache"},
      body: JSON.stringify({ company_ids: compIds, periodo_inicio: efPeriodoInicio, periodo_fim: efPeriodoFim, regime })
    }).then(r=>r.text()).then(text=>{
      try{const d=JSON.parse(text);if(d.success){setRealData(d.data);}else console.error("PROCESS FAIL:",d.error);}
      catch{console.error("PROCESS BAD JSON:",text.substring(0,200));}
      setLoadingReal(false);
    }).catch(e=>{console.error("PROCESS ERROR:",e);setLoadingReal(false);});
  }, [empresaSel, dbCompanies, omieData, efPeriodoInicio, efPeriodoFim, regime]);

  const grupoEmpresas = [
    {id:"consolidado",nome:dbCompanies.length>1?"Todas as Empresas":"Empresa",cnpj:"Todos",pais:"—",group_id:null},
    ...dbCompanies.map(c=>({id:c.id,nome:c.nome_fantasia||c.razao_social,cnpj:c.cnpj||"",pais:c.pais||"Brasil",group_id:c.group_id||null}))
  ];

  const gruposComEmpresas = dbGroups.map(g=>({
    ...g,
    empresas: dbCompanies.filter(c=>c.group_id===g.id)
  })).filter(g=>g.empresas.length>0);
  const empresasSemGrupo = dbCompanies.filter(c=>!c.group_id || !dbGroups.find((g: any)=>g.id===c.group_id));

  const empresaAtiva = (()=>{
    if (empresaSel === "consolidado") {
      return {nome:dbCompanies.length>0?(dbCompanies[0].nome_fantasia||dbCompanies[0].razao_social):empresa.nome,cidade:dbCompanies.length>0?(dbCompanies[0].cidade_estado||empresa.cidade):empresa.cidade,lns:empresa.lns,colab:dbCompanies.length>0?(dbCompanies[0].num_colaboradores||empresa.colab):empresa.colab,isGroup:true,groupName:"Todas as Empresas",groupCount:dbCompanies.length};
    }
    if (empresaSel.startsWith("group_")) {
      const gid = empresaSel.replace("group_", "");
      const grp = dbGroups.find((g: any) => g.id === gid);
      const emps = dbCompanies.filter(c => c.group_id === gid);
      return {nome:grp?.nome||"Grupo",cidade:emps[0]?.cidade_estado||"",lns:empresa.lns,colab:emps.reduce((s: number,c: any)=>s+(c.num_colaboradores||0),0),isGroup:true,groupName:grp?.nome||"Grupo",groupCount:emps.length};
    }
    const c = dbCompanies.find(c=>c.id===empresaSel);
    return {nome:c?.nome_fantasia||c?.razao_social||empresa.nome,cidade:c?.cidade_estado||empresa.cidade,lns:empresa.lns,colab:c?.num_colaboradores||empresa.colab,isGroup:false,groupName:"",groupCount:1};
  })();

  const chartData = (()=>{
    if(!realData?.raw_rec && !realData?.raw_desp) return [];
    const rec = realData.raw_rec || {};
    const desp = realData.raw_desp || {};
    const allM = [...new Set([...Object.keys(rec),...Object.keys(desp)])].sort().slice(-12);
    return allM.map(m=>{
      const label = fmtMesLabel(m);
      return {
        mes: m, mesLabel: label,
        receitas: rec[m]||0,
        despesas: desp[m]||0,
        resultado: (rec[m]||0)-(desp[m]||0),
      };
    });
  })();

  return(<div style={{background:BG,color:TX,minHeight:"100vh",margin:"-24px",padding:0}}>
    <div style={{padding:"10px 16px",background:"linear-gradient(180deg, #161614 0%, #0C0C0A 100%)",borderBottom:`1px solid #2A2822`,position:"sticky",top:0,zIndex:100}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div>
            <div className={isDemoMode?"ps-blur":""} style={{fontSize:15,color:GOL,fontWeight:700,letterSpacing:0.3}}>{empresaAtiva.isGroup?"📁 ":""}{empresaAtiva.isGroup&&empresaAtiva.groupName?empresaAtiva.groupName:empresaAtiva.nome}</div>
            <div className={isDemoMode?"ps-blur":""} style={{fontSize:10,color:TXD,marginTop:1}}>
              {empresaAtiva.cidade}{empresaAtiva.colab?` · ${empresaAtiva.colab} colab.`:""}
              {empresaAtiva.isGroup&&empresaAtiva.groupCount>1?` · ${empresaAtiva.groupCount} empresas`:""}
              <span style={{marginLeft:6,padding:"1px 6px",borderRadius:4,fontSize:8,fontWeight:600,
                background:userRole==="adm"||userRole==="acesso_total"||userRole==="adm_investimentos"?GOL+"15":GO+"15",
                color:userRole==="adm"||userRole==="acesso_total"||userRole==="adm_investimentos"?GOL:GO,
              }}>{ROLE_NAMES[userRole]||userRole}</span>
            </div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {grupoEmpresas.length>1&&(
            <select className={isDemoMode?"ps-blur":""} value={empresaSel} onChange={e=>setEmpresaSel(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:6,padding:"4px 8px",fontSize:10,fontWeight:600,maxWidth:200}}>
              <option value="consolidado">📊 Todas ({dbCompanies.length})</option>
              {gruposComEmpresas.map(g=>(
                <optgroup key={g.id} label="───────────">
                  <option value={`group_${g.id}`}>📁 {g.nome}</option>
                  {g.empresas.map((c: any)=><option key={c.id} value={c.id}>└ {c.nome_fantasia||c.razao_social}</option>)}
                </optgroup>
              ))}
              {empresasSemGrupo.length>0&&empresasSemGrupo.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
            </select>
          )}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:4,flexWrap:"wrap"}}>
        {[["hoje","Hoje"],["semana","Sem"],["mes","Mês"],["trimestre","Tri"],["semestre","6M"],["ano","Ano"]].map(([k,l])=>(
          <button key={k} onClick={()=>setQuickPeriod(k)} style={{padding:"3px 8px",borderRadius:5,fontSize:9,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontWeight:500,cursor:"pointer"}}>{l}</button>
        ))}
        <div style={{width:1,height:14,background:BD,margin:"0 2px"}}/>
        <select value={filtroTipo} onChange={e=>{setFiltroTipo(e.target.value as any);}} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:5,padding:"3px 6px",fontSize:9,fontWeight:600}}>
          <option value="mes">Mensal</option>
          <option value="dia">Dia</option>
          <option value="periodo">Período</option>
        </select>
        {filtroTipo==="mes"&&(<>
          <input type="month" value={periodoInicio} onChange={e=>setPeriodoInicio(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:5,padding:"2px 6px",fontSize:10,fontWeight:600}}/>
          <span style={{fontSize:9,color:TXD}}>a</span>
          <input type="month" value={periodoFim} onChange={e=>setPeriodoFim(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:5,padding:"2px 6px",fontSize:10,fontWeight:600}}/>
        </>)}
        {filtroTipo==="dia"&&(
          <input type="date" value={dataInicio} onChange={e=>{setDataInicio(e.target.value);setDataFim(e.target.value);}} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:5,padding:"2px 6px",fontSize:10,fontWeight:600}}/>
        )}
        {filtroTipo==="periodo"&&(<>
          <input type="date" value={dataInicio} onChange={e=>setDataInicio(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:5,padding:"2px 6px",fontSize:10,fontWeight:600}}/>
          <span style={{fontSize:9,color:TXD}}>a</span>
          <input type="date" value={dataFim} onChange={e=>setDataFim(e.target.value)} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:5,padding:"2px 6px",fontSize:10,fontWeight:600}}/>
        </>)}
        <div style={{width:1,height:14,background:BD,margin:"0 4px"}}/>
        <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:`1px solid ${BD}`}}>
          <button onClick={()=>setRegime("competencia")} style={{padding:"3px 10px",fontSize:9,fontWeight:600,border:"none",cursor:"pointer",background:regime==="competencia"?`${GO}30`:"transparent",color:regime==="competencia"?GOL:TXD}}>Competência</button>
          <button onClick={()=>setRegime("caixa")} style={{padding:"3px 10px",fontSize:9,fontWeight:600,border:"none",cursor:"pointer",background:regime==="caixa"?`${GO}30`:"transparent",color:regime==="caixa"?GOL:TXD}}>Caixa</button>
        </div>
      </div>
    </div>

    <div style={{display:"flex",gap:3,padding:"8px 12px",overflowX:"auto",borderBottom:`1px solid ${BD}`,position:"sticky",top:82,zIndex:99,background:BG,alignItems:"center"}}>
      {abas.map(a=>(<button key={a.id} onClick={()=>setAba(a.id)} style={{padding:"8px 18px",borderRadius:10,fontSize:11,whiteSpace:"nowrap",border:aba===a.id?`1px solid ${GO}50`:`1px solid transparent`,background:aba===a.id?`linear-gradient(135deg, ${GO}18, ${GO}08)`:"transparent",color:aba===a.id?GOL:TXM,fontWeight:aba===a.id?600:400,letterSpacing:0.3,transition:"all 0.2s",position:"relative",cursor:"pointer"}}>{a.nome}</button>))}
    </div>

    <div style={{padding:"14px 20px",maxWidth:1400,margin:"0 auto"}}>

    {aba==="geral"&&(<div>
      {realData&&(()=>{
        const alerts: {sev:string,msg:string,det:string}[] = [];
        if(realData.resultado_periodo<0) alerts.push({sev:"critico",msg:`Resultado negativo: ${fmtBRL(realData.resultado_periodo)}`,det:"A empresa está gastando mais do que fatura. Ação imediata necessária."});
        if(realData.top_receitas?.some((r:any)=>r.nome?.toLowerCase().includes("empréstimo")||r.nome?.toLowerCase().includes("financiamento")||r.nome?.toLowerCase().includes("aporte")))
          alerts.push({sev:"atencao",msg:"Empréstimos/financiamentos estão sendo contados como receita",det:"Isso infla o faturamento real. Reclassifique no Omie: Categorias → mova empréstimos para 4.xx ou 5.xx"});
        return alerts.length>0?(
          <div style={{marginBottom:12}}>
            {alerts.map((a,i)=>(
              <div key={i} style={{background:a.sev==="critico"?"#EF444415":"#FACC1512",borderRadius:8,padding:"10px 14px",marginBottom:6,borderLeft:`4px solid ${a.sev==="critico"?R:Y}`}}>
                <div style={{fontSize:12,fontWeight:600,color:a.sev==="critico"?R:Y}}>{a.sev==="critico"?"⚠":"⚡"} {a.msg}</div>
                <div style={{fontSize:10,color:TXM,marginTop:3}}>{a.det}</div>
              </div>
            ))}
          </div>
        ):null;
      })()}

      {realData&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
            <KPI r="Receitas (Contas a Receber)" v={`${fmtBRL(realData.total_receitas)}`} d={`${realData.num_empresas} empresas consolidadas`} ok={true}/>
            <KPI r="Despesas (Contas a Pagar)" v={`${fmtBRL(realData.total_despesas)}`} d={`Total do período`} ok={null}/>
            <KPI r="Resultado do Período" v={`${fmtBRL(realData.resultado_periodo)}`} d={`Margem ${realData.margem}%`} ok={realData.resultado_periodo>0}/>
            <KPI r="Clientes" v={realData.total_clientes.toLocaleString("pt-BR")} d="Cadastrados no Omie" ok={true}/>
          </div>

          {(realData.chart_mensal||chartData)&&(realData.chart_mensal||chartData).length>0&&(
            <Card>
              <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:10}}>Receitas × Despesas × Resultado — Dados Reais do Omie (R$)</div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={realData.chart_mensal||chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
                  <XAxis dataKey="mesLabel" tick={{fontSize:10,fill:'#D4D0C8'}}/>
                  <YAxis tick={{fontSize:9,fill:'#D4D0C8'}} tickFormatter={(v:any)=>v.toLocaleString('pt-BR',{maximumFractionDigits:0})}/>
                  <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
                  <Bar dataKey="receitas" name="Receitas" fill={G} radius={[4,4,0,0]} barSize={16}/>
                  <Bar dataKey="despesas" name="Despesas" fill={R} opacity={0.7} radius={[4,4,0,0]} barSize={16}/>
                  <Bar dataKey="resultado" name="Resultado" fill={GOL} radius={[4,4,0,0]} barSize={10} opacity={0.9}/>
                </BarChart>
              </ResponsiveContainer>
              <div style={{display:"flex",gap:12,justifyContent:"center",marginTop:6}}>
                <span style={{fontSize:10,color:G}}>● Receitas</span>
                <span style={{fontSize:10,color:R}}>● Despesas</span>
                <span style={{fontSize:10,color:GOL}}>● Resultado</span>
              </div>
            </Card>
          )}

          {realData.top_custos&&realData.top_custos.length>0&&(
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:12,fontWeight:600,color:GOL}}>Maiores Custos — Real vs Orçado</div>
                {realData.variacao_global&&<div style={{fontSize:10,color:Number(realData.variacao_global)>0?R:G,fontWeight:600}}>Variação global: {Number(realData.variacao_global)>0?"+":""}{realData.variacao_global}%</div>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"24px 1fr auto auto auto",gap:"0 8px",alignItems:"center",fontSize:10,color:TXD,padding:"4px 0",borderBottom:`1px solid ${BD}`,marginBottom:4}}>
                <span></span><span>Categoria</span><span style={{textAlign:"right"}}>Real</span><span style={{textAlign:"right"}}>Orçado</span><span style={{textAlign:"right",width:60}}>Variação</span>
              </div>
              {realData.top_custos.slice(0,10).map((c:any,i:number)=>{
                const varPct=c.variacao!==null&&c.variacao!==undefined?c.variacao:null;
                const varColor=varPct===null?TXD:varPct>5?R:varPct>0?Y:G;
                return(
                <div key={i}>
                  <div onClick={()=>loadDrill(c.cod,"despesa",`custo-${i}`)} style={{display:"grid",gridTemplateColumns:"24px 1fr auto auto auto",gap:"0 8px",alignItems:"center",padding:"6px 0",borderBottom:`0.5px solid ${BD}20`,cursor:"pointer",transition:"background 0.2s"}}
                    onMouseEnter={e=>(e.currentTarget.style.background=BG3)} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                    <div style={{width:24,height:24,borderRadius:6,background:i<3?R+"20":i<6?Y+"20":GO+"20",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:i<3?R:i<6?Y:GO}}>{i+1}</div>
                    <div style={{fontSize:11,color:TX}}>{decodeHTML(c.nome)} <span style={{fontSize:9,color:TXD}}>{drillOpen===`custo-${i}`?"▼":"▶"}</span></div>
                    <div style={{fontSize:12,fontWeight:700,color:i<3?R:i<6?Y:TX,textAlign:"right"}}>{fmtBRL(c.valor)}</div>
                    <div style={{fontSize:11,color:c.orcado?TXM:TXD,textAlign:"right"}}>{c.orcado?fmtBRL(c.orcado):"—"}</div>
                    <div style={{fontSize:11,fontWeight:600,color:varColor,textAlign:"right",width:60}}>{varPct!==null?`${varPct>0?"+":""}${varPct.toFixed(1)}%`:"—"}</div>
                  </div>
                  {drillOpen===`custo-${i}`&&<DrillPanel data={drillData} loading={drillLoading}/>}
                </div>
              );})}
            </Card>
          )}

          <div style={{fontSize:10,color:TXM,textAlign:"right",marginBottom:10}}>Fonte: Omie API | Última sincronização: {omieData.length>0?new Date(Math.max(...omieData.map(d=>new Date(d.imported_at).getTime()))).toLocaleString("pt-BR"):""}</div>
        </div>
      )}

      {loadingReal&&!realData&&(
        <Card><div style={{textAlign:"center",padding:20,color:TXM,fontSize:12}}>Processando dados do Omie...</div></Card>
      )}

      {!realData&&!loadingReal&&(<>
      <div style={{textAlign:"center",padding:"40px 20px"}}>
        <div style={{fontSize:16,fontWeight:600,color:TX,marginBottom:8}}>Conecte seus dados para começar</div>
        <div style={{fontSize:12,color:TXM,lineHeight:1.6,maxWidth:400,margin:"0 auto 20px"}}>
          Importe dados do Omie ou ContaAzul para ver as análises com dados reais.
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <a href="/dashboard/dados" style={{padding:"10px 20px",borderRadius:10,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:700,textDecoration:"none"}}>📊 Conectar ERP</a>
        </div>
      </div>
      </>)}

      {realData&&realData.top_receitas_operacionais&&(<>
        <Tit t={`Linhas de Receita — Clique para ver detalhes`}/>
        {realData.top_receitas_operacionais.slice(0,8).map((r:any,i:number)=>(
          <div key={i}>
            <div onClick={()=>loadDrill(r.cod,"receita",`rec-${i}`)} style={{background:BG2,borderRadius:10,padding:"12px 14px",marginBottom:6,borderLeft:`4px solid ${[GO,G,B,P,T,GOL,R,Y][i%8]}`,border:`1px solid ${BD}`,cursor:"pointer",transition:"background 0.2s"}}
              onMouseEnter={e=>(e.currentTarget.style.background=BG3)} onMouseLeave={e=>(e.currentTarget.style.background=BG2)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:TX}}>{decodeHTML(r.nome)} <span style={{fontSize:9,color:TXD}}>{drillOpen===`rec-${i}`?"▼":"▶"}</span></div>
                  <div style={{fontSize:11,color:TXM}}>Categoria Omie | Clique para ver lançamentos</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:700,color:G}}>{fmtBRL(r.valor)}</div>
                  <div style={{fontSize:11,color:TXM}}>{realData.total_rec_operacional>0?((r.valor/realData.total_rec_operacional)*100).toFixed(1):"0"}% do total</div>
                </div>
              </div>
            </div>
            {drillOpen===`rec-${i}`&&<div style={{marginBottom:6}}><DrillPanel data={drillData} loading={drillLoading}/></div>}
          </div>
        ))}
      </>)}

      {realData&&(
        <div style={{marginTop:8}}>
          <Tit t="💬 Fale com o PS — Descreva sua situação"/>
          <Card>
            <div style={{fontSize:11,color:TXM,marginBottom:10}}>
              Digite o que está acontecendo na empresa, dúvidas, decisões que precisa tomar. O PS vai cruzar com seus dados financeiros reais.
            </div>
            <textarea
              value={contextoTexto}
              onChange={e=>setContextoTexto(e.target.value)}
              placeholder={"Exemplos:\n• Estou pensando em demitir 3 pessoas\n• Quero abrir uma filial\n• O fornecedor X aumentou 20%"}
              style={{width:"100%",minHeight:100,background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:12,fontSize:12,fontFamily:"Inter, sans-serif",resize:"vertical",outline:"none",lineHeight:1.6}}
            />
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:10}}>
              <div style={{fontSize:9,color:TXD}}>{contextoTexto.length>0?`${contextoTexto.length} caracteres`:""}</div>
              <button onClick={analisarComIA} disabled={iaLoading||!contextoTexto.trim()} style={{padding:"10px 24px",border:"none",borderRadius:8,background:iaLoading?BD:`linear-gradient(135deg,${GO} 0%,${GOL} 100%)`,color:iaLoading?TXM:BG,fontSize:13,fontWeight:700,cursor:iaLoading?"wait":"pointer"}}>
                {iaLoading?"◆ PS analisando...":"◆ Consultar o PS"}
              </button>
            </div>
          </Card>
          {iaAnalise&&(
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:13,fontWeight:700,color:GOL}}>Análise do PS</div>
                <button onClick={()=>navigator.clipboard.writeText(iaAnalise)} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${GO}`,background:"transparent",color:GO,fontSize:9,cursor:"pointer"}}>Copiar</button>
              </div>
              <div style={{fontSize:12,color:TX,lineHeight:1.8,whiteSpace:"pre-wrap"}} dangerouslySetInnerHTML={{__html:iaAnalise
                .replace(/\*\*(.+?)\*\*/g,`<strong style="color:${GOL}">$1</strong>`)
              }}/>
            </Card>
          )}
        </div>
      )}
    </div>)}

    {aba==="visao_diaria"&&(<div>
      <div style={{background:BG2,borderRadius:12,padding:20,border:`1px solid ${BD}`,textAlign:"center"}}>
        <div style={{fontSize:14,fontWeight:700,color:GOL,marginBottom:8}}>📅 Visão Diária</div>
        <div style={{fontSize:11,color:TXM,marginBottom:16}}>Tabela de dias × receitas × despesas × margem bruta × EBITDA × resultado final.</div>
        <a href={`/dashboard/visao-mensal?empresa=${empresaSel}`} style={{display:"inline-block",padding:"12px 32px",borderRadius:10,background:`linear-gradient(135deg, #3D2314, ${GO})`,color:"#FAF7F2",fontSize:13,fontWeight:700,textDecoration:"none",border:"none",cursor:"pointer"}}>📊 Abrir Visão Mensal Completa</a>
        <div style={{marginTop:20}}>
          <div style={{fontSize:12,fontWeight:700,color:GOL,marginBottom:10}}>💵 Fluxo de Caixa — Projeção Diária</div>
          <FluxoCaixa companyIds={empresaSel==="consolidado"?dbCompanies.map(c=>c.id):empresaSel.startsWith("group_")?dbCompanies.filter(c=>c.group_id===empresaSel.replace("group_","")).map(c=>c.id):[empresaSel]}/>
        </div>
      </div>
    </div>)}

    {aba==="negocios"&&(<div>
      {realData&&realData.top_receitas_operacionais&&realData.top_receitas_operacionais.length>0?(<>
        <Tit t={`${realData.top_receitas_operacionais.length} Linhas de Receita Identificadas — Dados Reais do Omie`}/>
        {realData.top_receitas_operacionais.map((r:any,i:number)=>{
          const pct = realData.total_rec_operacional>0?((r.valor/realData.total_rec_operacional)*100):0;
          const cores = [GO,G,B,P,T,GOL,"#F97316","#EC4899"];
          return(
            <Card key={i}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:4,height:40,borderRadius:2,background:cores[i%8]}}/>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:TX}}>{decodeHTML(r.nome)}</div>
                    <div style={{fontSize:11,color:TXM}}>Categoria Omie | Receita operacional</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:20,fontWeight:700,color:G}}>{fmtBRL(r.valor)}</div>
                  <div style={{fontSize:10,color:TXD}}>{pct.toFixed(1)}% do faturamento</div>
                </div>
              </div>
              <div style={{background:BG3,borderRadius:6,height:8,overflow:"hidden"}}>
                <div style={{background:cores[i%8],height:"100%",borderRadius:6,width:`${Math.min(pct,100)}%`}}/>
              </div>
            </Card>
          );
        })}

        {realData.top_emprestimos&&realData.top_emprestimos.length>0&&(<>
          <Tit t="Entradas Não-Operacionais (Empréstimos, Transferências)"/>
          {realData.top_emprestimos.map((r:any,i:number)=>(
            <div key={i} style={{background:BG2,borderRadius:8,padding:"10px 14px",marginBottom:4,borderLeft:`3px solid ${Y}`,border:`1px solid ${BD}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:12,color:TXM}}>{decodeHTML(r.nome)}</div>
                <div style={{fontSize:14,fontWeight:700,color:Y}}>{fmtBRL(r.valor)}</div>
              </div>
            </div>
          ))}
        </>)}

        {realData.grupos_custo&&realData.grupos_custo.length>0&&(<>
          <Tit t="Estrutura de Custos por Grupo"/>
          {realData.grupos_custo.map((g:any,i:number)=>{
            const pct = realData.total_despesas>0?((g.total/realData.total_despesas)*100):0;
            return(
              <div key={i} style={{background:BG2,borderRadius:8,padding:"12px 14px",marginBottom:6,border:`1px solid ${BD}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontSize:13,fontWeight:600,color:TX}}>{g.nome}</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:10,color:TXD}}>{pct.toFixed(1)}%</span>
                    <span style={{fontSize:15,fontWeight:700,color:i<2?R:TX}}>{fmtBRL(g.total)}</span>
                  </div>
                </div>
                <div style={{background:BG3,borderRadius:4,height:6,overflow:"hidden"}}>
                  <div style={{background:i<2?R:i<4?Y:GO,height:"100%",borderRadius:4,width:`${Math.min(pct,100)}%`,opacity:0.7}}/>
                </div>
              </div>
            );
          })}
        </>)}
      </>):(
        <div style={{padding:40,textAlign:"center",color:TXM,fontSize:12}}>Conecte o Omie para ver os negócios</div>
      )}
    </div>)}

    {aba==="resultado"&&(<div>
      {realData&&realData.dre_mensal&&realData.dre_mensal.length>0&&(<>
        <Tit t="Resultado Financeiro — Clique nas linhas para abrir detalhes"/>

        <div style={{display:"grid",gridTemplateColumns:"repeat(4, 1fr)",gap:8,marginBottom:14}}>
          <KPI r="Receita Período" v={`${fmtBRL(realData.total_rec_operacional||realData.total_receitas||0)}`} d="Faturamento operacional" ok={true}/>
          <KPI r="Despesas Período" v={`${fmtBRL(realData.total_despesas||0)}`} d="Contas a pagar" ok={null}/>
          <KPI r="Resultado" v={`${fmtBRL(realData.resultado_periodo||0)}`} d={`Margem ${realData.margem||0}%`} ok={(realData.resultado_periodo||0)>0}/>
          <KPI r="Margem" v={`${realData.margem||0}%`} d={Number(realData.margem||0)>0?"Positiva":"Negativa"} ok={Number(realData.margem||0)>0}/>
        </div>

        <Card p="8px">
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:600}}>
              <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                {["",
                  ...realData.dre_mensal.slice(-6).map((d:any)=>d.mesLabel||d.mes),
                  "Total","Orçado","Var %"
                ].map((h:string)=><th key={h} style={{padding:"8px 6px",textAlign:h===""?"left":"right",color:GOL,fontSize:10}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  {id:"fat",c:"RECEITA BRUTA",key:"receita",d:true,tp:"fat",grupo:null},
                  {id:"ded",c:"(-) Deduções e Impostos",key:"deducoes",d:false,tp:"x",grupo:"Deduções e Impostos"},
                  {id:"cdir",c:"(-) Custos Diretos",key:"custos_diretos",d:false,tp:"x",grupo:"Custos Diretos"},
                  {id:"mg",c:"= MARGEM BRUTA",key:"margem",d:true,tp:"mg",grupo:null},
                  {id:"dadm",c:"(-) Despesas Administrativas",key:"despesas_adm",d:false,tp:"x",grupo:"Despesas Administrativas"},
                  {id:"lop",c:"= LUCRO OPERACIONAL",key:"lucro_op",d:true,tp:"lc",grupo:null},
                  {id:"fin",c:"(-) Resultado Financeiro",key:"financeiro",d:false,tp:"x",grupo:"Resultado Financeiro"},
                  {id:"out",c:"(-) Outros",key:"outros",d:false,tp:"x",grupo:"Outros"},
                  {id:"fl",c:"= LUCRO FINAL",key:"lucro_final",d:true,tp:"fl",grupo:null},
                ].map((row:any,i:number)=>{
                  const vals = realData.dre_mensal.slice(-6).map((d:any)=>Number(d[row.key])||0);
                  const total = vals.reduce((a:number,v:number)=>a+v,0);
                  const isOpen = custoAberto["dre_"+row.id];
                  const grupo = row.grupo ? realData.grupos_custo?.find((g:any)=>g.nome===row.grupo) : null;
                  const recCats = row.id==="fat" ? realData.top_receitas_operacionais : null;
                  const hasExpand = grupo || recCats;
                  let orcado = 0;
                  if(grupo) orcado = grupo.orcado || 0;
                  else if(row.id==="fat" && realData.top_receitas_operacionais) orcado = realData.top_receitas_operacionais.reduce((s:number,r:any)=>s+(r.orcado||0),0);
                  else if(row.tp==="mg") orcado = (realData.top_receitas_operacionais||[]).reduce((s:number,r:any)=>s+(r.orcado||0),0) - ((realData.grupos_custo||[]).find((g:any)=>g.nome==="Custos Diretos")?.orcado||0) - ((realData.grupos_custo||[]).find((g:any)=>g.nome==="Deduções e Impostos")?.orcado||0);
                  else if(row.tp==="lc") orcado = (realData.top_receitas_operacionais||[]).reduce((s:number,r:any)=>s+(r.orcado||0),0) - (realData.total_orcado_despesas||0) + ((realData.grupos_custo||[]).find((g:any)=>g.nome==="Resultado Financeiro")?.orcado||0) + ((realData.grupos_custo||[]).find((g:any)=>g.nome==="Outros")?.orcado||0);
                  else if(row.tp==="fl") orcado = (realData.top_receitas_operacionais||[]).reduce((s:number,r:any)=>s+(r.orcado||0),0) - (realData.total_orcado_despesas||0);
                  const varPct = orcado > 0 ? ((total / orcado - 1) * 100) : null;
                  const varColor = varPct===null?TXD: row.tp==="fat"?(varPct>=0?G:R) : (varPct>5?R:varPct>0?Y:G);
                  return(<React.Fragment key={`dre-${i}`}>
                    <tr onClick={hasExpand?()=>setCustoAberto({...custoAberto,["dre_"+row.id]:!isOpen}):undefined}
                      style={{background:row.tp==="mg"?G+"10":row.tp==="lc"?GO+"10":row.tp==="fl"?GO+"18":"transparent",borderBottom:`0.5px solid ${BD}40`,cursor:hasExpand?"pointer":"default"}}>
                      <td style={{padding:6,fontWeight:row.d?700:400,color:row.d?TX:TXM,minWidth:180}}>
                        {hasExpand&&<span style={{fontSize:9,color:GO,marginRight:4}}>{isOpen?"▼":"▶"}</span>}
                        {row.c}
                      </td>
                      {vals.map((v:number,k:number)=><td key={k} style={{padding:6,textAlign:"right",fontWeight:row.d?700:400,color:v<0?R:v===0?TXD:["mg","lc","fl"].includes(row.tp)?GOL:TX,fontSize:10}}>
                        {v===0?"—":v<0?`(R$ ${fmtN(Math.abs(v))})`:`R$ ${fmtN(v)}`}
                      </td>)}
                      <td style={{padding:6,textAlign:"right",fontWeight:700,color:total<0?R:total===0?TXD:["mg","lc","fl"].includes(row.tp)?GOL:TX}}>
                        {total===0?"—":total<0?`(R$ ${fmtN(Math.abs(total))})`:`R$ ${fmtN(total)}`}
                      </td>
                      <td style={{padding:6,textAlign:"right",fontSize:10,color:orcado>0?TXM:TXD}}>
                        {orcado>0?`R$ ${fmtN(orcado)}`:"—"}
                      </td>
                      <td style={{padding:6,textAlign:"right",fontSize:10,fontWeight:600,color:varColor,minWidth:55}}>
                        {varPct!==null?`${varPct>0?"+":""}${varPct.toFixed(1)}%`:"—"}
                      </td>
                    </tr>
                  </React.Fragment>);
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {realData.grupos_custo&&realData.grupos_custo.length>0&&(<>
          <Tit t="Mapa de Custos — Clique para expandir cada grupo"/>
          {realData.grupos_custo.map((g:any,gi:number)=>(
            <Card key={gi}>
              <div onClick={()=>setCustoAberto({...custoAberto,["rg"+gi]:!custoAberto["rg"+gi]})} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:10,color:GO}}>{custoAberto["rg"+gi]?"▼":"▶"}</span>
                  <span style={{fontSize:13,fontWeight:600,color:TX}}>{g.nome}</span>
                  <span style={{fontSize:10,color:TXD}}>({g.contas.length} contas)</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:80,height:6,background:BG3,borderRadius:3,overflow:"hidden"}}>
                    <div style={{width:`${Math.min((g.total/realData.total_despesas)*100,100)}%`,height:"100%",background:gi<2?R:gi<4?Y:GO,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:15,fontWeight:700,color:gi<2?R:gi<4?Y:TX}}>{fmtBRL(g.total)}</span>
                  <span style={{fontSize:10,color:TXD}}>{realData.total_despesas>0?((g.total/realData.total_despesas)*100).toFixed(1):"0"}%</span>
                </div>
              </div>
              {custoAberto["rg"+gi]&&(
                <div style={{marginTop:8}}>
                  {g.contas.slice(0,15).map((c:any,ci:number)=>(
                    <div key={ci}>
                      <div onClick={()=>loadDrill(c.cod||"","despesa",`mc-${gi}-${ci}`)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0 5px 20px",borderBottom:`0.5px solid ${BD}20`,cursor:"pointer"}}>
                        <span style={{fontSize:10,color:TXM}}>{decodeHTML(c.nome)} <span style={{fontSize:8,color:TXD}}>{drillOpen===`mc-${gi}-${ci}`?"▼":"▶"}</span></span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:11,fontWeight:600,color:TX,minWidth:60,textAlign:"right"}}>{fmtBRL(c.valor)}</span>
                        </div>
                      </div>
                      {drillOpen===`mc-${gi}-${ci}`&&<DrillPanel data={drillData} loading={drillLoading}/>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}

          <AnaliseIAFlags realData={realData} empresaId={empresaSel} periodo={`${efPeriodoInicio} a ${efPeriodoFim}`}/>
        </>)}
      </>)}

      {!realData&&(
        <div style={{padding:40,textAlign:"center",color:TXM,fontSize:12}}>Conecte seus dados para ver o resultado</div>
      )}
    </div>)}

    {aba==="balanco"&&(<div>
      <Tit t="Balanço Patrimonial"/>
      <BalancoPatrimonial empresaId={empresaSel==="consolidado"?(dbCompanies[0]?.id||""):empresaSel.startsWith("group_")?(dbCompanies.find(c=>c.group_id===empresaSel.replace("group_",""))?.id||""):empresaSel} periodoFim={efPeriodoFim}/>
    </div>)}

    {aba==="indicadores"&&(<div>
      <Tit t="Indicadores Fundamentalistas"/>
      <IndicadoresFinanceiros realData={realData} empresaId={empresaSel==="consolidado"?(dbCompanies[0]?.id||""):empresaSel.startsWith("group_")?(dbCompanies.find(c=>c.group_id===empresaSel.replace("group_",""))?.id||""):empresaSel}/>
    </div>)}

    {aba==="financeiro"&&(<div>
      {realData&&(<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
          <KPI r="Receita Operacional" v={`${fmtBRL(realData.total_rec_operacional||realData.total_receitas)}`} d="Faturamento real" ok={true}/>
          <KPI r="Despesas Totais" v={`${fmtBRL(realData.total_despesas)}`} d="Contas a pagar" ok={null}/>
          <KPI r="Resultado Operacional" v={`${fmtBRL(realData.resultado_periodo)}`} d={`Margem ${realData.margem}%`} ok={realData.resultado_periodo>0}/>
          <KPI r="Empréstimos Recebidos" v={`${fmtBRL(realData.total_emprestimos||0)}`} d="Financiamentos, aportes" ok={null}/>
          <KPI r="Clientes" v={realData.total_clientes.toLocaleString("pt-BR")} d="No cadastro do Omie" ok={true}/>
          <KPI r="Empresas" v={`${realData.num_empresas}`} d="CNPJs consolidados" ok={null}/>
        </div>
        <Tit t="Receitas × Despesas × Resultado"/>
        <Card>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={realData.chart_mensal||chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={BD}/>
              <XAxis dataKey="mesLabel" tick={{fontSize:10,fill:'#D4D0C8'}}/>
              <YAxis tick={{fontSize:9,fill:'#D4D0C8'}} tickFormatter={(v:any)=>v.toLocaleString('pt-BR',{maximumFractionDigits:0})}/>
              <Tooltip contentStyle={tt} labelStyle={tl} itemStyle={ti} formatter={fmtTooltip}/>
              <Bar dataKey="receitas" name="Receitas" fill={G} radius={[4,4,0,0]} barSize={14}/>
              <Bar dataKey="despesas" name="Despesas" fill={R} opacity={0.6} radius={[4,4,0,0]} barSize={14}/>
              <Line type="monotone" dataKey="resultado" name="Resultado" stroke={GOL} strokeWidth={2.5} dot={{r:4,fill:GOL}}/>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </>)}

      <Tit t="Fluxo de Caixa — Projeção Diária"/>
      <FluxoCaixa companyIds={empresaSel==="consolidado"?dbCompanies.map(c=>c.id):empresaSel.startsWith("group_")?dbCompanies.filter(c=>c.group_id===empresaSel.replace("group_","")).map(c=>c.id):[empresaSel]}/>

    </div>)}

    {aba==="precos"&&(<div>
      {realData&&realData.top_receitas_operacionais?(<>
        <Tit t="Análise de Receitas por Categoria"/>
        <Card>
          <div style={{fontSize:11,color:TXM,marginBottom:12}}>Receita por categoria do Omie ordenada por valor.</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:400}}>
              <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                <th style={{padding:6,textAlign:"left",color:GOL,fontSize:10}}>Categoria</th>
                <th style={{padding:6,textAlign:"right",color:GOL,fontSize:10}}>Receita Total</th>
                <th style={{padding:6,textAlign:"right",color:GOL,fontSize:10}}>% do Total</th>
              </tr></thead>
              <tbody>
                {realData.top_receitas_operacionais.map((r:any,i:number)=>{
                  const pct=realData.total_rec_operacional>0?((r.valor/realData.total_rec_operacional)*100):0;
                  return(
                    <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`}}>
                      <td style={{padding:6,color:TX,fontWeight:500}}>{decodeHTML(r.nome)}</td>
                      <td style={{padding:6,textAlign:"right",fontWeight:700,color:G}}>{fmtBRL(r.valor)}</td>
                      <td style={{padding:6,textAlign:"right",color:TXM}}>{pct.toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </>):(
        <div style={{padding:40,textAlign:"center",color:TXM,fontSize:12}}>Sem dados para análise de preços</div>
      )}
    </div>)}

    {aba==="relatorio"&&(<div>
      <Tit t="Relatório Executivo — PS Consultor Digital"/>
      
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div onClick={()=>setReportSource("rapido")} style={{
          background:reportSource==="rapido"?"linear-gradient(135deg, #161614, #1E1E1B)":BG2,
          borderRadius:14,padding:18,border:`1px solid ${reportSource==="rapido"?GO+"50":BD}`,cursor:"pointer",transition:"all 0.2s",
        }}>
          <div style={{fontSize:18,marginBottom:6}}>⚡</div>
          <div style={{fontSize:14,fontWeight:600,color:reportSource==="rapido"?GOL:TX}}>Relatório Rápido</div>
          <div style={{fontSize:11,color:TXM,marginTop:4}}>Análise resumida. ~30 segundos.</div>
        </div>
        <div onClick={()=>setReportSource("v19")} style={{
          background:reportSource==="v19"?"linear-gradient(135deg, #1a1510, #161614)":BG2,
          borderRadius:14,padding:18,border:`1px solid ${reportSource==="v19"?GO:BD}`,cursor:"pointer",transition:"all 0.2s",
          position:"relative",overflow:"hidden",
        }}>
          <div style={{position:"absolute",top:8,right:8,fontSize:8,padding:"2px 8px",borderRadius:6,background:`${GO}20`,color:GOL,fontWeight:700,border:`1px solid ${GO}40`}}>CEO EDITION</div>
          <div style={{fontSize:18,marginBottom:6}}>👑</div>
          <div style={{fontSize:14,fontWeight:600,color:reportSource==="v19"?GOL:TX}}>Relatório V19 — 18 Slides</div>
          <div style={{fontSize:11,color:TXM,marginTop:4}}>Nível Conselho de Administração. ~2 minutos.</div>
        </div>
      </div>

      <Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:16}}>
          <div>
            <div style={{fontSize:10,color:TXM,marginBottom:4}}>Período</div>
            <div style={{fontSize:13,fontWeight:600,color:GOL}}>{filtroTipo==="mes"?fmtMesLabel(efPeriodoInicio):efPeriodoInicio} a {filtroTipo==="mes"?fmtMesLabel(efPeriodoFim):efPeriodoFim}</div>
          </div>
          <div>
            <div style={{fontSize:10,color:TXM,marginBottom:4}}>Empresa</div>
            <div style={{fontSize:13,fontWeight:600,color:TX}}>{empresaAtiva.nome}</div>
          </div>
          <div>
            <div style={{fontSize:10,color:TXM,marginBottom:4}}>Dados</div>
            <div style={{fontSize:11,color:TX}}>{realData?`${fmtBRL(realData.total_rec_operacional||0)} receitas`:"Carregando..."}</div>
          </div>
        </div>

        <button onClick={async()=>{
          if(!realData) return;
          setReportLoading(true);
          setReportText("");
          try {
            if(reportSource==="v19"){
              let compIds: string[];
              if(empresaSel==="consolidado") compIds=dbCompanies.map(c=>c.id);
              else if(empresaSel.startsWith("group_")) compIds=dbCompanies.filter(c=>c.group_id===empresaSel.replace("group_","")).map(c=>c.id);
              else compIds=[empresaSel];
              const res=await fetch("/api/report/v19",{
                method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({company_ids:compIds,periodo_inicio:efPeriodoInicio,periodo_fim:efPeriodoFim,empresa_nome:empresaAtiva.nome})
              });
              const text=await res.text();
              try{const d=JSON.parse(text);if(d.success)setReportText(d.report);else setReportText("⚠️ Erro: "+(d.error||"desconhecido"));}
              catch{setReportText("⚠️ Erro: Resposta inválida");}
            } else {
              const res=await fetch("/api/report",{
                method:"POST",headers:{"Content-Type":"application/json"},
                body:JSON.stringify({financial_data:realData,periodo_inicio:efPeriodoInicio,periodo_fim:efPeriodoFim,empresa_nome:empresaAtiva.nome})
              });
              const text=await res.text();
              try{const d=JSON.parse(text);if(d.success)setReportText(d.report);else setReportText("⚠️ Erro: "+(d.error||"desconhecido"));}
              catch{setReportText("⚠️ Erro: Resposta inválida");}
            }
          } catch(e:any) { setReportText("⚠️ Erro: "+e.message); }
          setReportLoading(false);
        }} disabled={reportLoading||!realData} style={{
          width:"100%",padding:16,border:"none",borderRadius:12,
          background:reportLoading?BD:reportSource==="v19"?`linear-gradient(135deg, #8B6914, ${GO}, ${GOL})`:
            `linear-gradient(135deg,${GO} 0%,${GOL} 100%)`,
          color:reportLoading?TXM:BG,fontSize:14,fontWeight:700,cursor:reportLoading?"wait":"pointer",
        }}>
          {reportLoading?(reportSource==="v19"?"👑 Gerando 18 slides... ~2 min":"⚡ Gerando relatório..."):
            (reportSource==="v19"?"👑 Gerar Relatório V19 — 18 Slides":"⚡ Gerar Relatório Rápido")}
        </button>
      </Card>

      {reportText&&(
        <Card>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:GOL}}>{reportSource==="v19"?"👑 Relatório V19":"⚡ Relatório Rápido"}</div>
              <div style={{fontSize:10,color:TXM}}>{filtroTipo==="mes"?fmtMesLabel(efPeriodoInicio):efPeriodoInicio} a {filtroTipo==="mes"?fmtMesLabel(efPeriodoFim):efPeriodoFim} | {empresaAtiva.nome}</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>{navigator.clipboard.writeText(reportText);showToast2("Copiado!")}} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${GO}`,background:"transparent",color:GO,fontSize:10,cursor:"pointer",fontWeight:600}}>📋 Copiar</button>
              <button onClick={()=>window.print()} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>🖨️ Imprimir</button>
            </div>
          </div>
          <div style={{fontSize:12,color:TX,lineHeight:1.8,whiteSpace:"pre-wrap"}} dangerouslySetInnerHTML={{__html:reportText
            .replace(/--- \[SLIDE (\d+)[^\]]*\] ([^-]+) ---/g,'<div style="margin:24px 0 12px;padding:12px 16px;border-radius:10px;background:linear-gradient(135deg,rgba(198,151,63,0.08),transparent);border:1px solid rgba(198,151,63,0.2);border-left:4px solid #C6973F"><div style="font-size:10px;color:#918C82;letter-spacing:1px;text-transform:uppercase">SLIDE $1</div><div style="font-size:16px;font-weight:700;color:#E8C872;margin-top:4px">$2</div></div>')
            .replace(/^# (.+)/gm,'<h2 style="color:#E8C872;font-size:16px;font-weight:800;margin:20px 0 8px">$1</h2>')
            .replace(/^## (.+)/gm,'<h3 style="color:#E8C872;font-size:14px;font-weight:700;margin:16px 0 6px">$1</h3>')
            .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#F0ECE3">$1</strong>')
            .replace(/^- /gm,'<span style="color:#C6973F;margin-right:4px">▸</span> ')
          }}/>
        </Card>
      )}
    </div>)}

    </div>

    <div style={{textAlign:"center",padding:"24px 16px 20px",borderTop:`1px solid ${BD}`,marginTop:40}}>
      <div style={{fontSize:11,fontWeight:600,color:GOL}}>PS Gestão e Capital — Análises Financeiras</div>
      <div style={{fontSize:9,color:TXD,marginTop:4}}>9 abas · Dados Omie · Análises IA · Relatórios V19</div>
    </div>
  </div>);
}
