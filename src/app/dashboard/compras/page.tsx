"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Compra={
  id:string;company_id:string;numero:string;cotacao_origem_id:string;
  fornecedor_id:string;fornecedor_nome:string;fornecedor_cnpj:string;
  data_pedido:string;data_prevista:string;data_recebimento:string;data_faturamento:string;
  status:string;condicao_pagamento:string;forma_pagamento:string;parcelas:number;
  prazo_entrega_dias:number;frete_tipo:string;frete_valor:number;
  subtotal:number;desconto_valor:number;total:number;
  nf_numero:string;estoque_baixado:boolean;titulos_gerados:boolean;
  observacoes:string;created_at:string;
};

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}>={
  aberto:           {cor:B, icon:"📋", label:"Aberto"},
  enviado:          {cor:P, icon:"📤", label:"Enviado"},
  confirmado:       {cor:T, icon:"✓",  label:"Confirmado"},
  em_transito:      {cor:Y, icon:"🚚", label:"Em Trânsito"},
  recebido_parcial: {cor:Y, icon:"📦", label:"Receb. Parcial"},
  recebido:         {cor:G, icon:"📦", label:"Recebido"},
  faturado:         {cor:GO,icon:"📄", label:"Faturado"},
  cancelado:        {cor:R, icon:"❌", label:"Cancelado"},
};

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';

