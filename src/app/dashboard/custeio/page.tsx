// Custeio por Absorção v8.7.7 — Dashboard Visual
"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
  BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmt=(v:number)=>v===0?"—":`R$ ${Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`;
const fmtFull=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const pct=(v:number,t:number)=>t>0?`${((v/t)*100).toFixed(1)}%`:"—";

type AbsRow={linha:string;receita?:number;material?:number;mao_obra?:number;cif?:number;tributos?:number;despesa_adm?:number;despesa_com?:number;financeiro?:number;depreciacao?:number;outros?:number;total_custos:number;resultado:number;};
type VarRow={linha:string;receita:number;custos_variaveis:number;margem_contribuicao:number;mc_pct:string;};

export default function CusteioPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [mesAno,setMesAno]=useState(()=>{const n=new Date();return`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`;});
  const [loading,setLoading]=useState(true);
  const [processing,setProcessing]=useState(false);
  const [result,setResult]=useState<any>(null);
  const [tab,setTab]=useState<"absorcao"|"variavel"|"detalhes"|"como_usar">("absorcao");
  const [detalhes,setDetalhes]=useState<any[]>([]);
  const [detLoading,setDetLoading]=useState(false);

  useEffect(()=>{loadCo();},[]);
  useEffect(()=>{if(sel)loadResults();},[sel,mesAno]);

  const loadCo=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);setSel(d[0].id);}
    setLoading(false);
  };

  const loadResults=async()=>{
    const{data}=await supabase.from("cost_allocations").select("*").eq("company_id",sel).eq("periodo",mesAno);
    if(data&&data.length>0){
      buildResult(data);
    }else{
      setResult(null);
    }
  };

  const buildResult=(data:any[])=>{
    // Get business line names
    const blNames:Record<string,string>={};
    // We'll build from the data itself
    const absMap:Record<string,Record<string,number>>={};
    const varMap:Record<string,{receita:number;variavel:number}>={};

    for(const r of data){
      const bl=r.business_line_id||"nao_alocado";
      const method=r.costing_method;
      const group=r.cost_group;
      const valor=Number(r.valor)||0;

      if(method==="absorcao"){
        if(!absMap[bl])absMap[bl]={};
        absMap[bl][group]=(absMap[bl][group]||0)+valor;
      }
      if(method==="variavel"){
        if(!varMap[bl])varMap[bl]={receita:0,variavel:0};
        if(group==="receita"){varMap[bl].receita+=valor;}
        else if(r.cost_behavior==="variavel"&&r.business_line_id){varMap[bl].variavel+=valor;}
      }
    }

    // Get BL names from Supabase
    supabase.from("business_lines").select("id,name").eq("company_id",sel).then(({data:bls})=>{
      if(bls)for(const b of bls)blNames[b.id]=b.name;
      blNames["nao_alocado"]="Não Alocado";

      const absRows:AbsRow[]=Object.entries(absMap).map(([bl,groups])=>{
        const totalCustos=Object.entries(groups).filter(([k])=>k!=="receita").reduce((s,[,v])=>s+v,0);
        return{
          linha:blNames[bl]||bl,
          receita:groups.receita||0,
          material:groups.material,mao_obra:groups.mao_obra,cif:groups.cif,
          tributos:groups.tributos,despesa_adm:groups.despesa_adm,
          despesa_com:groups.despesa_com,financeiro:groups.financeiro,
          depreciacao:groups.depreciacao,outros:groups.outros,
          total_custos:totalCustos,resultado:(groups.receita||0)-totalCustos,
        };
      }).sort((a,b)=>(b.receita||0)-(a.receita||0));

      const varRows:VarRow[]=Object.entries(varMap).map(([bl,d])=>({
        linha:blNames[bl]||(bl==="nao_alocado"?"Custos Fixos do Período":bl),
        receita:d.receita,custos_variaveis:d.variavel,
        margem_contribuicao:d.receita-d.variavel,
        mc_pct:d.receita>0?`${((d.receita-d.variavel)/d.receita*100).toFixed(1)}%`:"—",
      })).sort((a,b)=>b.receita-a.receita);

      // Totals
      const totalRec=absRows.reduce((s,r)=>s+(r.receita||0),0);
      const totalCst=absRows.reduce((s,r)=>s+r.total_custos,0);
      const totalRes=totalRec-totalCst;
      const alocado=absRows.filter(r=>r.linha!=="Não Alocado").reduce((s,r)=>s+r.total_custos,0);
      const naoAlocado=absRows.find(r=>r.linha==="Não Alocado")?.total_custos||0;

      setResult({absRows,varRows,totalRec,totalCst,totalRes,alocado,naoAlocado,totalRegistros:data.length});
    });
  };

  const processar=async()=>{
    setProcessing(true);
    try{
      const r=await fetch("/api/custos/processar",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({company_ids:[sel],periodo:mesAno})
      });
      const d=await r.json();
      if(d.success){
        await loadResults();
      }else{
        alert("Erro: "+(d.error||"Falha no processamento"));
      }
    }catch(e:any){alert("Erro: "+e.message);}
    setProcessing(false);
  };

  const loadDetalhes=async()=>{
    setDetLoading(true);
    const{data}=await supabase.from("cost_allocations").select("*").eq("company_id",sel).eq("periodo",mesAno).eq("costing_method","absorcao").order("valor",{ascending:false}).limit(100);
    setDetalhes(data||[]);
    setDetLoading(false);
  };

  const nMes=(ma:string)=>{const[a,m]=ma.split("-");return`${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][parseInt(m)-1]}/${a}`;};
  const mOps:string[]=[];for(let a=2025;a<=2027;a++)for(let m=1;m<=12;m++)mOps.push(`${a}-${String(m).padStart(2,"0")}`);

  const ss:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};

  // Cost group labels
  const grpLabel:Record<string,string>={material:"Material",mao_obra:"Mão de Obra",cif:"CIF",tributos:"Tributos",tributos_reforma:"CBS/IBS",despesa_adm:"Desp. Adm",despesa_com:"Desp. Comercial",financeiro:"Financeiro",depreciacao:"Depreciação",outros:"Outros",receita:"Receita"};
  const grpCor:Record<string,string>={material:Y,mao_obra:B,cif:P,tributos:R,tributos_reforma:R,despesa_adm:TXM,despesa_com:GOL,financeiro:R,depreciacao:TXD,outros:TXD,receita:G};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:16}}>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>🏭 Custeio por Absorção</div>
          <div style={{fontSize:10,color:TXD}}>CPC 16 • Absorção + Variável • Multi-ERP • Reforma Tributária 2026-2033</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sel} onChange={e=>setSel(e.target.value)} style={ss}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <select value={mesAno} onChange={e=>setMesAno(e.target.value)} style={ss}>
            {mOps.map(m=><option key={m} value={m}>{nMes(m)}</option>)}
          </select>
          <button onClick={processar} disabled={processing} style={{padding:"8px 18px",borderRadius:8,background:processing?BD:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:700,border:"none",cursor:processing?"wait":"pointer"}}>
            {processing?"⏳ Processando...":"🔄 Processar Período"}
          </button>
          <a href="/dashboard" style={{padding:"6px 12px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {loading&&<div style={{textAlign:"center",padding:60,color:GOL}}>⏳ Carregando...</div>}

      {!loading&&!result&&(
        <div style={{textAlign:"center",padding:60,background:BG2,borderRadius:16,border:`1px solid ${BD}`}}>
          <div style={{fontSize:40,marginBottom:12}}>🏭</div>
          <div style={{fontSize:16,color:GOL,fontWeight:600,marginBottom:8}}>Nenhum processamento encontrado</div>
          <div style={{fontSize:12,color:TXM,marginBottom:16}}>Clique em "Processar Período" para gerar o custeio por absorção de {nMes(mesAno)}</div>
          <button onClick={processar} disabled={processing} style={{padding:"12px 32px",borderRadius:10,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:13,fontWeight:700,border:"none",cursor:"pointer"}}>
            {processing?"⏳ Processando...":"🔄 Processar Agora"}
          </button>
        </div>
      )}

      {result&&(
        <>
          {/* KPIs */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))",gap:8,marginBottom:16}}>
            {[
              {l:"Receita Total",v:fmt(result.totalRec),c:G,icon:"💰"},
              {l:"Custos Totais",v:fmt(result.totalCst),c:Y,icon:"📦"},
              {l:"Resultado",v:fmt(result.totalRes),c:result.totalRes>=0?G:R,icon:"🎯"},
              {l:"Margem",v:result.totalRec>0?`${((result.totalRes/result.totalRec)*100).toFixed(1)}%`:"—",c:result.totalRes>=0?G:R,icon:"📊"},
              {l:"Custos Alocados",v:fmt(result.alocado),c:G,icon:"✅"},
              {l:"Não Alocado",v:fmt(result.naoAlocado),c:result.naoAlocado>0?Y:G,icon:result.naoAlocado>0?"⚠️":"✅"},
              {l:"Registros",v:result.totalRegistros.toString(),c:GOL,icon:"📋"},
            ].map((k,i)=>(
              <div key={i} style={{background:"linear-gradient(135deg, #161614, #1E1E1B)",borderRadius:12,padding:"12px",border:`1px solid ${BD}`,borderLeft:`4px solid ${k.c}`}}>
                <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
                <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:4}}>{k.v}</div>
              </div>
            ))}
          </div>

          {/* TABS */}
          <div style={{display:"flex",gap:4,marginBottom:12}}>
            {([["absorcao","📊 Custeio por Absorção"],["variavel","📈 Margem de Contribuição"],["detalhes","📋 Detalhes"],["como_usar","❓ Como Usar"]] as const).map(([id,label])=>(
              <button key={id} onClick={()=>{setTab(id);if(id==="detalhes"&&detalhes.length===0)loadDetalhes();}} style={{
                padding:"8px 16px",borderRadius:8,fontSize:11,fontWeight:tab===id?700:400,
                border:tab===id?`1px solid ${GO}50`:`1px solid ${BD}`,
                background:tab===id?`${GO}15`:"transparent",color:tab===id?GOL:TXM,cursor:"pointer"
              }}>{label}</button>
            ))}
          </div>

          {/* TAB: ABSORÇÃO */}
          {tab==="absorcao"&&(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead>
                  <tr style={{borderBottom:`2px solid ${GO}40`}}>
                    {["Linha de Negócio","Receita","Material","Mão de Obra","Tributos","Desp. Adm","Financeiro","Outros","Total Custos","Resultado","Margem"].map(h=>(
                      <th key={h} style={{padding:"10px 8px",textAlign:h==="Linha de Negócio"?"left":"right",color:GO,fontSize:9,fontWeight:600}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.absRows.map((r:AbsRow,i:number)=>{
                    const isNA=r.linha==="Não Alocado";
                    const mg=(r.receita||0)>0?((r.resultado/(r.receita||1))*100).toFixed(1)+"%":"—";
                    return(
                      <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`,background:isNA?`${Y}06`:"transparent"}}>
                        <td style={{padding:"8px",fontWeight:600,color:isNA?Y:TX,fontSize:12}}>{isNA?"⚠️ ":""}{r.linha}</td>
                        <td style={{padding:"8px",textAlign:"right",color:G,fontWeight:600}}>{r.receita?fmt(r.receita):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:r.material?Y:TXD}}>{r.material?fmt(r.material):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:r.mao_obra?B:TXD}}>{r.mao_obra?fmt(r.mao_obra):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:r.tributos?R:TXD}}>{r.tributos?fmt(r.tributos):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:r.despesa_adm?TXM:TXD}}>{r.despesa_adm?fmt(r.despesa_adm):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:r.financeiro?R:TXD}}>{r.financeiro?fmt(r.financeiro):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:TXD}}>{r.outros?fmt(r.outros):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:700,color:Y}}>{fmt(r.total_custos)}</td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:700,color:r.resultado>=0?G:R}}>{fmtFull(r.resultado)}</td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:600,color:r.resultado>=0?G:R}}>{mg}</td>
                      </tr>
                    );
                  })}
                  {/* TOTAL */}
                  <tr style={{borderTop:`2px solid ${GO}`,background:`${GO}08`}}>
                    <td style={{padding:"10px 8px",fontWeight:700,color:GOL,fontSize:12}}>TOTAL</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:G,fontSize:13}}>{fmt(result.totalRec)}</td>
                    <td colSpan={6}/>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:Y,fontSize:13}}>{fmt(result.totalCst)}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:result.totalRes>=0?G:R,fontSize:13}}>{fmtFull(result.totalRes)}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:result.totalRes>=0?G:R}}>{result.totalRec>0?`${((result.totalRes/result.totalRec)*100).toFixed(1)}%`:"—"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* TAB: VARIÁVEL / MARGEM CONTRIBUIÇÃO */}
          {tab==="variavel"&&(
            <div>
              <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto",marginBottom:16}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead>
                    <tr style={{borderBottom:`2px solid ${GO}40`}}>
                      {["Linha de Negócio","Receita","Custos Variáveis","Margem de Contribuição","MC %"].map(h=>(
                        <th key={h} style={{padding:"10px 8px",textAlign:h==="Linha de Negócio"?"left":"right",color:GO,fontSize:9,fontWeight:600}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.varRows.map((r:VarRow,i:number)=>{
                      const isFixed=r.linha.includes("Fixos")||r.linha.includes("Não Alocado");
                      return(
                        <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`,background:isFixed?`${P}06`:"transparent"}}>
                          <td style={{padding:"8px",fontWeight:600,color:isFixed?P:TX,fontSize:12}}>{r.linha}</td>
                          <td style={{padding:"8px",textAlign:"right",color:G,fontWeight:600}}>{r.receita>0?fmt(r.receita):"—"}</td>
                          <td style={{padding:"8px",textAlign:"right",color:r.custos_variaveis>0?Y:TXD,fontWeight:600}}>{r.custos_variaveis>0?fmt(r.custos_variaveis):"—"}</td>
                          <td style={{padding:"8px",textAlign:"right",fontWeight:700,color:r.margem_contribuicao>=0?G:R}}>{fmtFull(r.margem_contribuicao)}</td>
                          <td style={{padding:"8px",textAlign:"right",fontWeight:700}}>
                            <span style={{padding:"2px 8px",borderRadius:6,fontSize:11,background:r.margem_contribuicao>=0?G+"15":R+"15",color:r.margem_contribuicao>=0?G:R}}>{r.mc_pct}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* GRÁFICO VISUAL — Barras de margem */}
              <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:16}}>
                <div style={{fontSize:13,fontWeight:700,color:GOL,marginBottom:12}}>📊 Margem de Contribuição por Linha</div>
                {result.varRows.filter((r:VarRow)=>r.receita>0).map((r:VarRow,i:number)=>{
                  const maxVal=Math.max(...result.varRows.filter((v:VarRow)=>v.receita>0).map((v:VarRow)=>v.receita));
                  const wRec=maxVal>0?(r.receita/maxVal)*100:0;
                  const wVar=maxVal>0?(r.custos_variaveis/maxVal)*100:0;
                  return(
                    <div key={i} style={{marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                        <span style={{fontSize:11,fontWeight:600,color:TX}}>{r.linha}</span>
                        <span style={{fontSize:11,fontWeight:700,color:r.margem_contribuicao>=0?G:R}}>{r.mc_pct}</span>
                      </div>
                      <div style={{position:"relative",height:20,background:BG3,borderRadius:4,overflow:"hidden"}}>
                        <div style={{position:"absolute",height:"100%",width:`${wRec}%`,background:G+"30",borderRadius:4}}/>
                        <div style={{position:"absolute",height:"100%",width:`${wVar}%`,background:R+"40",borderRadius:4}}/>
                      </div>
                      <div style={{display:"flex",gap:12,marginTop:2}}>
                        <span style={{fontSize:8,color:G}}>Receita: {fmt(r.receita)}</span>
                        <span style={{fontSize:8,color:R}}>CV: {fmt(r.custos_variaveis)}</span>
                        <span style={{fontSize:8,color:r.margem_contribuicao>=0?G:R}}>MC: {fmtFull(r.margem_contribuicao)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: DETALHES */}
          {tab==="detalhes"&&(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto",maxHeight:"60vh"}}>
              {detLoading&&<div style={{padding:20,textAlign:"center",color:GOL}}>⏳ Carregando detalhes...</div>}
              {!detLoading&&detalhes.length>0&&(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10,minWidth:900}}>
                  <thead>
                    <tr style={{borderBottom:`2px solid ${GO}40`}}>
                      {["Fornecedor/Cliente","Valor","Grupo","Natureza","Comportamento","Origem","Categoria","Documento"].map(h=>(
                        <th key={h} style={{padding:"8px 6px",textAlign:h==="Valor"?"right":"left",color:GO,fontSize:8,fontWeight:600,position:"sticky",top:0,background:BG2}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detalhes.map((d:any,i:number)=>(
                      <tr key={i} style={{borderBottom:`0.5px solid ${BD}20`}}>
                        <td style={{padding:"6px",color:TX,fontSize:10,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.fornecedor||"—"}</td>
                        <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:d.cost_group==="receita"?G:Y}}>{fmtFull(d.valor)}</td>
                        <td style={{padding:"6px"}}><span style={{padding:"1px 6px",borderRadius:4,fontSize:8,background:(grpCor[d.cost_group]||TXD)+"20",color:grpCor[d.cost_group]||TXD}}>{grpLabel[d.cost_group]||d.cost_group}</span></td>
                        <td style={{padding:"6px",fontSize:9,color:d.cost_nature==="direto"?G:P}}>{d.cost_nature}</td>
                        <td style={{padding:"6px",fontSize:9,color:d.cost_behavior==="variavel"?Y:B}}>{d.cost_behavior}</td>
                        <td style={{padding:"6px",fontSize:8,color:TXD}}>{d.allocation_source?.replace(/_/g," ")}</td>
                        <td style={{padding:"6px",fontSize:9,color:TXM}}>{d.categoria_origem||"—"}</td>
                        <td style={{padding:"6px",fontSize:9,color:TXD}}>{d.documento||"—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {!detLoading&&detalhes.length===0&&<div style={{padding:20,textAlign:"center",color:TXM}}>Nenhum detalhe encontrado</div>}
            </div>
          )}

          {/* TAB: COMO USAR */}
          {tab==="como_usar"&&(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:20,lineHeight:1.8}}>
              <div style={{fontSize:16,fontWeight:700,color:GOL,marginBottom:16}}>📘 Como Usar o Módulo de Custeio por Absorção</div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:8}}>O que é Custeio por Absorção?</div>
                <div style={{fontSize:11,color:TXM}}>
                  O custeio por absorção é o único método aceito pela legislação brasileira (CPC 16, Lei 6.404/76) para fins fiscais e demonstrações contábeis externas. Ele consiste em alocar TODOS os custos de produção (diretos e indiretos, fixos e variáveis) aos produtos ou serviços da empresa. Isso permite conhecer o custo real de cada linha de negócio e calcular margens precisas.
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:8}}>Como funciona a alocação de custos?</div>
                <div style={{fontSize:11,color:TXM,marginBottom:8}}>O sistema usa 5 camadas de alocação, em ordem de prioridade:</div>
                <div style={{background:BG3,borderRadius:8,padding:12}}>
                  <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
                    <span style={{background:G+"20",color:G,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,minWidth:70,textAlign:"center"}}>Camada 1</span>
                    <div><div style={{fontSize:11,fontWeight:600,color:TX}}>Distribuição do ERP (Omie)</div><div style={{fontSize:10,color:TXD}}>Se o lançamento tem departamento no Omie (campo distribuicao[]), usa o percentual exato definido lá. É a forma mais precisa.</div></div>
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
                    <span style={{background:B+"20",color:B,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,minWidth:70,textAlign:"center"}}>Camada 2</span>
                    <div><div style={{fontSize:11,fontWeight:600,color:TX}}>Categoria Contábil</div><div style={{fontSize:10,color:TXD}}>Se a categoria do lançamento (ex: 2.01.96) tem regra de mapeamento, usa essa regra.</div></div>
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
                    <span style={{background:Y+"20",color:Y,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,minWidth:70,textAlign:"center"}}>Camada 3</span>
                    <div><div style={{fontSize:11,fontWeight:600,color:TX}}>Empresa de Origem (CNPJ)</div><div style={{fontSize:10,color:TXD}}>Se a empresa que gerou o custo tem regra de fallback (ex: M.m Serviços → 50% Gesso Oeste + 50% Litoral), aplica esse rateio.</div></div>
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-start"}}>
                    <span style={{background:P+"20",color:P,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,minWidth:70,textAlign:"center"}}>Camada 4</span>
                    <div><div style={{fontSize:11,fontWeight:600,color:TX}}>CNPJ do Fornecedor</div><div style={{fontSize:10,color:TXD}}>Se o fornecedor tem regra específica de rateio, aplica.</div></div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{background:R+"20",color:R,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:700,minWidth:70,textAlign:"center"}}>Camada 5</span>
                    <div><div style={{fontSize:11,fontWeight:600,color:TX}}>Não Alocado</div><div style={{fontSize:10,color:TXD}}>Se nenhuma regra se aplica, o custo fica como "Não Alocado" até que uma regra seja configurada.</div></div>
                  </div>
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:8}}>As duas visões do resultado</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div style={{background:BG3,borderRadius:8,padding:12,borderLeft:`4px solid ${G}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:G,marginBottom:4}}>📊 Custeio por Absorção</div>
                    <div style={{fontSize:10,color:TXM}}>Obrigatório pela legislação (CPC 16). Todos os custos (fixos + variáveis) são alocados ao produto. Mostra o custo total real de cada linha de negócio. Use para: balanço patrimonial, demonstrações fiscais, IR, formação de preço de venda.</div>
                  </div>
                  <div style={{background:BG3,borderRadius:8,padding:12,borderLeft:`4px solid ${B}`}}>
                    <div style={{fontSize:12,fontWeight:700,color:B,marginBottom:4}}>📈 Margem de Contribuição</div>
                    <div style={{fontSize:10,color:TXM}}>Visão gerencial. Só custos variáveis vão pro produto — fixos ficam no período. Mostra quanto cada linha contribui para cobrir custos fixos e gerar lucro. Use para: decisões de manter/cortar linhas, definir prioridades, análise de curto prazo.</div>
                  </div>
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:8}}>Classificação dos custos</div>
                <div style={{fontSize:11,color:TXM,marginBottom:8}}>O sistema classifica cada custo automaticamente em duas dimensões:</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div style={{background:BG3,borderRadius:8,padding:12}}>
                    <div style={{fontSize:11,fontWeight:600,color:TX,marginBottom:4}}>Por natureza</div>
                    <div style={{fontSize:10,color:G,marginBottom:2}}>Direto — rastreável ao produto (matéria-prima, MOD)</div>
                    <div style={{fontSize:10,color:P}}>Indireto — não rastreável (aluguel, energia, supervisão)</div>
                  </div>
                  <div style={{background:BG3,borderRadius:8,padding:12}}>
                    <div style={{fontSize:11,fontWeight:600,color:TX,marginBottom:4}}>Por comportamento</div>
                    <div style={{fontSize:10,color:Y,marginBottom:2}}>Variável — varia com produção (matéria-prima, comissão)</div>
                    <div style={{fontSize:10,color:B}}>Fixo — não varia no curto prazo (aluguel, salário)</div>
                  </div>
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:8}}>Reforma Tributária 2026-2033</div>
                <div style={{fontSize:11,color:TXM}}>
                  O sistema já está preparado para a transição tributária (LC 214/2025). Durante o período 2026-2033, PIS/COFINS/ICMS/ISS coexistem com CBS/IBS. O módulo suporta ambos os regimes e classifica tributos novos separadamente (grupo "CBS/IBS") para que o contador possa gerar demonstrações nos dois modelos. O split payment (retenção automática de IBS/CBS no Pix/cartão) afeta o fluxo de caixa e está refletido na análise.
                </div>
              </div>

              <div style={{marginBottom:20}}>
                <div style={{fontSize:13,fontWeight:700,color:GO,marginBottom:8}}>Fontes de dados suportadas</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {["Omie","Nibo","ContaAzul","Bling","Entrada Manual","Módulo Industrial"].map(s=>(
                    <span key={s} style={{padding:"4px 10px",borderRadius:6,background:GO+"15",color:GOL,fontSize:10,fontWeight:500}}>{s}</span>
                  ))}
                </div>
                <div style={{fontSize:10,color:TXD,marginTop:6}}>O mapeamento de departamentos funciona por NOME (não por código), permitindo que empresas diferentes usem os mesmos nomes de departamento com códigos diferentes.</div>
              </div>

              <div style={{background:`${GO}10`,borderRadius:8,padding:12,border:`1px solid ${GO}30`}}>
                <div style={{fontSize:12,fontWeight:700,color:GOL,marginBottom:6}}>🎯 Passo a passo</div>
                <div style={{fontSize:10,color:TXM,lineHeight:2}}>
                  1. Selecione a empresa no seletor acima<br/>
                  2. Escolha o período (mês/ano)<br/>
                  3. Clique em "Processar Período" — o sistema analisa todos os lançamentos<br/>
                  4. Veja o DRE por Absorção na primeira aba<br/>
                  5. Compare com a Margem de Contribuição na segunda aba<br/>
                  6. Use a aba Detalhes para drill-down nos lançamentos individuais<br/>
                  7. Custos "Não Alocados" precisam de regras de mapeamento — solicite ao administrador
                </div>
              </div>

              <div style={{fontSize:9,color:TXD,marginTop:16,textAlign:"center"}}>
                Base legal: CPC 16 (R2) Estoques | Lei 6.404/76 Art. 177 | CFC NBC TG 16 | LC 214/2025 (Reforma Tributária) | Decreto 9.580/2018 (RIR)
              </div>
            </div>
          )}

          {/* INFO */}
          {result.naoAlocado>0&&(
            <div style={{marginTop:12,background:`${Y}08`,borderRadius:12,border:`1px solid ${Y}30`,padding:14}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:14}}>⚠️</span>
                <span style={{fontSize:12,fontWeight:700,color:Y}}>R$ {result.naoAlocado.toLocaleString("pt-BR",{minimumFractionDigits:0})} em custos não alocados</span>
              </div>
              <div style={{fontSize:11,color:TXM,lineHeight:1.6}}>
                Esses custos não possuem departamento no Omie (distribuicao[]) nem regra de fallback por CNPJ. Para alocar, configure as regras de rateio por CNPJ no módulo de administração ou solicite ao financeiro que distribua os custos por departamento no Omie.
              </div>
            </div>
          )}
        </>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:16,padding:8}}>
        PS Gestão e Capital — Custeio por Absorção v8.7.7 | CPC 16 | Lei 6.404/76 | Reforma Tributária LC 214/2025
      </div>
    </div>
  );
}
