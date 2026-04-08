"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

export default function BPOAutoPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState("");
  const [fila,setFila]=useState<any[]>([]);
  const [logs,setLogs]=useState<any[]>([]);
  const [rotinas,setRotinas]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [classifying,setClassifying]=useState(false);
  const [msg,setMsg]=useState("");
  const [filtro,setFiltro]=useState("pendente");
  const [selectAll,setSelectAll]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(new Set());

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selectedComp&&typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",selectedComp);},[selectedComp]);
  useEffect(()=>{if(selectedComp)loadData();},[selectedComp]);

  const loadCompanies=async()=>{
    const{data:{user:authU}}=await supabase.auth.getUser();
    const{data:uP}=authU?await supabase.from("users").select("role").eq("id",authU.id).single():{data:null};
    let data:any[]=[];
    if(uP?.role==="adm"){const r=await supabase.from("companies").select("*").order("nome_fantasia");data=r.data||[];}
    else if(authU){const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",authU.id);data=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(data&&data.length>0){setCompanies(data);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";const match=saved?(saved==="consolidado"?data[0]:saved.startsWith("group_")?data.find((c:any)=>c.group_id===saved.replace("group_",""))||data[0]:data.find((c:any)=>c.id===saved)):null;setSelectedComp(match?match.id:data[0].id);}
    setLoading(false);
  };

  const loadData=async()=>{
    setLoading(true);
    const[{data:f},{data:l},{data:r}]=await Promise.all([
      supabase.from("bpo_classificacoes").select("*").eq("company_id",selectedComp).order("created_at",{ascending:false}),
      supabase.from("bpo_sync_log").select("*").eq("company_id",selectedComp).order("created_at",{ascending:false}).limit(10),
      supabase.from("bpo_rotinas").select("*").eq("company_id",selectedComp),
    ]);
    setFila(f||[]);setLogs(l||[]);setRotinas(r||[]);
    setSelected(new Set());setSelectAll(false);
    setLoading(false);
  };

  const runClassification=async()=>{
    setClassifying(true);setMsg("");
    try{
      const res=await fetch("/api/bpo/classify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company_id:selectedComp})});
      const d=await res.json();
      if(d.success){
        setMsg(`✅ ${d.classificacoes_geradas} classificações geradas em ${(d.duracao_ms/1000).toFixed(1)}s. ${d.pendentes_restantes>0?`Restam ${d.pendentes_restantes} pendentes.`:""}`);
        loadData();
      } else setMsg(`❌ Erro: ${d.error||d.message}`);
    }catch(e:any){setMsg(`❌ ${e.message}`);}
    setClassifying(false);
  };

  const activateRoutine=async()=>{
    await supabase.from("bpo_rotinas").upsert({company_id:selectedComp,tipo:"auto_classificacao",ativo:true,frequencia:"diaria"},{onConflict:"company_id"});
    setMsg("✅ Rotina de auto-classificação ativada!");loadData();
    setTimeout(()=>setMsg(""),3000);
  };

  const aprovar=async(id:string,catFinal?:string)=>{
    const item=fila.find(f=>f.id===id);
    await supabase.from("bpo_classificacoes").update({status:"aprovado",categoria_final:catFinal||item?.categoria_sugerida,operador_acao:"aprovado",updated_at:new Date().toISOString()}).eq("id",id);
    loadData();
  };

  const rejeitar=async(id:string)=>{
    await supabase.from("bpo_classificacoes").update({status:"rejeitado",operador_acao:"rejeitado",updated_at:new Date().toISOString()}).eq("id",id);
    loadData();
  };

  const aprovarSelecionados=async()=>{
    for(const id of selected){await aprovar(id);}
    setMsg(`✅ ${selected.size} classificações aprovadas.`);
    setTimeout(()=>setMsg(""),3000);
  };

  const aprovarTodos=async()=>{
    const pendentes=fila.filter(f=>f.status==="pendente");
    for(const p of pendentes){await aprovar(p.id);}
    setMsg(`✅ ${pendentes.length} classificações aprovadas.`);loadData();
    setTimeout(()=>setMsg(""),3000);
  };

  const toggleSelect=(id:string)=>{
    const s=new Set(selected);
    if(s.has(id))s.delete(id);else s.add(id);
    setSelected(s);
  };

  const toggleAll=()=>{
    if(selectAll){setSelected(new Set());setSelectAll(false);}
    else{
      const ids=filtered.map(f=>f.id);
      setSelected(new Set(ids));setSelectAll(true);
    }
  };

  const filtered=fila.filter(f=>filtro==="todos"||f.status===filtro);
  const counts={
    pendente:fila.filter(f=>f.status==="pendente").length,
    aprovado:fila.filter(f=>f.status==="aprovado").length,
    rejeitado:fila.filter(f=>f.status==="rejeitado").length,
  };
  const rotinaAtiva=rotinas.some(r=>r.tipo==="auto_classificacao"&&r.ativo);

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",fontFamily:"inherit"};

  return(
    <div style={{padding:20,maxWidth:1100,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>🤖 BPO Automação IA</div>
          <div style={{fontSize:11,color:TXM}}>Auto-classificação de lançamentos por inteligência artificial</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← BPO</a>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:msg.startsWith("✅")?G+"15":R+"15",border:`1px solid ${msg.startsWith("✅")?G:R}30`,borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:12,color:msg.startsWith("✅")?G:R,cursor:"pointer"}}>{msg}</div>}

      {/* Company + Controls */}
      <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`,marginBottom:14,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:TXM,marginBottom:3}}>Empresa</div>
          <select value={selectedComp} onChange={e=>setSelectedComp(e.target.value)} style={{...inp,width:220}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
        </div>
        <div style={{display:"flex",gap:6,alignSelf:"flex-end"}}>
          {!rotinaAtiva?(
            <button onClick={activateRoutine} style={{padding:"8px 16px",borderRadius:8,background:G+"15",border:`1px solid ${G}30`,color:G,fontSize:11,fontWeight:600,cursor:"pointer"}}>⚡ Ativar Auto-Classificação</button>
          ):(
            <span style={{padding:"8px 14px",borderRadius:8,background:G+"15",border:`1px solid ${G}30`,color:G,fontSize:11,fontWeight:600}}>✅ Rotina Ativa</span>
          )}
          <button onClick={runClassification} disabled={classifying} style={{
            padding:"8px 18px",borderRadius:8,border:"none",
            background:classifying?BD:`linear-gradient(135deg,${GO},${GOL})`,
            color:classifying?TXM:BG,fontSize:12,fontWeight:700,cursor:classifying?"wait":"pointer",
          }}>{classifying?"🤖 IA analisando...":"🤖 Executar Classificação IA"}</button>
        </div>
      </div>

      {/* Pipeline status */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))",gap:8,marginBottom:14}}>
        {[
          {label:"Pendentes",value:counts.pendente,cor:Y,icon:"⏳"},
          {label:"Aprovados",value:counts.aprovado,cor:G,icon:"✅"},
          {label:"Rejeitados",value:counts.rejeitado,cor:R,icon:"❌"},
          {label:"Total na Fila",value:fila.length,cor:TX,icon:"📋"},
          {label:"Rotina",value:rotinaAtiva?"Ativa":"Inativa",cor:rotinaAtiva?G:TXD,icon:"⚡"},
          {label:"Última Exec.",value:rotinas.find(r=>r.tipo==="auto_classificacao")?.ultima_execucao?new Date(rotinas.find(r=>r.tipo==="auto_classificacao").ultima_execucao).toLocaleDateString("pt-BR"):"Nunca",cor:TXM,icon:"🕐"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:12,padding:"12px",border:`1px solid ${BD}`,textAlign:"center"}}>
            <div style={{fontSize:16,marginBottom:2}}>{k.icon}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.cor}}>{k.value}</div>
            <div style={{fontSize:9,color:TXM,marginTop:2}}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filter + Bulk actions */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6}}>
        <div style={{display:"flex",gap:4}}>
          {([["pendente",`Pendentes (${counts.pendente})`],["aprovado","Aprovados"],["rejeitado","Rejeitados"],["todos","Todos"]] as const).map(([k,l])=>(
            <button key={k} onClick={()=>{setFiltro(k);setSelected(new Set());setSelectAll(false);}} style={{
              padding:"6px 14px",borderRadius:8,fontSize:11,cursor:"pointer",
              border:filtro===k?`1px solid ${GO}50`:`1px solid ${BD}`,
              background:filtro===k?GO+"10":"transparent",color:filtro===k?GOL:TXM,fontWeight:filtro===k?600:400,
            }}>{l}</button>
          ))}
        </div>
        {filtro==="pendente"&&counts.pendente>0&&(
          <div style={{display:"flex",gap:6}}>
            {selected.size>0&&(
              <button onClick={aprovarSelecionados} style={{padding:"6px 14px",borderRadius:8,background:G+"15",border:`1px solid ${G}30`,color:G,fontSize:11,fontWeight:600,cursor:"pointer"}}>✅ Aprovar {selected.size} selecionados</button>
            )}
            <button onClick={aprovarTodos} style={{padding:"6px 14px",borderRadius:8,background:GO+"15",border:`1px solid ${GO}30`,color:GOL,fontSize:11,fontWeight:600,cursor:"pointer"}}>✅ Aprovar Todos ({counts.pendente})</button>
          </div>
        )}
      </div>

      {/* Classification queue */}
      {loading?(
        <div style={{padding:24,textAlign:"center",color:TXM}}>Carregando...</div>
      ):filtered.length===0?(
        <div style={{background:BG2,borderRadius:14,padding:32,border:`1px solid ${BD}`,textAlign:"center"}}>
          <div style={{fontSize:32,marginBottom:8}}>🤖</div>
          <div style={{fontSize:14,color:TX}}>Nenhuma classificação {filtro==="pendente"?"pendente":""} encontrada</div>
          <div style={{fontSize:11,color:TXM,marginTop:4}}>Clique em "Executar Classificação IA" para analisar lançamentos sem categoria.</div>
        </div>
      ):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
          <div style={{overflowX:"auto",maxHeight:500,overflowY:"auto"}}>
            <table style={{width:"100%",fontSize:11,minWidth:900}}>
              <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}>
                <tr style={{borderBottom:`1px solid ${BD}`}}>
                  {filtro==="pendente"&&<th style={{padding:"8px 6px",width:30}}><input type="checkbox" checked={selectAll} onChange={toggleAll}/></th>}
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>TIPO</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>DATA</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>CLIENTE / FORNECEDOR</th>
                  <th style={{padding:"8px 6px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>VALOR</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>CATEGORIA ATUAL</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>SUGESTÃO IA</th>
                  <th style={{padding:"8px 6px",textAlign:"center",color:GO,fontSize:10,fontWeight:600}}>CONFIANÇA</th>
                  <th style={{padding:"8px 6px",textAlign:"center",color:GO,fontSize:10,fontWeight:600}}>AÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item,i)=>{
                  const confColor=item.confianca>=80?G:item.confianca>=50?Y:R;
                  return(
                    <tr key={item.id} style={{borderBottom:`0.5px solid ${BD}30`,background:i%2===0?"rgba(255,255,255,0.01)":"transparent"}}>
                      {filtro==="pendente"&&<td style={{padding:"6px"}}><input type="checkbox" checked={selected.has(item.id)} onChange={()=>toggleSelect(item.id)}/></td>}
                      <td style={{padding:"6px"}}><span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:item.tipo_conta==="receber"?G+"15":R+"15",color:item.tipo_conta==="receber"?G:R}}>{item.tipo_conta==="receber"?"📥 Receber":"📤 Pagar"}</span></td>
                      <td style={{padding:"6px",color:TXM,fontSize:11}}>{item.data_lancamento}</td>
                      <td style={{padding:"6px",color:TX,fontSize:12,fontWeight:500,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis"}}>{item.nome_cliente_fornecedor}</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:TX,fontSize:12}}>{fmtR(item.valor)}</td>
                      <td style={{padding:"6px",color:Y,fontSize:10}}>{item.categoria_atual}</td>
                      <td style={{padding:"6px"}}>
                        <div style={{color:G,fontSize:10,fontWeight:500}}>{item.categoria_sugerida}</div>
                        {item.justificativa&&<div style={{fontSize:8,color:TXD,marginTop:2}}>{item.justificativa}</div>}
                      </td>
                      <td style={{padding:"6px",textAlign:"center"}}>
                        <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:`${confColor}15`,color:confColor,fontWeight:600,border:`1px solid ${confColor}25`}}>{item.confianca}%</span>
                      </td>
                      <td style={{padding:"6px",textAlign:"center"}}>
                        {item.status==="pendente"?(
                          <div style={{display:"flex",gap:3,justifyContent:"center"}}>
                            <button onClick={()=>aprovar(item.id)} style={{padding:"3px 8px",borderRadius:4,background:G+"15",border:`1px solid ${G}30`,color:G,fontSize:9,cursor:"pointer",fontWeight:600}}>✅</button>
                            <button onClick={()=>rejeitar(item.id)} style={{padding:"3px 8px",borderRadius:4,background:R+"15",border:`1px solid ${R}30`,color:R,fontSize:9,cursor:"pointer",fontWeight:600}}>❌</button>
                          </div>
                        ):(
                          <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:item.status==="aprovado"?G+"15":R+"15",color:item.status==="aprovado"?G:R}}>{item.status==="aprovado"?"✅ Aprovado":"❌ Rejeitado"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sync Log */}
      {logs.length>0&&(
        <div style={{marginTop:14}}>
          <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:8}}>📋 Histórico de Execuções</div>
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <table style={{width:"100%",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                <th style={{padding:"8px",textAlign:"left",color:GO,fontSize:10}}>DATA/HORA</th>
                <th style={{padding:"8px",textAlign:"left",color:GO,fontSize:10}}>TIPO</th>
                <th style={{padding:"8px",textAlign:"center",color:GO,fontSize:10}}>PROCESSADOS</th>
                <th style={{padding:"8px",textAlign:"center",color:GO,fontSize:10}}>CLASSIFICADOS</th>
                <th style={{padding:"8px",textAlign:"center",color:GO,fontSize:10}}>STATUS</th>
                <th style={{padding:"8px",textAlign:"right",color:GO,fontSize:10}}>DURAÇÃO</th>
              </tr></thead>
              <tbody>
                {logs.map(l=>(
                  <tr key={l.id} style={{borderBottom:`0.5px solid ${BD}30`}}>
                    <td style={{padding:"8px",color:TXM}}>{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                    <td style={{padding:"8px",color:TX}}>{l.tipo}</td>
                    <td style={{padding:"8px",textAlign:"center",color:TX}}>{l.registros_processados}</td>
                    <td style={{padding:"8px",textAlign:"center",color:G,fontWeight:600}}>{l.classificacoes_geradas}</td>
                    <td style={{padding:"8px",textAlign:"center"}}><span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:l.status==="sucesso"?G+"15":R+"15",color:l.status==="sucesso"?G:R}}>{l.status}</span></td>
                    <td style={{padding:"8px",textAlign:"right",color:TXM}}>{(l.duracao_ms/1000).toFixed(1)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