export default function ComprasPage(){
  const [compras,setCompras]=useState<Compra[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroStatus,setFiltroStatus]=useState("todos");
  const [msg,setMsg]=useState("");
  const [detalhe,setDetalhe]=useState<Compra|null>(null);
  const [itens,setItens]=useState<any[]>([]);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel)loadCompras();},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadCompras=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_compras").select("*").eq("company_id",sel).order("data_pedido",{ascending:false}).limit(200);
    if(data)setCompras(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const abrirDetalhe=async(c:Compra)=>{
    setDetalhe(c);
    const{data}=await supabase.from("erp_compras_itens").select("*").eq("compra_id",c.id).order("ordem");
    setItens(data||[]);
  };

  const mudarStatus=async(c:Compra,novoStatus:string)=>{
    await supabase.from("erp_compras").update({status:novoStatus}).eq("id",c.id);
    setMsg(`✅ Status alterado para ${STATUS_CFG[novoStatus]?.label}`);
    loadCompras();
    if(detalhe?.id===c.id)abrirDetalhe({...c,status:novoStatus});
    setTimeout(()=>setMsg(""),3000);
  };

  const receberCompra=async(c:Compra)=>{
    if(c.estoque_baixado){setMsg("⚠️ Estoque já foi dado entrada para esta compra");return;}
    if(!confirm(`Receber compra ${c.numero}? Todos os produtos entrarão no estoque automaticamente e o custo médio será recalculado.`))return;
    
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('receber_compra',{p_compra_id:c.id,p_user_id:user?.id});
    if(error){setMsg("❌ "+error.message);return;}
    const r=data?.[0];
    setMsg(`✅ Compra recebida: ${r?.total_itens||0} itens deram entrada no estoque (${fmtR(r?.total_valor)})`);
    loadCompras();
    if(detalhe?.id===c.id)abrirDetalhe(c);
    setTimeout(()=>setMsg(""),5000);
  };

  const gerarTitulos=async(c:Compra)=>{
    if(c.titulos_gerados){setMsg("⚠️ Títulos já foram gerados para esta compra");return;}
    const parcelas=Number(c.parcelas)||1;
    if(!confirm(`Gerar ${parcelas} título(s) a pagar no Operacional? Valor total: ${fmtR(c.total)}`))return;
    
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('gerar_titulos_compra',{p_compra_id:c.id,p_user_id:user?.id});
    if(error){setMsg("❌ "+error.message);return;}
    setMsg(`✅ ${data} título(s) gerado(s) em Contas a Pagar`);
    loadCompras();
    setTimeout(()=>setMsg(""),4000);
  };

  const filtradas=useMemo(()=>{
    let r=compras;
    if(filtroStatus!=='todos')r=r.filter(c=>c.status===filtroStatus);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(c=>(c.numero||'').toLowerCase().includes(b)||(c.fornecedor_nome||'').toLowerCase().includes(b)||(c.fornecedor_cnpj||'').includes(b.replace(/\D/g,'')));
    }
    return r;
  },[compras,filtroStatus,busca]);

  const kpis={
    ativas:compras.filter(c=>!['cancelado','faturado'].includes(c.status)).length,
    aReceber:compras.filter(c=>!c.estoque_baixado&&!['cancelado'].includes(c.status)).length,
    aFaturar:compras.filter(c=>c.estoque_baixado&&!c.titulos_gerados&&c.status!=='cancelado').length,
    valorEmAberto:compras.filter(c=>!['cancelado','faturado'].includes(c.status)).reduce((s,c)=>s+Number(c.total||0),0),
    totalComprado30d:compras.filter(c=>{const d=new Date(c.data_pedido);return(Date.now()-d.getTime())<30*24*60*60*1000&&c.status!=='cancelado';}).reduce((s,c)=>s+Number(c.total||0),0),
  };

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🛒 Pedidos de Compra</div>
          <div style={{fontSize:11,color:TXD}}>Gestão completa do fornecedor · Recebimento automático · Geração de títulos</div>
        </div>
        <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
          {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
        </select>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Pedidos Ativos",v:String(kpis.ativas),c:B,icon:"🛒"},
          {l:"A Receber",v:String(kpis.aReceber),c:Y,icon:"📦"},
          {l:"A Faturar",v:String(kpis.aFaturar),c:P,icon:"📄"},
          {l:"Valor em Aberto",v:fmtR(kpis.valorEmAberto),c:GO,icon:"💰"},
          {l:"Comprado 30d",v:fmtR(kpis.totalComprado30d),c:T,icon:"📊"},
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
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por número, fornecedor, CNPJ..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          <button onClick={()=>setFiltroStatus("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus==="todos"?GO:BD}`,background:filtroStatus==="todos"?GO+"12":"transparent",color:filtroStatus==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroStatus==="todos"?600:400}}>Todos</button>
          {Object.entries(STATUS_CFG).map(([k,cfg])=>(
            <button key={k} onClick={()=>setFiltroStatus(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===k?cfg.cor:BD}`,background:filtroStatus===k?cfg.cor+"12":"transparent",color:filtroStatus===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroStatus===k?600:400}}>{cfg.icon} {cfg.label}</button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtradas.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>🛒</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum pedido de compra ainda</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Pedidos de compra são gerados ao aprovar uma cotação.</div>
              <a href="/dashboard/cotacoes" style={{padding:"10px 20px",borderRadius:8,background:GO+"15",color:GO,fontSize:12,fontWeight:600,border:`1px solid ${GO}40`,cursor:"pointer",textDecoration:"none",display:"inline-block"}}>📊 Ir para Cotações</a>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Fornecedor</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Pedido</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Prev. Entrega</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Total</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtradas.map(c=>{
                  const cfg=STATUS_CFG[c.status]||STATUS_CFG.aberto;
                  return(
                    <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                      <td style={{padding:"8px"}}>
                        <div style={{fontFamily:"monospace",fontWeight:600,color:GO}}>{c.numero}</div>
                        {c.cotacao_origem_id&&<div style={{fontSize:9,color:TXD}}>📊 de cotação</div>}
                      </td>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{c.fornecedor_nome}</div>
                        {c.fornecedor_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{c.fornecedor_cnpj}</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(c.data_pedido)}</td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(c.data_prevista)}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                        <div style={{display:"flex",gap:3,justifyContent:"center",marginTop:3}}>
                          {c.estoque_baixado&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:3,background:G+"20",color:G,fontWeight:600}}>📦 Estoque</span>}
                          {c.titulos_gerados&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:3,background:GO+"20",color:GO,fontWeight:600}}>💸 Títulos</span>}
                        </div>
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:R,fontWeight:600}}>{fmtR(c.total)}</td>
                      <td style={{padding:"8px",textAlign:"right"}}>
                        <button onClick={()=>abrirDetalhe(c)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>Detalhes →</button>
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
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>🛒 Pedido <span style={{color:GO,fontFamily:"monospace"}}>{detalhe.numero}</span></div>
                <div style={{fontSize:11,color:TXD}}>{detalhe.fornecedor_nome} · {detalhe.fornecedor_cnpj}</div>
              </div>
              <button onClick={()=>setDetalhe(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>PEDIDO</div><div style={{fontSize:13,fontWeight:600,color:TX}}>{fmtD(detalhe.data_pedido)}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>PREV. ENTREGA</div><div style={{fontSize:13,fontWeight:600,color:TX}}>{fmtD(detalhe.data_prevista)}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>CONDIÇÃO</div><div style={{fontSize:13,fontWeight:600,color:TX}}>{detalhe.condicao_pagamento||'—'}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TOTAL</div><div style={{fontSize:15,fontWeight:700,color:R}}>{fmtR(detalhe.total)}</div></div>
            </div>

            {/* Itens */}
            <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:6}}>📦 Itens</div>
            <div style={{background:BG3,borderRadius:10,overflow:"hidden",marginBottom:16}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                  <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Produto</th>
                  <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Qtd</th>
                  <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Recebida</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Preço</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:110}}>Subtotal</th>
                </tr></thead>
                <tbody>
                  {itens.map(it=>(
                    <tr key={it.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                      <td style={{padding:"6px 8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{it.produto_nome}</div>
                        {it.produto_codigo&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{it.produto_codigo}</div>}
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center",color:TXM}}>{Number(it.quantidade).toLocaleString("pt-BR")} {it.unidade}</td>
                      <td style={{padding:"6px 8px",textAlign:"center",color:Number(it.quantidade_recebida)>=Number(it.quantidade)?G:Y,fontWeight:600}}>{Number(it.quantidade_recebida||0).toLocaleString("pt-BR")}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:TXM}}>{fmtR(it.preco_unitario)}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:R}}>{fmtR(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ações */}
            <div style={{background:BG3,borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:10}}>🔄 Atualizar Status</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(STATUS_CFG).filter(([k])=>k!==detalhe.status).map(([k,cfg])=>(
                  <button key={k} onClick={()=>mudarStatus(detalhe,k)} style={{padding:"6px 12px",borderRadius:6,fontSize:10,background:cfg.cor+"12",color:cfg.cor,border:`1px solid ${cfg.cor}30`,cursor:"pointer",fontWeight:600}}>{cfg.icon} {cfg.label}</button>
                ))}
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {!detalhe.estoque_baixado?(
                <button onClick={()=>receberCompra(detalhe)} style={{padding:"12px",borderRadius:10,background:G+"15",color:G,border:`1px solid ${G}40`,cursor:"pointer",fontSize:12,fontWeight:600}}>📦 Receber + Entrada Estoque</button>
              ):(
                <div style={{padding:"12px",borderRadius:10,background:G+"15",color:G,textAlign:"center",fontSize:11,fontWeight:600}}>✅ Estoque já atualizado</div>
              )}
              
              {!detalhe.titulos_gerados?(
                <button onClick={()=>gerarTitulos(detalhe)} style={{padding:"12px",borderRadius:10,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontSize:12,fontWeight:600}}>💸 Gerar Contas a Pagar</button>
              ):(
                <div style={{padding:"12px",borderRadius:10,background:GO+"15",color:GO,textAlign:"center",fontSize:11,fontWeight:600}}>✅ Títulos gerados</div>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Compras v1.0 · Sprint 3.1</div>
    </div>
  );
}
