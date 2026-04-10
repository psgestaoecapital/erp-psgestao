"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>v===0?"—":`R$ ${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fmtRFull=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

type Lancamento={dia:number;valor:number;doc:string;obs:string;cliente:string;categoria:string;catCod:string;status:string;vencimento:string;emissao:string;};
type GrupoRow={id:string;nome:string;tipo:"receita"|"despesa"|"custo"|"resultado";totalMes:number;orcado:number;dias:Record<number,number>;lancamentos:Record<number,Lancamento[]>;filhos?:GrupoRow[];};

const STATUS_EXCL=new Set(["CANCELADO","CANCELADA","ESTORNADO","ESTORNADA","DEVOLVIDO","DEVOLVIDA","ANULADO","ANULADA"]);

export default function VisaoMensalPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [groups,setGroups]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState("");
  const [mesAno,setMesAno]=useState(()=>{const n=new Date();return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [loading,setLoading]=useState(true);
  const [rows,setRows]=useState<GrupoRow[]>([]);
  const [expanded,setExpanded]=useState<Set<string>>(new Set());
  const [tooltip,setTooltip]=useState<{x:number;y:number;items:Lancamento[]}|null>(null);
  const [totalRecMes,setTotalRecMes]=useState(0);
  const [totalDespMes,setTotalDespMes]=useState(0);
  const [totalOrcRec,setTotalOrcRec]=useState(0);
  const [totalOrcDesp,setTotalOrcDesp]=useState(0);
  const [fluxoDiario,setFluxoDiario]=useState<{dia:number;entrada:number;saida:number;saldo:number;acumulado:number}[]>([]);

  const [ano,mes]=mesAno.split("-").map(Number);
  const diasNoMes=new Date(ano,mes,0).getDate();
  const diasArray=Array.from({length:diasNoMes},(_,i)=>i+1);
  const hoje=new Date();
  const diaHoje=hoje.getFullYear()===ano&&hoje.getMonth()+1===mes?hoje.getDate():0;

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selectedComp)loadData();},[selectedComp,mesAno]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    const{data:grps}=await supabase.from("company_groups").select("*").order("nome");
    if(grps)setGroups(grps);
    let data:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const r=await supabase.from("companies").select("*").order("nome_fantasia");data=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);data=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(data.length>0){setCompanies(data);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";const match=saved?data.find((c:any)=>c.id===saved):null;setSelectedComp(match?match.id:data[0].id);}
    setLoading(false);
  };

  const parseDia=(dt:string):number|null=>{
    if(!dt)return null;
    const p1=dt.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if(p1){const d=parseInt(p1[1]),m=parseInt(p1[2]);let a=parseInt(p1[3]);if(p1[3].length===2)a=2000+a;if(a===ano&&m===mes)return d;}
    const p2=dt.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if(p2){const a2=parseInt(p2[1]),m2=parseInt(p2[2]),d2=parseInt(p2[3]);if(a2===ano&&m2===mes)return d2;}
    return null;
  };

  const loadData=async()=>{
    setLoading(true);
    let compIds:string[]=[];
    if(selectedComp.startsWith("group_")){const gid=selectedComp.replace("group_","");compIds=companies.filter(c=>c.group_id===gid).map(c=>c.id);}
    else compIds=[selectedComp];

    const[{data:imports},{data:blData},{data:orcData}]=await Promise.all([
      supabase.from("omie_imports").select("import_type,import_data").in("company_id",compIds),
      supabase.from("business_lines").select("*").in("company_id",compIds).order("ln_number"),
      supabase.from("orcamento").select("*").in("company_id",compIds).eq("periodo",mesAno),
    ]);

    // Maps
    const clienteNomes:Record<string,string>={};
    const catMap:Record<string,string>={};
    if(imports)for(const imp of imports){
      if(imp.import_type==="clientes"){const cls=imp.import_data?.clientes_cadastro||[];if(Array.isArray(cls))for(const c of cls){const cod=c.codigo_cliente_omie||c.codigo_cliente||c.codigo;clienteNomes[String(cod)]=c.nome_fantasia||c.razao_social||c.nome||"";}}
      if(imp.import_type==="categorias"){const cats=imp.import_data?.categoria_cadastro||[];if(Array.isArray(cats))for(const c of cats){const cod=c.codigo||c.cCodigo||"";const desc=c.descricao||c.cDescricao||"";if(cod)catMap[cod]=desc;}}
    }

    // Orçamento lookup
    const orcLookup:Record<string,{tipo:string;valor:number}>={};
    let orcRecT=0,orcDespT=0;
    if(orcData)for(const o of orcData){
      const key=(o.categoria||"").toLowerCase().trim();
      orcLookup[key]={tipo:o.tipo||"",valor:Number(o.valor_orcado)||0};
      if(o.tipo==="receita")orcRecT+=Number(o.valor_orcado)||0;
      else orcDespT+=Number(o.valor_orcado)||0;
    }

    // Business lines
    const linhasNegocio=(blData||[]).map(bl=>({id:bl.id,nome:bl.name||bl.nome||"",tipo:bl.type||""}));

    // Process receitas — group by business line → client
    const recPorLinha:Record<string,Record<string,{totalMes:number;dias:Record<number,number>;lancamentos:Record<number,Lancamento[]>}>>={}; 
    let tRec=0;
    const entradaDia:Record<number,number>={};

    if(imports)for(const imp of imports){
      if(imp.import_type!=="contas_receber")continue;
      const regs=imp.import_data?.conta_receber_cadastro||[];
      if(!Array.isArray(regs))continue;
      for(const r of regs){
        const st=(r.status_titulo||"").toUpperCase();if(STATUS_EXCL.has(st))continue;
        const v=Number(r.valor_documento)||0;if(v<=0)continue;
        const dt=r.data_emissao||r.data_vencimento||"";
        const dia=parseDia(dt);if(dia===null)continue;
        const codCF=String(r.codigo_cliente_fornecedor||"");
        const nomeCliente=clienteNomes[codCF]||`Cliente ${codCF}`;
        const cat=r.codigo_categoria||"";
        const catNome=catMap[cat]||r.descricao_categoria||cat;
        // Try to match to a business line by category name
        let linhaId="geral";
        for(const ln of linhasNegocio){
          const lnLower=ln.nome.toLowerCase();
          const catLower=catNome.toLowerCase();
          if(catLower.includes(lnLower)||lnLower.includes(catLower)){linhaId=ln.id;break;}
        }
        if(!recPorLinha[linhaId])recPorLinha[linhaId]={};
        if(!recPorLinha[linhaId][nomeCliente])recPorLinha[linhaId][nomeCliente]={totalMes:0,dias:{},lancamentos:{}};
        recPorLinha[linhaId][nomeCliente].totalMes+=v;
        recPorLinha[linhaId][nomeCliente].dias[dia]=(recPorLinha[linhaId][nomeCliente].dias[dia]||0)+v;
        if(!recPorLinha[linhaId][nomeCliente].lancamentos[dia])recPorLinha[linhaId][nomeCliente].lancamentos[dia]=[];
        recPorLinha[linhaId][nomeCliente].lancamentos[dia].push({dia,valor:v,doc:r.numero_documento||"",obs:r.observacao||"",cliente:nomeCliente,categoria:catNome,catCod:cat,status:r.status_titulo||"",vencimento:r.data_vencimento||"",emissao:r.data_emissao||""});
        tRec+=v;
        entradaDia[dia]=(entradaDia[dia]||0)+v;
      }
    }

    // Build receita tree
    const recFilhos:GrupoRow[]=[];
    for(const ln of [...linhasNegocio,{id:"geral",nome:"Outros",tipo:""}]){
      const clientes=recPorLinha[ln.id];
      if(!clientes)continue;
      const clienteRows:GrupoRow[]=Object.entries(clientes).map(([nome,data])=>({
        id:`rec_${ln.id}_${nome}`,nome,tipo:"receita" as const,totalMes:data.totalMes,orcado:0,dias:data.dias,lancamentos:data.lancamentos,
      })).sort((a,b)=>b.totalMes-a.totalMes);
      const lnTotal=clienteRows.reduce((s,c)=>s+c.totalMes,0);
      const lnDias:Record<number,number>={};
      const lnLanc:Record<number,Lancamento[]>={};
      for(const cr of clienteRows){for(const[d,v]of Object.entries(cr.dias))lnDias[Number(d)]=(lnDias[Number(d)]||0)+v;for(const[d,items]of Object.entries(cr.lancamentos)){if(!lnLanc[Number(d)])lnLanc[Number(d)]=[];lnLanc[Number(d)].push(...items);}}
      const orcKey=ln.nome.toLowerCase().trim();
      const orcVal=orcLookup[orcKey]?.valor||0;
      if(linhasNegocio.length>0&&ln.id!=="geral"){
        recFilhos.push({id:`ln_${ln.id}`,nome:`📦 ${ln.nome}`,tipo:"receita",totalMes:lnTotal,orcado:orcVal,dias:lnDias,lancamentos:lnLanc,filhos:clienteRows});
      }else{
        recFilhos.push(...clienteRows);
      }
    }
    const recDias:Record<number,number>={};
    for(const f of recFilhos)for(const[d,v]of Object.entries(f.dias))recDias[Number(d)]=(recDias[Number(d)]||0)+v;
    const recTotal:GrupoRow={id:"RECEITAS",nome:"RECEITAS",tipo:"receita",totalMes:tRec,orcado:orcRecT,dias:recDias,lancamentos:{},filhos:recFilhos};

    // Process despesas by category
    const despCats:Record<string,GrupoRow>={};
    let tDesp=0;
    const saidaDia:Record<number,number>={};
    if(imports)for(const imp of imports){
      if(imp.import_type!=="contas_pagar")continue;
      const regs=imp.import_data?.conta_pagar_cadastro||[];
      if(!Array.isArray(regs))continue;
      for(const r of regs){
        const st=(r.status_titulo||"").toUpperCase();if(STATUS_EXCL.has(st))continue;
        const v=Number(r.valor_documento)||0;if(v<=0)continue;
        const dt=r.data_emissao||r.data_vencimento||"";
        const dia=parseDia(dt);if(dia===null)continue;
        const cat=r.codigo_categoria||"sem_cat";
        const catNome=catMap[cat]||r.descricao_categoria||cat;
        const codCF=String(r.codigo_cliente_fornecedor||"");
        const fornecedor=r.observacao||clienteNomes[codCF]||`Fornecedor ${codCF}`;
        const isCusto=cat.startsWith("2.01")||cat.startsWith("2.02")||cat.startsWith("2.03");
        const tipo=isCusto?"custo":"despesa";
        const groupKey=catNome||cat;
        if(!despCats[groupKey])despCats[groupKey]={id:`desp_${groupKey}`,nome:groupKey,tipo:tipo as any,totalMes:0,orcado:orcLookup[groupKey.toLowerCase().trim()]?.valor||0,dias:{},lancamentos:{}};
        despCats[groupKey].totalMes+=v;
        despCats[groupKey].dias[dia]=(despCats[groupKey].dias[dia]||0)+v;
        if(!despCats[groupKey].lancamentos[dia])despCats[groupKey].lancamentos[dia]=[];
        despCats[groupKey].lancamentos[dia].push({dia,valor:v,doc:r.numero_documento||"",obs:r.observacao||"",cliente:fornecedor,categoria:catNome,catCod:cat,status:r.status_titulo||"",vencimento:r.data_vencimento||"",emissao:r.data_emissao||""});
        tDesp+=v;
        saidaDia[dia]=(saidaDia[dia]||0)+v;
      }
    }

    // Build custo/despesa groups
    const custoFilhos=Object.values(despCats).filter(d=>d.tipo==="custo").sort((a,b)=>b.totalMes-a.totalMes);
    const custoOrc=custoFilhos.reduce((s,c)=>s+(c.orcado||0),0);
    const custoTotal:GrupoRow={id:"CUSTOS",nome:"(-) CUSTOS DIRETOS",tipo:"custo",totalMes:custoFilhos.reduce((s,c)=>s+c.totalMes,0),orcado:custoOrc,dias:{},lancamentos:{},filhos:custoFilhos};
    for(const f of custoFilhos)for(const[d,v]of Object.entries(f.dias))custoTotal.dias[Number(d)]=(custoTotal.dias[Number(d)]||0)+v;

    const despFilhos=Object.values(despCats).filter(d=>d.tipo==="despesa").sort((a,b)=>b.totalMes-a.totalMes);
    const despOrc=despFilhos.reduce((s,c)=>s+(c.orcado||0),0);
    const despTotal:GrupoRow={id:"DESPESAS",nome:"(-) DESPESAS",tipo:"despesa",totalMes:despFilhos.reduce((s,c)=>s+c.totalMes,0),orcado:despOrc,dias:{},lancamentos:{},filhos:despFilhos};
    for(const f of despFilhos)for(const[d,v]of Object.entries(f.dias))despTotal.dias[Number(d)]=(despTotal.dias[Number(d)]||0)+v;

    // Margem bruta
    const margemDias:Record<number,number>={};
    for(const d of diasArray)margemDias[d]=(recDias[d]||0)-(custoTotal.dias[d]||0);
    const margemTotal:GrupoRow={id:"MARGEM",nome:"= MARGEM BRUTA",tipo:"resultado",totalMes:tRec-custoTotal.totalMes,orcado:orcRecT-custoOrc,dias:margemDias,lancamentos:{}};

    // Resultado
    const resDias:Record<number,number>={};
    for(const d of diasArray)resDias[d]=(recDias[d]||0)-(custoTotal.dias[d]||0)-(despTotal.dias[d]||0);
    const resTotal:GrupoRow={id:"RESULTADO",nome:"= RESULTADO FINAL",tipo:"resultado",totalMes:tRec-tDesp,orcado:orcRecT-orcDespT,dias:resDias,lancamentos:{}};

    setRows([recTotal,custoTotal,margemTotal,despTotal,resTotal]);
    setTotalRecMes(tRec);setTotalDespMes(tDesp);
    setTotalOrcRec(orcRecT);setTotalOrcDesp(orcDespT);

    // Fluxo de caixa diário
    let acum=0;
    const fluxo=diasArray.map(d=>{
      const ent=entradaDia[d]||0;
      const sai=saidaDia[d]||0;
      const saldo=ent-sai;
      acum+=saldo;
      return{dia:d,entrada:ent,saida:sai,saldo,acumulado:acum};
    });
    setFluxoDiario(fluxo);
    setLoading(false);
  };

  const toggle=(id:string)=>{const s=new Set(expanded);if(s.has(id))s.delete(id);else s.add(id);setExpanded(s);};
  const showTooltip=(e:React.MouseEvent,items:Lancamento[])=>{if(!items||items.length===0)return;setTooltip({x:Math.min(e.clientX,window.innerWidth-320),y:Math.min(e.clientY+10,window.innerHeight-200),items});};

  const mesesOpcoes:string[]=[];
  for(let a=2025;a<=2027;a++)for(let m=1;m<=12;m++)mesesOpcoes.push(`${a}-${String(m).padStart(2,"0")}`);
  const nomeMes=(ma:string)=>{const[a,m]=ma.split("-");const n=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];return`${n[parseInt(m)-1]} ${a}`;};

  const renderRow=(row:GrupoRow,depth:number,isParent:boolean)=>{
    const hasFilhos=row.filhos&&row.filhos.length>0;
    const isOpen=expanded.has(row.id);
    const isRes=row.tipo==="resultado";
    const isMargem=row.id==="MARGEM";
    const bgColor=isRes?isMargem?G+"08":GO+"12":isParent?BG2:"transparent";
    const nameColor=isParent?GOL:depth===1?TX:TXM;
    const valColor=(v:number,tipo:string)=>v===0?TXD:tipo==="receita"||isRes?(v>0?G:R):Y;
    const varPct=row.orcado>0?((row.totalMes/row.orcado-1)*100):null;
    const varColor=varPct===null?TXD:row.tipo==="receita"?(varPct>=0?G:R):(varPct>5?R:varPct>0?Y:G);

    return(
      <tr key={row.id} style={{background:bgColor,borderBottom:`0.5px solid ${BD}30`}}>
        <td onClick={hasFilhos?()=>toggle(row.id):undefined} style={{padding:"4px 6px",paddingLeft:8+depth*16,fontSize:isParent?11:10,fontWeight:isParent?700:400,color:nameColor,whiteSpace:"nowrap",cursor:hasFilhos?"pointer":"default",position:"sticky",left:0,background:bgColor||BG,zIndex:2,minWidth:200,borderRight:`1px solid ${BD}`}}>
          {hasFilhos&&<span style={{fontSize:8,color:GO,marginRight:4}}>{isOpen?"▼":"▶"}</span>}
          {row.nome}
        </td>
        <td style={{padding:"4px 6px",textAlign:"right",fontWeight:700,color:valColor(row.totalMes,row.tipo),fontSize:isParent?11:10,whiteSpace:"nowrap",borderRight:`1px solid ${BD}40`,position:"sticky",left:200,background:bgColor||BG,zIndex:2}}>
          {row.totalMes===0?"—":fmtR(row.totalMes)}
        </td>
        <td style={{padding:"4px 4px",textAlign:"right",fontSize:9,color:row.orcado>0?TXM:TXD,borderRight:`1px solid ${BD}40`,position:"sticky",left:280,background:bgColor||BG,zIndex:2}}>
          {row.orcado>0?fmtR(row.orcado):"—"}
        </td>
        <td style={{padding:"4px 4px",textAlign:"right",fontSize:9,fontWeight:600,color:varColor,borderRight:`1px solid ${BD}`,position:"sticky",left:340,background:bgColor||BG,zIndex:2,minWidth:50}}>
          {varPct!==null?`${varPct>0?"+":""}${varPct.toFixed(0)}%`:"—"}
        </td>
        {diasArray.map(d=>{
          const v=row.dias[d]||0;
          const items=row.lancamentos?.[d]||[];
          const isToday=d===diaHoje;
          return(
            <td key={d} onMouseEnter={items.length>0?(e)=>showTooltip(e,items):undefined} onMouseLeave={()=>setTooltip(null)}
              style={{padding:"3px 3px",textAlign:"right",fontSize:9,color:v===0?"transparent":valColor(v,row.tipo),fontWeight:v>0&&isParent?600:400,whiteSpace:"nowrap",cursor:items.length>0?"help":"default",background:isToday?GO+"08":"transparent",borderRight:d%7===0?`1px solid ${BD}20`:"none",minWidth:48}}>
              {v===0?"·":fmtR(v)}
            </td>
          );
        })}
      </tr>
    );
  };

  const renderTree=(rows:GrupoRow[])=>{
    const result:React.ReactElement[]=[];
    for(const row of rows){
      result.push(renderRow(row,0,true));
      if(expanded.has(row.id)&&row.filhos){
        for(const filho of row.filhos){
          result.push(renderRow(filho,1,!!(filho.filhos&&filho.filhos.length>0)));
          if(expanded.has(filho.id)&&filho.filhos){
            for(const neto of filho.filhos){
              result.push(renderRow(neto,2,false));
            }
          }
        }
      }
    }
    return result;
  };

  const sel:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const maxFluxo=Math.max(...fluxoDiario.map(f=>Math.abs(f.acumulado)),1);

  return(
    <div style={{minHeight:"100vh",background:BG,padding:16}} onClick={()=>setTooltip(null)}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:GOL}}>📅 Visão Diária — {nomeMes(mesAno)}</div>
          <div style={{fontSize:10,color:TXD}}>Receitas e custos por dia • Expandir por negócio e cliente • Mouse para detalhes</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={selectedComp} onChange={e=>{setSelectedComp(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={sel}>
            {groups.map(g=>{const gc=companies.filter(c=>c.group_id===g.id);if(gc.length===0)return null;return[<option key={`g_${g.id}`} value={`group_${g.id}`}>📁 {g.nome} (todas)</option>,...gc.map(c=><option key={c.id} value={c.id}>&nbsp;&nbsp;{c.nome_fantasia||c.razao_social}</option>)];})}
            {companies.filter(c=>!c.group_id||!groups.find((g:any)=>g.id===c.group_id)).map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <select value={mesAno} onChange={e=>setMesAno(e.target.value)} style={sel}>{mesesOpcoes.map(m=><option key={m} value={m}>{nomeMes(m)}</option>)}</select>
          <a href="/dashboard" style={{padding:"6px 14px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
        {[
          {l:"Receitas",v:fmtRFull(totalRecMes),c:G},
          {l:"Orç. Receita",v:totalOrcRec>0?fmtRFull(totalOrcRec):"—",c:TXM},
          {l:"Despesas",v:fmtRFull(totalDespMes),c:Y},
          {l:"Orç. Despesa",v:totalOrcDesp>0?fmtRFull(totalOrcDesp):"—",c:TXM},
          {l:"Resultado",v:fmtRFull(totalRecMes-totalDespMes),c:totalRecMes-totalDespMes>=0?G:R},
          {l:"Margem",v:totalRecMes>0?`${((totalRecMes-totalDespMes)/totalRecMes*100).toFixed(1)}%`:"0%",c:totalRecMes-totalDespMes>=0?G:R},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"8px 12px",borderLeft:`3px solid ${k.c}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase"}}>{k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {loading&&<div style={{textAlign:"center",padding:40,color:GOL}}>⏳ Carregando...</div>}

      {/* Main Table */}
      {!loading&&rows.length>0&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto",maxHeight:"55vh",marginBottom:16}}>
          <table style={{borderCollapse:"collapse",fontSize:10,width:"max-content",minWidth:"100%"}}>
            <thead>
              <tr style={{borderBottom:`2px solid ${GO}40`}}>
                <th style={{padding:"6px",textAlign:"left",color:GOL,fontSize:9,position:"sticky",left:0,background:BG2,zIndex:3,minWidth:200,borderRight:`1px solid ${BD}`}}>Categoria</th>
                <th style={{padding:"6px",textAlign:"right",color:GOL,fontSize:9,position:"sticky",left:200,background:BG2,zIndex:3,borderRight:`1px solid ${BD}40`,minWidth:80}}>Real</th>
                <th style={{padding:"6px",textAlign:"right",color:GOL,fontSize:9,position:"sticky",left:280,background:BG2,zIndex:3,borderRight:`1px solid ${BD}40`,minWidth:60}}>Orçado</th>
                <th style={{padding:"6px",textAlign:"right",color:GOL,fontSize:9,position:"sticky",left:340,background:BG2,zIndex:3,borderRight:`1px solid ${BD}`,minWidth:50}}>Var</th>
                {diasArray.map(d=>{const dow=new Date(ano,mes-1,d).getDay();const isWknd=dow===0||dow===6;const isToday=d===diaHoje;const nomesDia=["D","S","T","Q","Q","S","S"];
                  return <th key={d} style={{padding:"3px 2px",textAlign:"center",fontSize:8,color:isToday?GOL:isWknd?TXD+"60":TXD,background:isToday?GO+"10":"transparent",minWidth:48,borderRight:d%7===0?`1px solid ${BD}20`:"none"}}><div>{d}</div><div style={{fontSize:7}}>{nomesDia[dow]}</div></th>;
                })}
              </tr>
            </thead>
            <tbody>{renderTree(rows)}</tbody>
          </table>
        </div>
      )}

      {/* Fluxo de Caixa Diário */}
      {!loading&&fluxoDiario.length>0&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:12}}>💵 Fluxo de Caixa Diário — {nomeMes(mesAno)}</div>
          <div style={{display:"flex",gap:0,alignItems:"flex-end",height:120,marginBottom:8,borderBottom:`1px solid ${BD}`,position:"relative"}}>
            {/* Zero line */}
            <div style={{position:"absolute",left:0,right:0,bottom:fluxoDiario.some(f=>f.acumulado<0)?`${(Math.abs(Math.min(...fluxoDiario.map(f=>f.acumulado)))/maxFluxo)*50}px`:"0",height:1,background:TXD+"40"}}/>
            {fluxoDiario.map((f,i)=>{
              const h=maxFluxo>0?Math.abs(f.acumulado)/maxFluxo*100:0;
              const isPos=f.acumulado>=0;
              const isToday=f.dia===diaHoje;
              return(
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",position:"relative"}}
                  onMouseEnter={(e)=>showTooltip(e,[{dia:f.dia,valor:f.acumulado,doc:`Entrada: ${fmtRFull(f.entrada)}`,obs:`Saída: ${fmtRFull(f.saida)}`,cliente:`Saldo dia: ${fmtRFull(f.saldo)}`,categoria:`Acumulado: ${fmtRFull(f.acumulado)}`,catCod:"",status:"",vencimento:"",emissao:""}])}
                  onMouseLeave={()=>setTooltip(null)}>
                  <div style={{width:"60%",height:`${Math.max(h,2)}%`,background:isPos?G+"60":R+"60",borderRadius:"2px 2px 0 0",border:isToday?`1px solid ${GOL}`:"none"}}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:0}}>
            {fluxoDiario.map((f,i)=>(
              <div key={i} style={{flex:1,textAlign:"center",fontSize:7,color:f.dia===diaHoje?GOL:TXD}}>{f.dia}</div>
            ))}
          </div>
          {/* Fluxo summary */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginTop:12}}>
            {[
              {l:"Total Entradas",v:fmtRFull(fluxoDiario.reduce((s,f)=>s+f.entrada,0)),c:G},
              {l:"Total Saídas",v:fmtRFull(fluxoDiario.reduce((s,f)=>s+f.saida,0)),c:R},
              {l:"Saldo Acumulado",v:fmtRFull(fluxoDiario[fluxoDiario.length-1]?.acumulado||0),c:fluxoDiario[fluxoDiario.length-1]?.acumulado>=0?G:R},
              {l:"Dia Pico Negativo",v:fluxoDiario.some(f=>f.acumulado<0)?`Dia ${fluxoDiario.reduce((min,f)=>f.acumulado<min.acumulado?f:min).dia}`:"Nenhum",c:fluxoDiario.some(f=>f.acumulado<0)?R:G},
            ].map((k,i)=>(
              <div key={i} style={{background:BG3,borderRadius:8,padding:"8px 10px",borderLeft:`3px solid ${k.c}`}}>
                <div style={{fontSize:8,color:TXD,textTransform:"uppercase"}}>{k.l}</div>
                <div style={{fontSize:14,fontWeight:700,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading&&rows.length===0&&(
        <div style={{textAlign:"center",padding:40,background:BG2,borderRadius:12,border:`1px solid ${BD}`}}>
          <div style={{fontSize:14,color:TXM}}>Nenhum lançamento neste mês</div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip&&(
        <div style={{position:"fixed",left:tooltip.x,top:tooltip.y,background:"#1E1E1B",border:`1px solid ${GO}60`,borderRadius:10,padding:12,zIndex:9999,maxWidth:300,boxShadow:"0 8px 24px rgba(0,0,0,0.6)"}}>
          <div style={{fontSize:10,fontWeight:700,color:GOL,marginBottom:6}}>{tooltip.items.length} lançamento(s)</div>
          {tooltip.items.slice(0,5).map((item,i)=>(
            <div key={i} style={{padding:"4px 0",borderBottom:i<tooltip.items.length-1?`0.5px solid ${BD}`:"none",fontSize:10}}>
              <div style={{color:TX,fontWeight:600}}>{fmtRFull(item.valor)}</div>
              <div style={{color:TXM}}>{item.cliente}</div>
              <div style={{color:TXD,fontSize:9}}>{item.categoria&&`${item.categoria}`}{item.doc&&` • ${item.doc}`}{item.status&&` • ${item.status}`}</div>
              {item.obs&&<div style={{color:TXD,fontSize:9,fontStyle:"italic"}}>{item.obs}</div>}
            </div>
          ))}
          {tooltip.items.length>5&&<div style={{fontSize:9,color:TXD,marginTop:4}}>+{tooltip.items.length-5} mais</div>}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:12}}>PS Gestão e Capital — Visão Diária v8.0</div>
    </div>
  );
}
