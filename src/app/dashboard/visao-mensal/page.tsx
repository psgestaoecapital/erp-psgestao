"use client";
import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

// Padrao Identidade Espresso (RD-34 V5): off-white + espresso + dourado.
// Verde/Vermelho/Azul SO em semaforo (Realizado/Atrasado/No Prazo).
// Tokens espelham @/lib/psgc-tokens (mesmo padrao do PainelExecutivo/Home).
const OW="#FAF7F2",OWD="#F0EAE0",OWDD="#E5DDC8",
  ES="#3D2314",ESL="#5A3A2A",ESD="#2A1A0E",
  GO="#C8941A",GOL="#E8B848",
  // Semaforo (uso EXCLUSIVO em status Realizado/No Prazo/Atrasado)
  G="#5C8D3F",R="#C44536",B="#3D6FA8";
// Alias retrocompat (tabela DRE / fluxo) · todos apontam pra paleta espresso
const BG=OW,BG2=OW,BG3=OWD,BD=OWD,TX=ES,TXM=ESL,TXD=ESL;

const fmtR=(v:number)=>v===0?"—":`R$ ${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fmtRFull=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

type Lanc={dia:number;valor:number;doc:string;obs:string;cliente:string;categoria:string;catCod:string;status:string;venc:string;emis:string;};
type Row={id:string;nome:string;grp:string;total:number;orc:number;dias:Record<number,number>;lancs:Record<number,Lanc[]>;filhos?:Row[];};

// ═══ DEDUP — Remove lançamentos duplicados por chave composta ═══
const dedupLancs=(arr:Lanc[]):Lanc[]=>{
  if(!arr||arr.length===0)return[];
  const seen=new Set<string>();
  return arr.filter(l=>{
    const key=`${l.dia}|${(l.cliente||"").trim().toLowerCase()}|${String(l.valor)}|${(l.doc||"").trim().toLowerCase()}|${(l.obs||l.categoria||"").trim().toLowerCase().slice(0,40)}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
};

// ═══ STATUS VISUAL — Realizado / No Prazo / Atrasado ═══
const statusInfo=(l:Lanc):{cor:string;label:string;icon:string}=>{
  const st=(l.status||"").toUpperCase();
  if(st.includes("RECEBIDO")||st.includes("PAGO")||st.includes("LIQUIDADO")||st==="pago")return{cor:G,label:"Realizado",icon:"✅"};
  // Verificar vencimento
  const hoje=new Date();hoje.setHours(0,0,0,0);
  let dtVenc:Date|null=null;
  if(l.venc){
    const p1=l.venc.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(p1){let a=parseInt(p1[3]);if(p1[3].length===2)a+=2000;dtVenc=new Date(a,parseInt(p1[2])-1,parseInt(p1[1]));}
    const p2=l.venc.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if(!dtVenc&&p2)dtVenc=new Date(parseInt(p2[1]),parseInt(p2[2])-1,parseInt(p2[3]));
  }
  if(st.includes("VENCIDO")||st==="vencido"||(dtVenc&&dtVenc<hoje&&!st.includes("CANCEL")))return{cor:R,label:"Atrasado",icon:"🔴"};
  if(st.includes("CANCEL"))return{cor:TXD,label:"Cancelado",icon:"⚫"};
  return{cor:B,label:"No Prazo",icon:"🔵"};
};

const statusDia=(lancs:Lanc[]):{r:number;p:number;a:number;vr:number;vp:number;va:number}=>{
  let r=0,p=0,a=0,vr=0,vp=0,va=0;
  for(const l of lancs){const s=statusInfo(l);if(s.cor===G){r++;vr+=l.valor;}else if(s.cor===R){a++;va+=l.valor;}else if(s.cor===B){p++;vp+=l.valor;}}
  return{r,p,a,vr,vp,va};
};

const STATUS_EXCL=new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

function classifyDesp(cat:string,nome:string):string{
  const c=cat.toLowerCase();const n=nome.toLowerCase();
  if(c.startsWith("3.04")||n.includes("imposto")||n.includes("icms")||n.includes("iss")||n.includes("pis")||n.includes("cofins")||n.includes("das")||n.includes("irpj")||n.includes("csll")||n.includes("simples")||n.includes("darf")||n.includes("tribut"))return"impostos";
  if(c.startsWith("4.")||c.startsWith("5.")||n.includes("juros")||n.includes("financiamento")||n.includes("parcela")||n.includes("empréstimo")||n.includes("emprestimo")||n.includes("pronampe")||n.includes("fampe")||n.includes("peac")||n.includes("bndes")||n.includes("taxa bancária")||n.includes("iof"))return"financeiro";
  if(c.startsWith("2.01")||c.startsWith("2.02")||c.startsWith("2.03")||n.includes("cmv")||n.includes("matéria")||n.includes("material")||n.includes("insumo")||n.includes("mercadoria")||n.includes("mão de obra")||n.includes("mao de obra")||n.includes("folha")||n.includes("salário")||n.includes("salario")||n.includes("encargo")||n.includes("fgts")||n.includes("inss")||n.includes("férias")||n.includes("13")||n.includes("gps"))return"custos";
  return"despesas";
}

