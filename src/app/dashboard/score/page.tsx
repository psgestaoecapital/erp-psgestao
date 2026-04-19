"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6";

const CLASSIF:Record<string,{cor:string;bg:string;icon:string;label:string;desc:string}>={
  BAIXO: {cor:G,bg:G+"15",icon:"✅",label:"Baixo Risco",desc:"Pagamentos em dia, cliente saudável"},
  MEDIO: {cor:Y,bg:Y+"15",icon:"⚠️",label:"Médio Risco",desc:"Alguns atrasos, monitorar"},
  ALTO:  {cor:R,bg:R+"15",icon:"🚨",label:"Alto Risco",desc:"Muitos atrasos, ação imediata"},
  NOVO:  {cor:B,bg:B+"15",icon:"🆕",label:"Novo",desc:"Sem histórico de compras"},
};

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtD=(v:string)=>v?new Date(v).toLocaleDateString("pt-BR"):'—';

export default function ScorePage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [clientes,setClientes]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroRisco,setFiltroRisco]=useState<string>("todos");
  const [msg,setMsg]=useState("");
  const [recalculando,setRecalculando]=useState(false);
  const [detalhe,setDetalhe]=useState<any|null>(null);
  const [detalheHist,setDetalheHist]=useState<any[]>([]);
  const [analisando,setAnalisando]=useState(false);
  const [parecer,setParecer]=useState<string>("");

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel)loadClientes();},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadClientes=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_clientes").select("*").eq("company_id",sel).eq("ativo",true).order("score_inadimplencia",{ascending:false,nullsFirst:false});
    if(data)setClientes(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const recalcularTodos=async()=>{
    if(!confirm("Recalcular o score de TODOS os clientes desta empresa? Pode levar alguns segundos."))return;
    setRecalculando(true);
    const{data,error}=await supabase.rpc('recalcular_scores_empresa',{p_company_id:sel});
    if(error){setMsg("❌ "+error.message);setRecalculando(false);return;}
    const r=data?.[0];
    setMsg(`✅ ${r?.processados||0} clientes atualizados · ${r?.alto_risco||0} alto · ${r?.medio_risco||0} médio · ${r?.baixo_risco||0} baixo`);
    setRecalculando(false);
    loadClientes();
    setTimeout(()=>setMsg(""),5000);
  };

  const recalcularUm=async(clienteId:string)=>{
    const{error}=await supabase.rpc('atualizar_score_cliente',{p_cliente_id:clienteId});
    if(error){setMsg("❌ "+error.message);return;}
    setMsg("✅ Score atualizado");
    loadClientes();
    if(detalhe?.id===clienteId)abrirDetalhe(clienteId);
    setTimeout(()=>setMsg(""),2000);
  };

  const abrirDetalhe=async(clienteId:string)=>{
    const{data:c}=await supabase.from("erp_clientes").select("*").eq("id",clienteId).maybeSingle();
    if(c){
      setDetalhe(c);
      setParecer("");
      const{data:h}=await supabase.from("erp_score_historico").select("*").eq("cliente_id",clienteId).order("calculado_em",{ascending:false}).limit(10);
      setDetalheHist(h||[]);
    }
  };

  const analisarComIA=async()=>{
    if(!detalhe)return;
    setAnalisando(true);
    setParecer("");
    try{
      const r=await fetch("/api/analise-cliente-ia",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cliente_id:detalhe.id})});
      const d=await r.json();
      if(d.error){setMsg("❌ "+d.error);}
      else{setParecer(d.parecer);}
    }catch(err:any){setMsg("❌ "+err.message);}
    setAnalisando(false);
  };

  const filtrados=useMemo(()=>{
    let r=clientes;
    if(filtroRisco!=='todos')r=r.filter(c=>(c.classificacao_risco||'NOVO')===filtroRisco);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(c=>(c.razao_social||c.nome||'').toLowerCase().includes(b)||(c.nome_fantasia||'').toLowerCase().includes(b)||(c.cpf_cnpj||'').includes(b.replace(/\D/g,'')));
    }
    return r;
  },[clientes,filtroRisco,busca]);

  const kpis={
    total: clientes.length,
    alto: clientes.filter(c=>c.classificacao_risco==='ALTO').length,
    medio: clientes.filter(c=>c.classificacao_risco==='MEDIO').length,
    baixo: clientes.filter(c=>c.classificacao_risco==='BAIXO').length,
    novos: clientes.filter(c=>!c.classificacao_risco||c.classificacao_risco==='NOVO').length,
    riscoTotal: clientes.filter(c=>c.classificacao_risco==='ALTO').reduce((s,c)=>s+Number(c.limite_credito||0),0),
  };

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🎯 Score de Inadimplência</div>
          <div style={{fontSize:11,color:TXD}}>Análise de risco com IA · Classificação automática · Histórico evolutivo</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <button onClick={recalcularTodos} disabled={recalculando} style={{padding:"8px 14px",borderRadius:8,background:GO+"15",color:GO,fontSize:12,fontWeight:600,border:`1px solid ${GO}40`,cursor:recalculando?"wait":"pointer",opacity:recalculando?0.5:1}}>
            {recalculando?"⏳ Processando...":"🔄 Recalcular Todos"}
          </button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Total Clientes",v:String(kpis.total),c:B,icon:"👥"},
          {l:"Alto Risco",v:String(kpis.alto),c:R,icon:"🚨"},
          {l:"Médio Risco",v:String(kpis.medio),c:Y,icon:"⚠️"},
          {l:"Baixo Risco",v:String(kpis.baixo),c:G,icon:"✅"},
          {l:"Exposição Alto Risco",v:fmtR(kpis.riscoTotal),c:R,icon:"💸"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:15,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por nome, fantasia ou CNPJ..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          <button onClick={()=>setFiltroRisco("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroRisco==="todos"?GO:BD}`,background:filtroRisco==="todos"?GO+"12":"transparent",color:filtroRisco==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroRisco==="todos"?600:400}}>Todos</button>
          {Object.entries(CLASSIF).map(([k,cfg])=>(
            <button key={k} onClick={()=>setFiltroRisco(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroRisco===k?cfg.cor:BD}`,background:filtroRisco===k?cfg.cor+"12":"transparent",color:filtroRisco===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroRisco===k?600:400}}>{cfg.icon} {cfg.label}</button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>🎯</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum cliente encontrado</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>{clientes.length===0?"Cadastre clientes primeiro em Clientes, depois clique em Recalcular Todos":"Ajuste os filtros acima"}</div>
              {clientes.length>0&&kpis.novos>0&&<button onClick={recalcularTodos} disabled={recalculando} style={{padding:"10px 20px",borderRadius:8,background:GO,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>🔄 Calcular Scores Agora</button>}
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:100}}>Score</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:110}}>Risco</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Ticket Médio</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:110}}>Total (12m)</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Atrasos</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:100}}>Dias Médios</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtrados.map(c=>{
                  const cfg=CLASSIF[c.classificacao_risco||'NOVO'];
                  const score=c.score_inadimplencia||0;
                  return(
                    <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}`,cursor:"pointer"}} onClick={()=>abrirDetalhe(c.id)}>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{c.razao_social||c.nome}</div>
                        {c.nome_fantasia&&<div style={{fontSize:9,color:TXD}}>{c.nome_fantasia}</div>}
                        {c.cpf_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{c.cpf_cnpj}</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <div style={{fontSize:20,fontWeight:800,color:cfg.cor,fontFamily:"monospace"}}>{score}</div>
                        <div style={{fontSize:8,color:TXD}}>/100</div>
                      </td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.bg,color:cfg.cor,fontWeight:700,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:TXM,fontSize:10}}>{Number(c.ticket_medio)>0?fmtR(c.ticket_medio):'—'}</td>
                      <td style={{padding:"8px",textAlign:"right",color:G,fontWeight:600}}>{Number(c.total_compras)>0?fmtR(c.total_compras):'—'}</td>
                      <td style={{padding:"8px",textAlign:"center",color:Number(c.qtd_atrasos)>0?R:TXM,fontWeight:Number(c.qtd_atrasos)>0?700:400}}>{c.qtd_atrasos||0}/{c.qtd_compras||0}</td>
                      <td style={{padding:"8px",textAlign:"center",color:Number(c.dias_medio_atraso)>0?Y:TXM}}>{Number(c.dias_medio_atraso)>0?Number(c.dias_medio_atraso).toFixed(1)+'d':'—'}</td>
                      <td style={{padding:"8px",textAlign:"right"}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>recalcularUm(c.id)} style={{fontSize:10,padding:"4px 8px",borderRadius:6,background:BG3,color:TXM,border:`1px solid ${BD}`,cursor:"pointer"}}>🔄</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal Detalhe */}
      {detalhe&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setDetalhe(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div style={{fontSize:20,fontWeight:700,color:TX}}>{detalhe.razao_social||detalhe.nome}</div>
                <div style={{fontSize:11,color:TXD}}>{detalhe.cpf_cnpj||'—'} · {detalhe.cidade||'—'}/{detalhe.uf||'—'}</div>
              </div>
              <button onClick={()=>setDetalhe(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {(()=>{
              const cfg=CLASSIF[detalhe.classificacao_risco||'NOVO'];
              const componentes=detalheHist?.[0]?.componentes||{};
              return(
                <>
                  <div style={{background:cfg.bg,borderRadius:12,padding:20,marginBottom:16,border:`2px solid ${cfg.cor}40`,display:"flex",alignItems:"center",gap:20}}>
                    <div style={{textAlign:"center"}}>
                      <div style={{fontSize:56,fontWeight:900,color:cfg.cor,fontFamily:"monospace",lineHeight:1}}>{detalhe.score_inadimplencia||0}</div>
                      <div style={{fontSize:11,color:TXD,fontWeight:600}}>/ 100</div>
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:18,fontWeight:700,color:cfg.cor,marginBottom:4}}>{cfg.icon} {cfg.label}</div>
                      <div style={{fontSize:12,color:TXM}}>{cfg.desc}</div>
                      {componentes.dias_sem_comprar!==null&&componentes.dias_sem_comprar!==undefined&&<div style={{fontSize:11,color:TXM,marginTop:4}}>Última compra: há <b>{componentes.dias_sem_comprar} dias</b></div>}
                    </div>
                  </div>

                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
                    <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TOTAL 12M</div><div style={{fontSize:14,fontWeight:700,color:G}}>{fmtR(detalhe.total_compras)}</div></div>
                    <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TICKET MÉDIO</div><div style={{fontSize:14,fontWeight:700,color:TX}}>{fmtR(detalhe.ticket_medio)}</div></div>
                    <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>ATRASOS</div><div style={{fontSize:14,fontWeight:700,color:Number(detalhe.qtd_atrasos)>0?R:G}}>{detalhe.qtd_atrasos||0}/{detalhe.qtd_compras||0}</div></div>
                    <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>DIAS MÉDIOS</div><div style={{fontSize:14,fontWeight:700,color:Number(detalhe.dias_medio_atraso)>0?Y:G}}>{Number(detalhe.dias_medio_atraso||0).toFixed(1)}</div></div>
                  </div>

                  {Object.keys(componentes).length>0&&(
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:11,fontWeight:700,color:GO,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📊 Componentes do Score</div>
                      <div style={{background:BG3,borderRadius:10,padding:14}}>
                        {[
                          {k:"atraso_pct_pontos",l:"% de atrasos sobre pagos",max:30},
                          {k:"dias_medio_pontos",l:"Dias médios de atraso",max:25},
                          {k:"tendencia_pontos",l:"Tendência recente (3m vs 6m)",max:20},
                          {k:"valor_atraso_pontos",l:"Valor em atraso atual",max:15},
                          {k:"frequencia_pontos",l:"Frequência de compras",max:10},
                          {k:"bonus_fidelidade",l:"Bonificação fidelidade",max:-15},
                        ].map(item=>{
                          const val=Number(componentes[item.k]||0);
                          const absMax=Math.abs(item.max);
                          const pct=Math.abs(val)/absMax*100;
                          const isNeg=val<0;
                          return(
                            <div key={item.k} style={{marginBottom:8}}>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,marginBottom:3}}>
                                <span style={{color:TXM}}>{item.l}</span>
                                <span style={{color:isNeg?G:TX,fontWeight:600,fontFamily:"monospace"}}>{isNeg?'':'+'}{val} / {item.max}</span>
                              </div>
                              <div style={{background:BG2,height:6,borderRadius:3,overflow:"hidden"}}>
                                <div style={{width:pct+"%",height:"100%",background:isNeg?G:val>item.max*0.5?R:val>item.max*0.3?Y:G,transition:"width 0.3s"}}/>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {detalheHist.length>1&&(
                    <div style={{marginBottom:16}}>
                      <div style={{fontSize:11,fontWeight:700,color:GO,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📈 Evolução do Score</div>
                      <div style={{background:BG3,borderRadius:10,padding:14,display:"flex",gap:6,alignItems:"flex-end",minHeight:80}}>
                        {detalheHist.slice().reverse().map((h,idx)=>{
                          const c=CLASSIF[h.classificacao]||CLASSIF.NOVO;
                          return(
                            <div key={idx} style={{flex:1,textAlign:"center"}}>
                              <div style={{fontSize:9,color:TXD,marginBottom:3}}>{h.score}</div>
                              <div style={{background:c.cor,height:Math.max(12,h.score*0.5)+"px",borderRadius:4}}></div>
                              <div style={{fontSize:8,color:TXD,marginTop:3}}>{fmtD(h.calculado_em)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Parecer IA */}
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:700,color:GO,textTransform:"uppercase",letterSpacing:0.5}}>🤖 Parecer com IA (Claude)</div>
                      {!parecer&&<button onClick={analisarComIA} disabled={analisando} style={{padding:"8px 16px",borderRadius:8,background:P+"15",color:P,fontSize:11,fontWeight:600,border:`1px solid ${P}40`,cursor:analisando?"wait":"pointer",opacity:analisando?0.5:1}}>{analisando?"⏳ Analisando...":"🧠 Analisar com IA"}</button>}
                    </div>
                    {parecer?(
                      <div style={{background:P+"08",borderRadius:10,padding:16,border:`1px solid ${P}30`}}>
                        <div style={{whiteSpace:"pre-wrap",fontSize:12,color:TX,lineHeight:1.6}}>{parecer}</div>
                      </div>
                    ):(
                      <div style={{background:BG3,borderRadius:10,padding:16,textAlign:"center",color:TXD,fontSize:11}}>
                        Clique em "Analisar com IA" para gerar um parecer financeiro detalhado deste cliente usando Claude.
                      </div>
                    )}
                  </div>

                  <div style={{display:"flex",gap:8,justifyContent:"space-between",paddingTop:14,borderTop:`1px solid ${BD}`}}>
                    <button onClick={()=>recalcularUm(detalhe.id)} style={{padding:"8px 16px",borderRadius:8,background:GO+"15",color:GO,fontSize:11,fontWeight:600,border:`1px solid ${GO}40`,cursor:"pointer"}}>🔄 Recalcular Agora</button>
                    <button onClick={()=>setDetalhe(null)} style={{padding:"8px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Fechar</button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Score de Inadimplência v1.0 · Fórmula ponderada · Parecer com IA · Sprint 5.2</div>
    </div>
  );
}
