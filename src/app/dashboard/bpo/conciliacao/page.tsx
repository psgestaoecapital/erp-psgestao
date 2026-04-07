"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";
const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

export default function ConciliacaoPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [selComp,setSelComp]=useState("");
  const [uploading,setUploading]=useState(false);
  const [operadora,setOperadora]=useState("Visa");
  const [resumo,setResumo]=useState<any>(null);
  const [concId,setConcId]=useState<string|null>(null);
  const [itens,setItens]=useState<any[]>([]);
  const [historico,setHistorico]=useState<any[]>([]);
  const [msg,setMsg]=useState("");
  const [filtro,setFiltro]=useState("todos");
  const [loading,setLoading]=useState(true);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selComp&&typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",selComp);},[selComp]);
  useEffect(()=>{if(selComp)loadHistorico();},[selComp]);

  const loadCompanies=async()=>{
    const{data}=await supabase.from("companies").select("*").order("nome_fantasia");
    if(data&&data.length>0){setCompanies(data);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";const match=saved?(saved==="consolidado"?data[0]:saved.startsWith("group_")?data.find((c:any)=>c.group_id===saved.replace("group_",""))||data[0]:data.find((c:any)=>c.id===saved)):null;setSelComp(match?match.id:data[0].id);}
    setLoading(false);
  };

  const loadHistorico=async()=>{
    const{data}=await supabase.from("conciliacao_cartao").select("*").eq("company_id",selComp).order("created_at",{ascending:false}).limit(10);
    setHistorico(data||[]);
  };

  const loadItens=async(id:string)=>{
    setConcId(id);
    const{data}=await supabase.from("conciliacao_itens").select("*").eq("conciliacao_id",id).order("status,valor");
    setItens(data||[]);
  };

  const upload=async(file:File)=>{
    setUploading(true);setMsg("");setResumo(null);setConcId(null);setItens([]);
    const form=new FormData();
    form.append("file",file);form.append("company_id",selComp);form.append("operadora",operadora);
    try{
      const res=await fetch("/api/conciliacao",{method:"POST",body:form});
      const d=await res.json();
      if(d.success){setResumo(d.resumo);setConcId(d.conciliacao_id);loadItens(d.conciliacao_id);loadHistorico();setMsg(`✅ ${d.resumo.transacoes_fatura} transações processadas!`);}
      else setMsg(`❌ ${d.error}`);
    }catch(e:any){setMsg(`❌ ${e.message}`);}
    setUploading(false);
  };

  const updateStatus=async(id:string,status:string)=>{
    await supabase.from("conciliacao_itens").update({status,operador_acao:status}).eq("id",id);
    if(concId)loadItens(concId);
  };

  const aprovarTodos=async()=>{
    const conc=itens.filter(i=>i.status==="conciliado"||i.status==="sugestao");
    for(const c of conc) await supabase.from("conciliacao_itens").update({status:"aprovado",operador_acao:"aprovado"}).eq("id",c.id);
    if(concId)loadItens(concId);
    setMsg(`✅ ${conc.length} itens aprovados!`);setTimeout(()=>setMsg(""),3000);
  };

  const filtered=filtro==="todos"?itens:itens.filter(i=>i.status===filtro);
  const counts={conciliado:itens.filter(i=>i.status==="conciliado").length,sugestao:itens.filter(i=>i.status==="sugestao").length,somente_fatura:itens.filter(i=>i.status==="somente_fatura").length,somente_omie:itens.filter(i=>i.status==="somente_omie").length,aprovado:itens.filter(i=>i.status==="aprovado").length};
  const stCfg:Record<string,{cor:string;icon:string;label:string}>={conciliado:{cor:G,icon:"✅",label:"Conciliado"},sugestao:{cor:Y,icon:"⚠️",label:"Sugestão IA"},somente_fatura:{cor:R,icon:"❌",label:"Só Fatura"},somente_omie:{cor:P,icon:"🔍",label:"Só Omie"},aprovado:{cor:G,icon:"✅",label:"Aprovado"},rejeitado:{cor:R,icon:"❌",label:"Rejeitado"},pendente:{cor:TXM,icon:"⏳",label:"Pendente"}};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",fontFamily:"inherit"};

  return(
    <div style={{padding:20,maxWidth:1200,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>💳 Conciliação de Cartão de Crédito</div>
          <div style={{fontSize:11,color:TXM}}>Upload da fatura (OFX/CSV) → Matching automático com Omie → Aprovação</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href="/dashboard/bpo" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← BPO</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:msg.startsWith("✅")?G+"15":R+"15",border:`1px solid ${msg.startsWith("✅")?G:R}30`,borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:12,color:msg.startsWith("✅")?G:R,cursor:"pointer"}}>{msg}</div>}

      {/* Upload */}
      <div style={{background:BG2,borderRadius:14,padding:16,border:`1px solid ${BD}`,marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:600,color:GOL,marginBottom:12}}>📤 Upload da Fatura</div>
        <div style={{display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap"}}>
          <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>Empresa</div><select value={selComp} onChange={e=>setSelComp(e.target.value)} style={{...inp,width:220}}>{companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}</select></div>
          <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>Operadora</div><select value={operadora} onChange={e=>setOperadora(e.target.value)} style={{...inp,width:140}}>{["Visa","Mastercard","Elo","Amex","Hipercard","Sicredi","Stone","PagSeguro","Cielo","Rede","Getnet","Outro"].map(o=><option key={o}>{o}</option>)}</select></div>
          <div><div style={{fontSize:10,color:TXM,marginBottom:3}}>Arquivo (OFX, CSV, TXT)</div><input type="file" accept=".ofx,.ofc,.csv,.txt,.tsv" onChange={e=>{if(e.target.files?.[0])upload(e.target.files[0]);}} disabled={uploading} style={{fontSize:11,color:TX}}/></div>
          {uploading&&<div style={{fontSize:12,color:GOL,fontWeight:600}}>⏳ Processando...</div>}
        </div>
        <div style={{fontSize:10,color:TXD,marginTop:8}}>O sistema detecta automaticamente o formato e as colunas. Suporta extratos OFX de qualquer banco e CSV de qualquer operadora.</div>
      </div>

      {/* KPIs */}
      {resumo&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(130px, 1fr))",gap:8,marginBottom:14}}>
          {[{l:"Transações",v:resumo.transacoes_fatura,c:TX,i:"💳"},{l:"Conciliados",v:resumo.conciliados,c:G,i:"✅"},{l:"Sugestões IA",v:resumo.sugestoes,c:Y,i:"⚠️"},{l:"Só Fatura",v:resumo.somente_fatura,c:R,i:"❌"},{l:"Só Omie",v:resumo.somente_omie,c:P,i:"🔍"},{l:"Divergência",v:fmtR(resumo.divergencia),c:Math.abs(resumo.divergencia)<1?G:R,i:"📊"}].map((k,i)=>(
            <div key={i} style={{background:BG2,borderRadius:12,padding:"12px",border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:16,marginBottom:2}}>{k.i}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.c}}>{k.v}</div>
              <div style={{fontSize:9,color:TXM,marginTop:2}}>{k.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters + Actions */}
      {itens.length>0&&(
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:6}}>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {[["todos","Todos"],["conciliado",`✅ (${counts.conciliado})`],["sugestao",`⚠️ (${counts.sugestao})`],["somente_fatura",`❌ Fatura (${counts.somente_fatura})`],["somente_omie",`🔍 Omie (${counts.somente_omie})`]].map(([k,l])=>(
              <button key={k} onClick={()=>setFiltro(k)} style={{padding:"5px 12px",borderRadius:8,fontSize:10,cursor:"pointer",border:filtro===k?`1px solid ${GO}50`:`1px solid ${BD}`,background:filtro===k?GO+"10":"transparent",color:filtro===k?GOL:TXM,fontWeight:filtro===k?600:400}}>{l}</button>
            ))}
          </div>
          {(counts.conciliado+counts.sugestao)>0&&<button onClick={aprovarTodos} style={{padding:"6px 14px",borderRadius:8,background:G+"15",border:`1px solid ${G}30`,color:G,fontSize:11,fontWeight:600,cursor:"pointer"}}>✅ Aprovar Todos ({counts.conciliado+counts.sugestao})</button>}
        </div>
      )}

      {/* Items table */}
      {itens.length>0&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden",marginBottom:14}}>
          <div style={{overflowX:"auto",maxHeight:500,overflowY:"auto"}}>
            <table style={{width:"100%",fontSize:11,minWidth:900}}>
              <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}>
                <tr style={{borderBottom:`1px solid ${BD}`}}>
                  <th style={{padding:"8px 6px",textAlign:"center",color:GO,fontSize:9,fontWeight:600}}>STATUS</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>DATA</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>FATURA</th>
                  <th style={{padding:"8px 6px",textAlign:"right",color:GO,fontSize:9,fontWeight:600}}>VALOR FAT.</th>
                  <th style={{padding:"8px 6px",textAlign:"center",color:GO,fontSize:9,fontWeight:600}}>MATCH</th>
                  <th style={{padding:"8px 6px",textAlign:"left",color:GO,fontSize:9,fontWeight:600}}>OMIE</th>
                  <th style={{padding:"8px 6px",textAlign:"right",color:GO,fontSize:9,fontWeight:600}}>VALOR OMIE</th>
                  <th style={{padding:"8px 6px",textAlign:"center",color:GO,fontSize:9,fontWeight:600}}>AÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item,i)=>{
                  const st=stCfg[item.status]||stCfg.pendente;
                  const diff=item.match_valor>0?item.valor-item.match_valor:0;
                  return(
                    <tr key={item.id} style={{borderBottom:`0.5px solid ${BD}30`,background:i%2===0?"rgba(255,255,255,0.01)":"transparent"}}>
                      <td style={{padding:"6px",textAlign:"center"}}><span style={{fontSize:9,padding:"2px 8px",borderRadius:6,background:`${st.cor}15`,color:st.cor,fontWeight:600,border:`1px solid ${st.cor}25`,whiteSpace:"nowrap"}}>{st.icon} {st.label}</span></td>
                      <td style={{padding:"6px",color:TXM,fontSize:11,whiteSpace:"nowrap"}}>{item.data_transacao}</td>
                      <td style={{padding:"6px",color:TX,fontSize:12,fontWeight:500,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis"}}>{item.descricao||"—"}</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:item.fonte==="fatura"?TX:TXD,fontSize:12}}>{item.fonte==="fatura"?fmtR(item.valor):"—"}</td>
                      <td style={{padding:"6px",textAlign:"center"}}>{item.match_score>0?<span style={{fontSize:10,padding:"2px 6px",borderRadius:4,background:item.match_score>=70?G+"15":Y+"15",color:item.match_score>=70?G:Y,fontWeight:600}}>{item.match_score}%</span>:"—"}</td>
                      <td style={{padding:"6px",color:item.match_descricao?G:item.fonte==="omie"?TX:TXD,fontSize:11}}>{item.match_descricao||(item.fonte==="omie"?item.descricao:"")||"—"}</td>
                      <td style={{padding:"6px",textAlign:"right",fontWeight:600,color:TX,fontSize:12}}>
                        {item.match_valor>0?fmtR(item.match_valor):item.fonte==="omie"?fmtR(item.valor):"—"}
                        {Math.abs(diff)>0.01&&<div style={{fontSize:8,color:R}}>Δ {fmtR(diff)}</div>}
                      </td>
                      <td style={{padding:"6px",textAlign:"center"}}>
                        {item.status!=="aprovado"&&item.status!=="rejeitado"?(
                          <div style={{display:"flex",gap:3,justifyContent:"center"}}>
                            <button onClick={()=>updateStatus(item.id,"aprovado")} style={{padding:"2px 6px",borderRadius:4,background:G+"15",border:`1px solid ${G}30`,color:G,fontSize:9,cursor:"pointer"}}>✅</button>
                            <button onClick={()=>updateStatus(item.id,"rejeitado")} style={{padding:"2px 6px",borderRadius:4,background:R+"15",border:`1px solid ${R}30`,color:R,fontSize:9,cursor:"pointer"}}>❌</button>
                          </div>
                        ):<span style={{fontSize:9,color:item.status==="aprovado"?G:R}}>{item.status==="aprovado"?"✅":"❌"}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* History */}
      {historico.length>0&&(
        <div>
          <div style={{fontSize:14,fontWeight:600,color:GOL,marginBottom:8}}>📋 Histórico</div>
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <table style={{width:"100%",fontSize:11}}>
              <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                {["DATA","ARQUIVO","OPERADORA","TOTAL","CONCIL.","DIVERG.","DIVERGÊNCIA",""].map(h=><th key={h} style={{padding:"8px",textAlign:h==="TOTAL"||h==="DIVERGÊNCIA"?"right":"left",color:GO,fontSize:9}}>{h}</th>)}
              </tr></thead>
              <tbody>{historico.map(h=>(
                <tr key={h.id} style={{borderBottom:`0.5px solid ${BD}30`}}>
                  <td style={{padding:"8px",color:TXM}}>{new Date(h.created_at).toLocaleDateString("pt-BR")}</td>
                  <td style={{padding:"8px",color:TX,fontWeight:500}}>{h.nome_fatura}</td>
                  <td style={{padding:"8px",color:TXM}}>{h.operadora}</td>
                  <td style={{padding:"8px",textAlign:"right",color:TX,fontWeight:600}}>{fmtR(h.total_fatura)}</td>
                  <td style={{padding:"8px",color:G,fontWeight:600}}>{h.itens_conciliados}</td>
                  <td style={{padding:"8px",color:h.itens_divergentes>0?Y:TXD}}>{h.itens_divergentes+h.itens_somente_fatura}</td>
                  <td style={{padding:"8px",textAlign:"right",color:Math.abs(h.divergencia)<1?G:R,fontWeight:600}}>{fmtR(h.divergencia)}</td>
                  <td style={{padding:"8px"}}><button onClick={()=>loadItens(h.id)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${GO}30`,background:"transparent",color:GO,fontSize:10,cursor:"pointer"}}>Ver</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