function VisaoMensalPageInner(){
  const searchParams = useSearchParams();
  const empresaParam = searchParams.get("empresa");
  const [companies,setCompanies]=useState<any[]>([]);
  const [groups,setGroups]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [mesAno,setMesAno]=useState(()=>{const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [loading,setLoading]=useState(true);
  const [rows,setRows]=useState<Row[]>([]);
  const [exp,setExp]=useState<Set<string>>(new Set());
  const [tip,setTip]=useState<{x:number;y:number;items:Lanc[]}|null>(null);
  const [totals,setTotals]=useState({rec:0,imp:0,cst:0,dsp:0,fin:0,orcRec:0,orcImp:0,orcCst:0,orcDsp:0,orcFin:0});
  const [fluxo,setFluxo]=useState<{dia:number;ent:number;sai:number;acum:number}[]>([]);
  const [proxLancs,setProxLancs]=useState<{rec:Lanc[];pag:Lanc[]}>({rec:[],pag:[]});

  const [ano,mes]=mesAno.split("-").map(Number);
  const diasN=new Date(ano,mes,0).getDate();
  const dias=Array.from({length:diasN},(_,i)=>i+1);
  const hj=new Date();const dHj=hj.getFullYear()===ano&&hj.getMonth()+1===mes?hj.getDate():0;

  useEffect(()=>{loadCo();},[]);
  useEffect(()=>{if(sel)loadData();},[sel,mesAno]);

  const loadCo=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    const{data:g}=await supabase.from("company_groups").select("*").order("nome");if(g)setGroups(g);
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);
      // Prioridade: 1) URL param, 2) localStorage, 3) primeira empresa
      const s=empresaParam||((typeof window!=="undefined")?localStorage.getItem("ps_empresa_sel"):"")||"";
      if(s==="consolidado"&&d.length>1){setSel("consolidado");}
      else if(s&&s.startsWith("group_")){const gid=s.replace("group_","");const gc=d.filter((c:any)=>c.group_id===gid);setSel(gc.length>0?s:d[0].id);}
      else{const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    }
    setLoading(false);
  };

  const parseDia=(dt:string):number|null=>{
    if(!dt)return null;
    const p1=dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(p1){const d=parseInt(p1[1]),m=parseInt(p1[2]);let a=parseInt(p1[3]);if(p1[3].length===2)a+=2000;if(a===ano&&m===mes)return d;}
    const p2=dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if(p2){if(parseInt(p2[1])===ano&&parseInt(p2[2])===mes)return parseInt(p2[3]);}
    return null;
  };

  const loadData=async()=>{
    setLoading(true);
    let cIds:string[]=[];
    if(sel==="consolidado"){cIds=companies.map(c=>c.id);}
    else if(sel.startsWith("group_")){const gid=sel.replace("group_","");cIds=companies.filter(c=>c.group_id===gid).map(c=>c.id);}else cIds=[sel];

    const[{data:imports},{data:blData},{data:orcData}]=await Promise.all([
      supabase.from("omie_imports").select("import_type,import_data").in("company_id",cIds),
      supabase.from("business_lines").select("*,business_line_keywords(keyword,prioridade)").in("company_id",cIds).order("ln_number"),
      supabase.from("orcamento").select("*").in("company_id",cIds).eq("periodo",mesAno),
    ]);

    const cliMap:Record<string,string>={};const catMap:Record<string,string>={};
    if(imports)for(const imp of imports){
      if(imp.import_type==="clientes"){const cls=imp.import_data?.clientes_cadastro||[];if(Array.isArray(cls))for(const c of cls){const cod=c.codigo_cliente_omie||c.codigo_cliente||c.codigo;cliMap[String(cod)]=c.nome_fantasia||c.razao_social||c.nome||"";}}
      if(imp.import_type==="categorias"){const cats=imp.import_data?.categoria_cadastro||[];if(Array.isArray(cats))for(const c of cats){const cod=c.codigo||c.cCodigo||"";if(cod)catMap[cod]=c.descricao||c.cDescricao||"";}}
    }

    const orcLk:Record<string,number>={};let oRec=0,oImp=0,oCst=0,oDsp=0,oFin=0;
    if(orcData)for(const o of orcData){const k=(o.categoria||"").toLowerCase().trim();orcLk[k]=Number(o.valor_orcado)||0;if(o.tipo==="receita")oRec+=orcLk[k];else{const cls=classifyDesp("",k);if(cls==="impostos")oImp+=orcLk[k];else if(cls==="custos")oCst+=orcLk[k];else if(cls==="financeiro")oFin+=orcLk[k];else oDsp+=orcLk[k];}}

    const lns=(blData||[]).map((b:any)=>({id:b.id,nome:b.name||b.nome||"",keywords:(b.business_line_keywords||[]).map((k:any)=>({kw:(k.keyword||"").toLowerCase(),pr:k.prioridade||1})).sort((a:any,b:any)=>b.pr-a.pr)}));
    const addDia=(obj:Record<number,number>,d:number,v:number)=>{obj[d]=(obj[d]||0)+v;};
    const addLanc=(obj:Record<number,Lanc[]>,d:number,l:Lanc)=>{if(!obj[d])obj[d]=[];obj[d].push(l);};

    // RECEITAS
    const recByLn:Record<string,Record<string,{t:number;d:Record<number,number>;l:Record<number,Lanc[]>}>>={};
    let tRec=0;const entD:Record<number,number>={};
    if(imports)for(const imp of imports){
      if(imp.import_type!=="contas_receber")continue;
      const regs=imp.import_data?.conta_receber_cadastro||[];if(!Array.isArray(regs))continue;
      for(const r of regs){
        const st=(r.status_titulo||"").toUpperCase();if(STATUS_EXCL.has(st))continue;
        const v=Number(r.valor_documento)||0;if(v<=0)continue;
        const dia=parseDia(r.data_previsao||r.data_vencimento||"");if(!dia)continue;
        const cf=String(r.codigo_cliente_fornecedor||"");const nome=cliMap[cf]||`Cliente ${cf}`;
        const cat=r.codigo_categoria||"";const catN=catMap[cat]||r.descricao_categoria||cat;
        let lnId="geral";let bestScore=0;for(const ln of lns){const catLow=catN.toLowerCase();let score=0;for(const k of (ln.keywords||[])){if(catLow.includes(k.kw)){score=k.pr;break;}}if(score===0&&ln.nome&&(catLow.includes(ln.nome.toLowerCase())||ln.nome.toLowerCase().includes(catLow)))score=1;if(score>bestScore){bestScore=score;lnId=ln.id;}}
        if(!recByLn[lnId])recByLn[lnId]={};
        if(!recByLn[lnId][nome])recByLn[lnId][nome]={t:0,d:{},l:{}};
        recByLn[lnId][nome].t+=v;addDia(recByLn[lnId][nome].d,dia,v);
        addLanc(recByLn[lnId][nome].l,dia,{dia,valor:v,doc:r.numero_documento||"",obs:r.observacao||"",cliente:nome,categoria:catN,catCod:cat,status:r.status_titulo||"",venc:r.data_vencimento||"",emis:r.data_emissao||""});
        tRec+=v;addDia(entD,dia,v);
      }
    }

    // ═══ DADOS erp_receber (digitados no PS Gestão) ═══
    const{data:erpRec}=await supabase.from("v_lancamentos_consolidado").select("*").eq("tipo","receber").in("company_id",cIds).neq("status","CANCELADO");
    if(erpRec)for(const r of erpRec){
      const v=Number(r.valor_documento)||0;if(v<=0)continue;
      const dia=parseDia(r.data_previsao||r.data_vencimento||"");if(!dia)continue;
      const nome=r.nome_pessoa||"Cliente";const catN=r.subcategoria||r.categoria||"Outros";
      let lnId="geral";let bestScore=0;for(const ln of lns){const catLow=catN.toLowerCase();let score=0;for(const k of (ln.keywords||[])){if(catLow.includes(k.kw)){score=k.pr;break;}}if(score===0&&ln.nome&&catLow.includes(ln.nome.toLowerCase()))score=1;if(score>bestScore){bestScore=score;lnId=ln.id;}}
      if(!recByLn[lnId])recByLn[lnId]={};
      if(!recByLn[lnId][nome])recByLn[lnId][nome]={t:0,d:{},l:{}};
      recByLn[lnId][nome].t+=v;addDia(recByLn[lnId][nome].d,dia,v);
      addLanc(recByLn[lnId][nome].l,dia,{dia,valor:v,doc:r.numero_documento||"",obs:r.descricao||"",cliente:nome,categoria:catN,catCod:"",status:r.status||"",venc:r.data_vencimento||"",emis:r.data_emissao||""});
      tRec+=v;addDia(entD,dia,v);
    }

    // Build receita tree
    const recFilhos:Row[]=[];
    for(const ln of [...lns,{id:"geral",nome:"Outros"}]){
      const cls=recByLn[ln.id];if(!cls)continue;
      const cRows:Row[]=Object.entries(cls).map(([n,d])=>({id:`r_${ln.id}_${n}`,nome:n,grp:"rec",total:d.t,orc:0,dias:d.d,lancs:d.l})).sort((a,b)=>b.total-a.total);
      if(lns.length>0&&ln.id!=="geral"){
        const lnD:Record<number,number>={};const lnL:Record<number,Lanc[]>={};const lnT=cRows.reduce((s,c)=>s+c.total,0);
        for(const cr of cRows){for(const[d,v]of Object.entries(cr.dias))addDia(lnD,Number(d),v);for(const[d,items]of Object.entries(cr.lancs))for(const it of items)addLanc(lnL,Number(d),it);}
        recFilhos.push({id:`ln_${ln.id}`,nome:`📦 ${ln.nome}`,grp:"rec",total:lnT,orc:orcLk[ln.nome.toLowerCase().trim()]||0,dias:lnD,lancs:lnL,filhos:cRows});
      }else recFilhos.push(...cRows);
    }
    const recD:Record<number,number>={};for(const f of recFilhos)for(const[d,v]of Object.entries(f.dias))addDia(recD,Number(d),v);
    const recRow:Row={id:"REC",nome:"💰 RECEITAS",grp:"rec",total:tRec,orc:oRec,dias:recD,lancs:{},filhos:recFilhos};

    // DESPESAS — separar em 4 grupos
    const grpData:Record<string,Record<string,{t:number;d:Record<number,number>;l:Record<number,Lanc[]>}>>={impostos:{},custos:{},despesas:{},financeiro:{}};
    let tImp=0,tCst=0,tDsp=0,tFin=0;const saiD:Record<number,number>={};

    if(imports)for(const imp of imports){
      if(imp.import_type!=="contas_pagar")continue;
      const regs=imp.import_data?.conta_pagar_cadastro||[];if(!Array.isArray(regs))continue;
      for(const r of regs){
        const st=(r.status_titulo||"").toUpperCase();if(STATUS_EXCL.has(st))continue;
        const v=Number(r.valor_documento)||0;if(v<=0)continue;
        const dia=parseDia(r.data_previsao||r.data_vencimento||"");if(!dia)continue;
        const cat=r.codigo_categoria||"sem_cat";const catN=catMap[cat]||r.descricao_categoria||cat;
        const cf=String(r.codigo_cliente_fornecedor||"");const forn=r.observacao||cliMap[cf]||`Forn ${cf}`;
        const cls=classifyDesp(cat,catN);
        const gk=catN||cat;
        if(!grpData[cls][gk])grpData[cls][gk]={t:0,d:{},l:{}};
        grpData[cls][gk].t+=v;addDia(grpData[cls][gk].d,dia,v);
        addLanc(grpData[cls][gk].l,dia,{dia,valor:v,doc:r.numero_documento||"",obs:r.observacao||"",cliente:forn,categoria:catN,catCod:cat,status:r.status_titulo||"",venc:r.data_vencimento||"",emis:r.data_emissao||""});
        if(cls==="impostos")tImp+=v;else if(cls==="custos")tCst+=v;else if(cls==="financeiro")tFin+=v;else tDsp+=v;
        addDia(saiD,dia,v);
      }
    }

    // ═══ DADOS erp_pagar (digitados no PS Gestão) ═══
    const{data:erpPag}=await supabase.from("v_lancamentos_consolidado").select("*").eq("tipo","pagar").in("company_id",cIds).neq("status","CANCELADO");
    if(erpPag)for(const r of erpPag){
      const v=Number(r.valor_documento)||0;if(v<=0)continue;
      const dia=parseDia(r.data_previsao||r.data_vencimento||"");if(!dia)continue;
      const catN=r.subcategoria||r.categoria||"Outros";
      const forn=r.nome_pessoa||"Fornecedor";
      const cls=classifyDesp(r.categoria||"",catN);
      const gk=catN;
      if(!grpData[cls][gk])grpData[cls][gk]={t:0,d:{},l:{}};
      grpData[cls][gk].t+=v;addDia(grpData[cls][gk].d,dia,v);
      addLanc(grpData[cls][gk].l,dia,{dia,valor:v,doc:r.numero_documento||"",obs:r.descricao||"",cliente:forn,categoria:catN,catCod:"",status:r.status||"",venc:r.data_vencimento||"",emis:r.data_emissao||""});
      if(cls==="impostos")tImp+=v;else if(cls==="custos")tCst+=v;else if(cls==="financeiro")tFin+=v;else tDsp+=v;
      addDia(saiD,dia,v);
    }

    const buildGrp=(key:string,nome:string,icon:string,grp:string,orc:number):Row=>{
      const cats=grpData[key];
      const filhos:Row[]=Object.entries(cats).map(([n,d])=>({id:`${key}_${n}`,nome:n,grp,total:d.t,orc:orcLk[n.toLowerCase().trim()]||0,dias:d.d,lancs:d.l})).sort((a,b)=>b.total-a.total);
      const gD:Record<number,number>={};const gL:Record<number,Lanc[]>={};const gT=filhos.reduce((s,f)=>s+f.total,0);
      for(const f of filhos){for(const[d,v]of Object.entries(f.dias))addDia(gD,Number(d),v);for(const[d,items]of Object.entries(f.lancs))for(const it of items)addLanc(gL,Number(d),it);}
      return{id:key.toUpperCase(),nome:`${icon} ${nome}`,grp,total:gT,orc,dias:gD,lancs:gL,filhos};
    };

    const impRow=buildGrp("impostos","(-) IMPOSTOS E TRIBUTOS","🏛️","imp",oImp);
    const cstRow=buildGrp("custos","(-) CUSTOS DIRETOS","🏭","cst",oCst);
    const dspRow=buildGrp("despesas","(-) DESPESAS OPERACIONAIS","🏢","dsp",oDsp);
    const finRow=buildGrp("financeiro","(-) RESULTADO FINANCEIRO","🏦","fin",oFin);

    // Margem bruta
    const mgD:Record<number,number>={};for(const d of dias)mgD[d]=(recD[d]||0)-(impRow.dias[d]||0)-(cstRow.dias[d]||0);
    const mgRow:Row={id:"MARGEM",nome:"📊 = MARGEM BRUTA",grp:"res",total:tRec-tImp-tCst,orc:oRec-oImp-oCst,dias:mgD,lancs:{}};

    // EBITDA
    const ebD:Record<number,number>={};for(const d of dias)ebD[d]=(mgD[d]||0)-(dspRow.dias[d]||0);
    const ebRow:Row={id:"EBITDA",nome:"📈 = EBITDA",grp:"res",total:tRec-tImp-tCst-tDsp,orc:oRec-oImp-oCst-oDsp,dias:ebD,lancs:{}};

    // Resultado
    const resD:Record<number,number>={};for(const d of dias)resD[d]=(ebD[d]||0)-(finRow.dias[d]||0);
    const resRow:Row={id:"RESULTADO",nome:"🎯 = RESULTADO FINAL",grp:"res",total:tRec-tImp-tCst-tDsp-tFin,orc:oRec-oImp-oCst-oDsp-oFin,dias:resD,lancs:{}};

    setRows([recRow,impRow,cstRow,mgRow,dspRow,ebRow,finRow,resRow]);
    setTotals({rec:tRec,imp:tImp,cst:tCst,dsp:tDsp,fin:tFin,orcRec:oRec,orcImp:oImp,orcCst:oCst,orcDsp:oDsp,orcFin:oFin});

    let ac=0;setFluxo(dias.map(d=>{const e=entD[d]||0;const s=saiD[d]||0;ac+=e-s;return{dia:d,ent:e,sai:s,acum:ac};}));

    // ═══ Proximos 5 dias (hoje + 4) — COM DEDUP ═══
    const hojeD=dHj||1;
    const ate=hojeD+4;
    const coletaRec:Lanc[]=[];const coletaPag:Lanc[]=[];
    // Coletar de recFilhos (receitas)
    const walkRec=(r:Row)=>{
      if(r.filhos&&r.filhos.length>0){for(const f of r.filhos)walkRec(f);}
      else if(r.lancs){for(const[d,items]of Object.entries(r.lancs))for(const it of items)if(Number(d)>=hojeD&&Number(d)<=ate)coletaRec.push({...it,dia:Number(d)});}
    };
    // recRow.filhos contem os lancamentos de receitas
    if(recRow.filhos)for(const f of recRow.filhos)walkRec(f);
    // Coletar de despesas
    const walkPag=(r:Row)=>{
      if(r.filhos&&r.filhos.length>0){for(const f of r.filhos)walkPag(f);}
      else if(r.lancs){for(const[d,items]of Object.entries(r.lancs))for(const it of items)if(Number(d)>=hojeD&&Number(d)<=ate)coletaPag.push({...it,dia:Number(d)});}
    };
    if(impRow.filhos)for(const f of impRow.filhos)walkPag(f);
    if(cstRow.filhos)for(const f of cstRow.filhos)walkPag(f);
    if(dspRow.filhos)for(const f of dspRow.filhos)walkPag(f);
    if(finRow.filhos)for(const f of finRow.filhos)walkPag(f);

    // ✅ FIX v8.8.0: Dedup + sort antes de setar estado
    const recDedup = dedupLancs(coletaRec);
    const pagDedup = dedupLancs(coletaPag);
    recDedup.sort((a,b)=>a.dia-b.dia);
    pagDedup.sort((a,b)=>a.dia-b.dia);
    setProxLancs({rec:recDedup,pag:pagDedup});
    setLoading(false);
  };

  const toggle=(id:string)=>{const s=new Set(exp);if(s.has(id))s.delete(id);else s.add(id);setExp(s);};
  const showTip=(e:React.MouseEvent,items:Lanc[])=>{if(!items?.length)return;setTip({x:Math.min(e.clientX,innerWidth-300),y:Math.min(e.clientY+10,innerHeight-200),items});};

  const mOps:string[]=[];for(let a=2025;a<=2027;a++)for(let m=1;m<=12;m++)mOps.push(`${a}-${String(m).padStart(2,"0")}`);
  const nMes=(ma:string)=>{const[a,m]=ma.split("-");return`${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(m)-1]} ${a}`;};

  // Labels DRE em espresso · destaque dourado so no Resultado (=).
  // Sem decoracao arco-iris (RD-34 V5 · disciplina de cor).
  const grpColor:Record<string,string>={rec:ES,imp:ES,cst:ES,dsp:ES,fin:ES,res:GO};
  // Valor: semaforo so em receita/resultado (positivo verde, negativo vermelho).
  // Demais grupos em espresso · numero "fala por si" sem cor decorativa.
  const valC=(v:number,g:string)=>v===0?ESL:g==="rec"||g==="res"?(v>0?G:R):ES;

  const renderRow=(r:Row,depth:number,isP:boolean)=>{
    const hasF=r.filhos&&r.filhos.length>0;const isO=exp.has(r.id);const isRes=r.grp==="res";
    const bg=isRes?GO+"12":isP?OWD+"60":"transparent";
    const vP=r.orc>0?((r.total/r.orc-1)*100):null;
    // Var %: receita - positivo verde; despesas - cinza/atencao; orcamento + de 5% -> alerta.
    const vC=vP===null?ESL:r.grp==="rec"?(vP>=0?G:R):(vP>5?R:ESL);
    return(
      <tr key={r.id} style={{background:bg,borderBottom:`0.5px solid ${OWD}80`}}>
        <td onClick={hasF?()=>toggle(r.id):undefined} style={{padding:"6px",paddingLeft:8+depth*16,fontSize:isP?11:10,fontWeight:isP?700:400,color:isP?(grpColor[r.grp]||ES):depth===1?ES:ESL,whiteSpace:"nowrap",cursor:hasF?"pointer":"default",position:"sticky",left:0,background:bg||OW,zIndex:2,minWidth:200,borderRight:`1px solid ${OWD}`}}>
          {hasF&&<span style={{fontSize:8,color:GO,marginRight:4}}>{isO?"▼":"▶"}</span>}{r.nome}
        </td>
        <td style={{padding:"6px",textAlign:"right",fontWeight:700,color:valC(r.total,r.grp),fontSize:isP?11:10,whiteSpace:"nowrap",borderRight:`1px solid ${OWD}`,position:"sticky",left:200,background:bg||OW,zIndex:2,fontVariantNumeric:"tabular-nums"}}>{r.total===0?"—":fmtR(r.total)}</td>
        <td style={{padding:"6px",textAlign:"right",fontSize:10,color:r.orc>0?ESL:ESL+"99",borderRight:`1px solid ${OWD}`,position:"sticky",left:275,background:bg||OW,zIndex:2,fontVariantNumeric:"tabular-nums"}}>{r.orc>0?fmtR(r.orc):"—"}</td>
        <td style={{padding:"6px",textAlign:"right",fontSize:10,fontWeight:600,color:vC,borderRight:`1px solid ${OWD}`,position:"sticky",left:340,background:bg||OW,zIndex:2,minWidth:45,fontVariantNumeric:"tabular-nums"}}>{vP!==null?`${vP>0?"+":""}${vP.toFixed(0)}%`:"—"}</td>
        {dias.map(d=>{const v=r.dias[d]||0;const it=r.lancs?.[d]||[];const iT=d===dHj;
          const st=it.length>0?statusDia(it):null;
          return <td key={d} onMouseEnter={it.length>0?(e)=>showTip(e,it):undefined} onMouseLeave={()=>setTip(null)}
            style={{padding:"4px 3px",textAlign:"right",fontSize:9,color:v===0?"transparent":valC(v,r.grp),fontWeight:v>0&&isP?600:400,whiteSpace:"nowrap",cursor:it.length>0?"help":"default",background:iT?GO+"15":st&&st.a>0?R+"10":"transparent",borderRight:d%7===0?`1px solid ${OWD}`:"none",minWidth:48,position:"relative",fontVariantNumeric:"tabular-nums"}}>
            {v===0?"·":fmtR(v)}
            {st&&it.length>0&&<div style={{display:"flex",gap:1,justifyContent:"center",marginTop:1}}>
              {st.r>0&&<div style={{width:5,height:5,borderRadius:3,background:G}} title={`${st.r} realizado(s)`}/>}
              {st.p>0&&<div style={{width:5,height:5,borderRadius:3,background:B}} title={`${st.p} no prazo`}/>}
              {st.a>0&&<div style={{width:5,height:5,borderRadius:3,background:R}} title={`${st.a} atrasado(s)`}/>}
            </div>}
          </td>;
        })}
      </tr>
    );
  };

  const renderTree=(rows:Row[])=>{
    const res:React.ReactElement[]=[];
    for(const r of rows){res.push(renderRow(r,0,true));
      if(exp.has(r.id)&&r.filhos){for(const f of r.filhos){res.push(renderRow(f,1,!!(f.filhos?.length)));
        if(exp.has(f.id)&&f.filhos){for(const n of f.filhos)res.push(renderRow(n,2,false));}
      }}
    }return res;
  };

  const ss:React.CSSProperties={background:OW,border:`1px solid ${OWD}`,color:ES,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const mxF=Math.max(...fluxo.map(f=>Math.max(f.ent,f.sai,Math.abs(f.acum))),1);
  const tDesp=totals.imp+totals.cst+totals.dsp+totals.fin;
  const resultado=totals.rec-tDesp;

  return(
    <div style={{minHeight:"100vh",background:OW,padding:16,color:ES}} onClick={()=>setTip(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:18,fontWeight:800,color:ES,letterSpacing:-0.3}}>📅 Visão Diária — {nMes(mesAno)}</div>
          <div style={{fontSize:11,color:ESL}}>DRE diário com 5 níveis · Expandir por negócio/cliente/fornecedor</div>
        </div>
        <div style={{display:"flex",gap:12,alignItems:"center",marginRight:8}}>
          {/* Semaforo (uso exclusivo · realizacao/prazo/atraso) */}
          <div style={{display:"flex",gap:4,alignItems:"center"}}><div style={{width:8,height:8,borderRadius:4,background:G}}/><span style={{fontSize:10,color:ESL,fontWeight:600}}>Realizado</span></div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}><div style={{width:8,height:8,borderRadius:4,background:B}}/><span style={{fontSize:10,color:ESL,fontWeight:600}}>No Prazo</span></div>
          <div style={{display:"flex",gap:4,alignItems:"center"}}><div style={{width:8,height:8,borderRadius:4,background:R}}/><span style={{fontSize:10,color:ESL,fontWeight:600}}>Atrasado</span></div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={ss}>
            {companies.length>1&&<option value="consolidado">📊 Consolidado (todas)</option>}
            {groups.map(g=>{const gc=companies.filter(c=>c.group_id===g.id);if(!gc.length)return null;return[<option key={`g_${g.id}`} value={`group_${g.id}`}>📁 {g.nome}</option>,...gc.map(c=><option key={c.id} value={c.id}>&nbsp;&nbsp;{c.nome_fantasia||c.razao_social}</option>)];})}
            {companies.filter(c=>!c.group_id||!groups.find((g:any)=>g.id===c.group_id)).map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <select value={mesAno} onChange={e=>setMesAno(e.target.value)} style={ss}>{mOps.map(m=><option key={m} value={m}>{nMes(m)}</option>)}</select>
          <a href="/dashboard" style={{padding:"6px 12px",border:`1px solid ${OWD}`,borderRadius:8,color:ES,fontSize:11,textDecoration:"none",background:OW}}>← Dashboard</a>
        </div>
      </div>

      {/* KPI grid · padrao PainelExecutivo (off-white + espresso + dourado).
          Sem cor decorativa por categoria · numero em linha unica (nowrap).
          Responsivo: auto-fit minmax(150px) -> 2 cols 360px, 4-5 cols tablet, 8 desktop. */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:10,marginBottom:14}}>
        {(()=>{
          const ebitda=totals.rec-totals.imp-totals.cst-totals.dsp;
          const mBruta=totals.rec>0?((totals.rec-totals.imp-totals.cst)/totals.rec*100):null;
          const cards=[
            {l:"Receitas",v:fmtR(totals.rec),cor:totals.rec>0?G:ES},
            {l:"Impostos",v:fmtR(totals.imp),cor:ES},
            {l:"Custos Dir.",v:fmtR(totals.cst),cor:ES},
            {l:"Desp. Oper.",v:fmtR(totals.dsp),cor:ES},
            {l:"Financeiro",v:fmtR(totals.fin),cor:ES},
            {l:"Margem Bruta",v:mBruta!==null?`${mBruta.toFixed(1)}%`:"—",cor:mBruta!==null&&mBruta>0?G:R},
            {l:"EBITDA",v:fmtR(ebitda),cor:ebitda>=0?G:R},
            {l:"Resultado",v:fmtR(resultado),cor:resultado>=0?G:R,destaque:true},
          ];
          return cards.map((k,i)=>(
            <div key={i} style={{
              background:OW,
              borderRadius:12,
              padding:"12px 14px",
              border:`1px solid ${k.destaque?GO:OWD}`,
              boxShadow:k.destaque?"0 1px 2px rgba(61,35,20,0.06)":"none",
            }}>
              <div style={{fontSize:9,color:ESL,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:6,whiteSpace:"nowrap"}}>{k.l}</div>
              <div style={{fontSize:16,fontWeight:800,color:k.cor,letterSpacing:-0.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontVariantNumeric:"tabular-nums"}}>{k.v}</div>
            </div>
          ));
        })()}
      </div>

      {loading&&<div style={{textAlign:"center",padding:40,color:ESL,fontSize:12}}>⏳ Carregando...</div>}

      {!loading&&rows.length>0&&(
        <div style={{background:OW,borderRadius:12,border:`1px solid ${OWD}`,overflow:"auto",WebkitOverflowScrolling:"touch",maxHeight:"50vh",marginBottom:16}}>
          <table style={{borderCollapse:"collapse",fontSize:10,width:"max-content",minWidth:"100%"}}>
            <thead><tr style={{borderBottom:`2px solid ${GO}`,background:OW}}>
              <th style={{padding:"8px 6px",textAlign:"left",color:ES,fontSize:10,fontWeight:700,letterSpacing:0.5,position:"sticky",left:0,background:OW,zIndex:3,minWidth:200,borderRight:`1px solid ${OWD}`}}>Categoria</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:ES,fontSize:10,fontWeight:700,letterSpacing:0.5,position:"sticky",left:200,background:OW,zIndex:3,borderRight:`1px solid ${OWD}`,minWidth:75}}>Real</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:ES,fontSize:10,fontWeight:700,letterSpacing:0.5,position:"sticky",left:275,background:OW,zIndex:3,borderRight:`1px solid ${OWD}`,minWidth:65}}>Orçado</th>
              <th style={{padding:"8px 6px",textAlign:"right",color:ES,fontSize:10,fontWeight:700,letterSpacing:0.5,position:"sticky",left:340,background:OW,zIndex:3,borderRight:`1px solid ${OWD}`,minWidth:45}}>Var</th>
              {dias.map(d=>{const dow=new Date(ano,mes-1,d).getDay();const wk=dow===0||dow===6;const t=d===dHj;
                return <th key={d} style={{padding:"6px 2px",textAlign:"center",fontSize:9,color:t?GO:wk?ESL+"80":ESL,background:t?GO+"15":OW,fontWeight:t?700:500,minWidth:48,borderRight:d%7===0?`1px solid ${OWD}`:"none"}}><div>{d}</div><div style={{fontSize:7}}>{["D","S","T","Q","Q","S","S"][dow]}</div></th>;
              })}
            </tr></thead>
            <tbody>{renderTree(rows)}</tbody>
          </table>
        </div>
      )}

      {!loading&&fluxo.length>0&&(
        <div style={{background:OW,borderRadius:12,border:`1px solid ${OWD}`,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:ES,marginBottom:14,letterSpacing:0.3}}>💵 Fluxo de Caixa — {nMes(mesAno)}</div>
          {/* Container do grafico · padding lateral pros rotulos R$ nao cortarem (PASSO 5) */}
          <div style={{position:"relative",height:160,marginBottom:8,paddingLeft:8,paddingRight:88,borderTop:`1px solid ${OWD}`,borderBottom:`1px solid ${OWD}`}}>
            {/* Linha do zero */}
            {(()=>{
              const vals=fluxo.map(f=>f.acum);
              const mxP=Math.max(...vals,0);
              const mxN=Math.min(...vals,0);
              const range=mxP-mxN||1;
              const zeroY=(mxP/range)*100;
              return(
                <>
                  <div style={{position:"absolute",left:8,right:88,top:`${zeroY}%`,borderTop:`1px dashed ${GO}90`,zIndex:1}}/>
                  <div style={{position:"absolute",left:0,top:`calc(${zeroY}% - 14px)`,fontSize:9,color:GO,fontWeight:600,zIndex:2,padding:"0 4px",background:OW,fontVariantNumeric:"tabular-nums"}}>R$ 0</div>
                  {/* Rotulos max/min · agora no padding direito reservado (84px) · texto inteiro */}
                  <div style={{position:"absolute",right:4,top:4,fontSize:10,color:G,fontWeight:700,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{fmtR(mxP)}</div>
                  <div style={{position:"absolute",right:4,bottom:4,fontSize:10,color:R,fontWeight:700,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{fmtR(mxN)}</div>
                  <div style={{display:"flex",gap:0,height:"100%",alignItems:"stretch"}}>
                    {fluxo.map((f,i)=>{
                      const hPos=f.acum>0?(f.acum/range)*100:0;
                      const hNeg=f.acum<0?(Math.abs(f.acum)/range)*100:0;
                      return(
                        <div key={i} style={{flex:1,position:"relative",display:"flex",flexDirection:"column",alignItems:"center"}}
                          onMouseEnter={(e)=>showTip(e,[{dia:f.dia,valor:f.acum,doc:`Entrada: ${fmtRFull(f.ent)}`,obs:`Sa\u00edda: ${fmtRFull(f.sai)}`,cliente:`Saldo dia: ${fmtRFull(f.ent-f.sai)}`,categoria:`Acum: ${fmtRFull(f.acum)}`,catCod:"",status:"",venc:"",emis:""}])} onMouseLeave={()=>setTip(null)}>
                          {f.acum>0&&<div style={{width:"70%",height:`${hPos}%`,background:`linear-gradient(180deg,${G},${G}AA)`,borderRadius:"2px 2px 0 0",position:"absolute",bottom:`${100-zeroY}%`,border:f.dia===dHj?`1px solid ${GO}`:"none",cursor:"help"}}/>}
                          {f.acum<0&&<div style={{width:"70%",height:`${hNeg}%`,background:`linear-gradient(0deg,${R},${R}AA)`,borderRadius:"0 0 2px 2px",position:"absolute",top:`${zeroY}%`,border:f.dia===dHj?`1px solid ${GO}`:"none",cursor:"help"}}/>}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
          <div style={{display:"flex",paddingLeft:8,paddingRight:88}}>{fluxo.map((f,i)=><div key={i} style={{flex:1,textAlign:"center",fontSize:8,color:f.dia===dHj?GO:ESL,fontWeight:f.dia===dHj?700:400}}>{f.dia}</div>)}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:10,marginTop:14}}>
            {[
              {l:"Entradas",v:fmtRFull(fluxo.reduce((s,f)=>s+f.ent,0)),c:G},
              {l:"Saídas",v:fmtRFull(fluxo.reduce((s,f)=>s+f.sai,0)),c:R},
              {l:"Saldo Final",v:fmtRFull(fluxo[fluxo.length-1]?.acum||0),c:fluxo[fluxo.length-1]?.acum>=0?G:R},
              {l:"Pico Negativo",v:fluxo.some(f=>f.acum<0)?`Dia ${fluxo.reduce((m,f)=>f.acum<m.acum?f:m).dia}`:"Nenhum",c:fluxo.some(f=>f.acum<0)?R:G},
            ].map((k,i)=>(
              <div key={i} style={{background:OW,borderRadius:10,padding:"10px 12px",border:`1px solid ${OWD}`}}>
                <div style={{fontSize:9,color:ESL,fontWeight:700,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{k.l}</div>
                <div style={{fontSize:14,fontWeight:800,color:k.c,letterSpacing:-0.2,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tip&&(
        <div style={{position:"fixed",left:tip.x,top:tip.y,background:OW,border:`1px solid ${GO}80`,borderRadius:10,padding:12,zIndex:9999,maxWidth:340,boxShadow:"0 8px 24px rgba(61,35,20,0.18)"}}>
          <div style={{fontSize:10,fontWeight:700,color:ES,marginBottom:6,letterSpacing:0.4,textTransform:"uppercase"}}>{tip.items.length} lançamento(s)</div>
          {(()=>{const sd=statusDia(tip.items);return sd.r+sd.p+sd.a>0?(
            <div style={{display:"flex",gap:8,marginBottom:8,padding:"4px 6px",background:OWD+"60",borderRadius:6,flexWrap:"wrap"}}>
              {sd.r>0&&<span style={{fontSize:9,color:G,fontWeight:600}}>✅ {sd.r} realiz. ({fmtRFull(sd.vr)})</span>}
              {sd.p>0&&<span style={{fontSize:9,color:B,fontWeight:600}}>🔵 {sd.p} no prazo ({fmtRFull(sd.vp)})</span>}
              {sd.a>0&&<span style={{fontSize:9,color:R,fontWeight:600}}>🔴 {sd.a} atras. ({fmtRFull(sd.va)})</span>}
            </div>
          ):null;})()}
          {tip.items.slice(0,5).map((it,i)=>{const si=statusInfo(it);return(
            <div key={i} style={{padding:"4px 0",borderBottom:i<tip.items.length-1?`0.5px solid ${OWD}`:"none",fontSize:10,borderLeft:`3px solid ${si.cor}`,paddingLeft:8,marginBottom:2}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:ES,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmtRFull(it.valor)}</span>
                <span style={{fontSize:8,padding:"1px 5px",borderRadius:3,background:si.cor+"20",color:si.cor,fontWeight:700}}>{si.label}</span>
              </div>
              <div style={{color:ES}}>{it.cliente}</div>
              <div style={{color:ESL,fontSize:9}}>{it.categoria}{it.doc&&` · ${it.doc}`}{it.venc&&` · Venc: ${it.venc}`}</div>
              {it.obs&&<div style={{color:ESL,fontSize:9,fontStyle:"italic"}}>{it.obs}</div>}
            </div>
          );})}
          {tip.items.length>5&&<div style={{fontSize:9,color:ESL,marginTop:4}}>+{tip.items.length-5} mais</div>}
        </div>
      )}
      {/* TABELAS DETALHE 5 DIAS */}
      {!loading&&(proxLancs.rec.length>0||proxLancs.pag.length>0)&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",gap:12,marginTop:16}}>
          {/* CONTAS A RECEBER · header em espresso (sem decoracao verde) ·
              valor total verde mantido (sinaliza entrada). */}
          <div style={{background:OW,borderRadius:12,border:`1px solid ${OWD}`,borderLeft:`3px solid ${G}`,padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:ES,marginBottom:10,display:"flex",alignItems:"center",gap:8,letterSpacing:0.3,textTransform:"uppercase"}}>
              📥 Contas a Receber · Próximos 5 dias
              <span style={{fontSize:10,color:ESL,fontWeight:500,textTransform:"none"}}>({proxLancs.rec.length} lanç.)</span>
              <span style={{marginLeft:"auto",fontSize:13,color:G,fontWeight:800,fontVariantNumeric:"tabular-nums"}}>{fmtR(proxLancs.rec.reduce((s,l)=>s+l.valor,0))}</span>
            </div>
            {proxLancs.rec.length===0?(
              <div style={{padding:20,textAlign:"center",fontSize:11,color:ESL}}>Nenhuma receita nos próximos 5 dias</div>
            ):(
              <div style={{overflowY:"auto",maxHeight:320}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead style={{position:"sticky",top:0,background:OW,zIndex:1}}>
                    <tr style={{borderBottom:`1px solid ${OWD}`}}>
                      <th style={{padding:"6px 4px",textAlign:"left",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Dia</th>
                      <th style={{padding:"6px 4px",textAlign:"left",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Cliente</th>
                      <th style={{padding:"6px 4px",textAlign:"left",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Descrição</th>
                      <th style={{padding:"6px 4px",textAlign:"right",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proxLancs.rec.map((l,i)=>{const si=statusInfo(l);return(
                      <tr key={i} style={{borderBottom:`0.5px solid ${OWD}`,borderLeft:`2px solid ${si.cor}`}}>
                        <td style={{padding:"5px 4px",fontWeight:l.dia===dHj?700:400,color:l.dia===dHj?GO:ES,whiteSpace:"nowrap"}}>
                          {l.dia===dHj?"HOJE":`${String(l.dia).padStart(2,"0")}/${String(mes).padStart(2,"0")}`}
                        </td>
                        <td style={{padding:"5px 4px",color:ES,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.cliente}>{l.cliente}</td>
                        <td style={{padding:"5px 4px",color:ESL,fontSize:9,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.obs||l.categoria}>{l.obs||l.categoria}</td>
                        <td style={{padding:"5px 4px",textAlign:"right",color:G,fontWeight:700,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{fmtR(l.valor)}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* CONTAS A PAGAR */}
          <div style={{background:OW,borderRadius:12,border:`1px solid ${OWD}`,borderLeft:`3px solid ${R}`,padding:16}}>
            <div style={{fontSize:12,fontWeight:700,color:ES,marginBottom:10,display:"flex",alignItems:"center",gap:8,letterSpacing:0.3,textTransform:"uppercase"}}>
              📤 Contas a Pagar · Próximos 5 dias
              <span style={{fontSize:10,color:ESL,fontWeight:500,textTransform:"none"}}>({proxLancs.pag.length} lanç.)</span>
              <span style={{marginLeft:"auto",fontSize:13,color:R,fontWeight:800,fontVariantNumeric:"tabular-nums"}}>{fmtR(proxLancs.pag.reduce((s,l)=>s+l.valor,0))}</span>
            </div>
            {proxLancs.pag.length===0?(
              <div style={{padding:20,textAlign:"center",fontSize:11,color:ESL}}>Nenhuma despesa nos próximos 5 dias</div>
            ):(
              <div style={{overflowY:"auto",maxHeight:320}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead style={{position:"sticky",top:0,background:OW,zIndex:1}}>
                    <tr style={{borderBottom:`1px solid ${OWD}`}}>
                      <th style={{padding:"6px 4px",textAlign:"left",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Dia</th>
                      <th style={{padding:"6px 4px",textAlign:"left",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Fornecedor</th>
                      <th style={{padding:"6px 4px",textAlign:"left",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Descrição</th>
                      <th style={{padding:"6px 4px",textAlign:"right",fontSize:9,color:ES,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proxLancs.pag.map((l,i)=>{const si=statusInfo(l);return(
                      <tr key={i} style={{borderBottom:`0.5px solid ${OWD}`,borderLeft:`2px solid ${si.cor}`}}>
                        <td style={{padding:"5px 4px",fontWeight:l.dia===dHj?700:400,color:l.dia===dHj?GO:ES,whiteSpace:"nowrap"}}>
                          {l.dia===dHj?"HOJE":`${String(l.dia).padStart(2,"0")}/${String(mes).padStart(2,"0")}`}
                        </td>
                        <td style={{padding:"5px 4px",color:ES,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.cliente}>{l.cliente}</td>
                        <td style={{padding:"5px 4px",color:ESL,fontSize:9,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={l.obs||l.categoria}>{l.obs||l.categoria}</td>
                        <td style={{padding:"5px 4px",textAlign:"right",color:R,fontWeight:700,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{fmtR(l.valor)}</td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:ESL,textAlign:"center",marginTop:12,letterSpacing:0.5}}>PS Gestão e Capital — Visão Diária v8.8.0</div>
    </div>
  );
}


export default function VisaoMensalPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-muted-foreground">Carregando...</div>}>
      <VisaoMensalPageInner />
    </Suspense>
  )
}
