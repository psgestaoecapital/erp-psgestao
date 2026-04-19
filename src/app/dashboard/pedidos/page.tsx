"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Pedido = {
  id:string; company_id:string; numero:string; orcamento_origem_id:string;
  cliente_id:string; cliente_nome:string; cliente_cnpj:string; cliente_email:string; cliente_telefone:string;
  endereco_entrega:string;
  data_pedido:string; data_prevista_entrega:string; data_entrega:string; data_faturamento:string;
  status:string;
  vendedor_nome:string; comissao_percentual:number; comissao_valor:number;
  condicao_pagamento:string; forma_pagamento:string; parcelas:number; primeiro_vencimento:string;
  prazo_entrega_dias:number; frete_tipo:string; frete_valor:number; transportadora:string;
  subtotal:number; desconto_percentual:number; desconto_valor:number; acrescimo_valor:number; total:number; total_pago:number;
  observacoes:string; observacoes_internas:string;
  nf_numero:string; nf_emitida:boolean; titulos_gerados:boolean;
  hash_publico:string;
  created_at:string;
};

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}> = {
  aberto:      {cor:B, icon:"📋", label:"Aberto"},
  producao:    {cor:P, icon:"🔨", label:"Em Produção"},
  separacao:   {cor:T, icon:"📦", label:"Separação"},
  despachado:  {cor:Y, icon:"🚚", label:"Despachado"},
  entregue:    {cor:G, icon:"✅", label:"Entregue"},
  faturado:    {cor:GO,icon:"📄", label:"Faturado"},
  concluido:   {cor:G, icon:"🎯", label:"Concluído"},
  cancelado:   {cor:R, icon:"❌", label:"Cancelado"},
};

const CONDS = ['À vista','7 dias','14 dias','21 dias','30 dias','30/60 dias','30/60/90 dias','45 dias','60 dias','90 dias'];
const FORMAS = ['PIX','Boleto','Transferência','Cartão Crédito','Cartão Débito','Dinheiro','Cheque','Múltiplas'];

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';

export default function PedidosPage(){
  const [pedidos,setPedidos]=useState<Pedido[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [orcamentosAprovados,setOrcamentosAprovados]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroStatus,setFiltroStatus]=useState("todos");
  const [msg,setMsg]=useState("");
  const [showConverter,setShowConverter]=useState(false);
  const [showDetalhes,setShowDetalhes]=useState<Pedido|null>(null);
  const [itensDetalhe,setItensDetalhe]=useState<any[]>([]);
  const [showGerarTitulos,setShowGerarTitulos]=useState<Pedido|null>(null);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadPedidos();loadOrcamentosAprovados();}},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadPedidos=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_pedidos").select("*").eq("company_id",sel).order("data_pedido",{ascending:false}).limit(200);
    if(data)setPedidos(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const loadOrcamentosAprovados=async()=>{
    const{data}=await supabase.from("erp_orcamentos").select("*").eq("company_id",sel).eq("status","aprovado").order("data_aprovacao",{ascending:false}).limit(50);
    if(data)setOrcamentosAprovados(data);
  };

  const converterOrcamento=async(orcId:string)=>{
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('converter_orcamento_pedido',{p_orcamento_id:orcId,p_user_id:user?.id});
    if(error){setMsg("❌ "+error.message);return;}
    setMsg("✅ Orçamento convertido em pedido!");
    setShowConverter(false);
    loadPedidos();loadOrcamentosAprovados();
    setTimeout(()=>setMsg(""),3000);
  };

  const mudarStatus=async(ped:Pedido,novoStatus:string)=>{
    const update:any={status:novoStatus};
    if(novoStatus==='entregue')update.data_entrega=new Date().toISOString().slice(0,10);
    if(novoStatus==='faturado')update.data_faturamento=new Date().toISOString().slice(0,10);
    await supabase.from("erp_pedidos").update(update).eq("id",ped.id);
    setMsg(`✅ Status alterado para ${STATUS_CFG[novoStatus]?.label}`);
    loadPedidos();
    setTimeout(()=>setMsg(""),3000);
  };

  const abrirDetalhes=async(p:Pedido)=>{
    setShowDetalhes(p);
    const{data}=await supabase.from("erp_pedidos_itens").select("*").eq("pedido_id",p.id).order("ordem");
    setItensDetalhe(data||[]);
  };

  const gerarTitulosReceber=async(p:Pedido)=>{
    if(p.titulos_gerados){setMsg("⚠️ Títulos já foram gerados para este pedido");return;}
    const parcelas=Number(p.parcelas)||1;
    const total=Number(p.total);
    const valorParcela=Math.round((total/parcelas)*100)/100;
    const primeiroVenc=p.primeiro_vencimento?new Date(p.primeiro_vencimento+'T00:00:00'):new Date();
    
    const lancamentos=[];
    for(let i=0;i<parcelas;i++){
      const dataVenc=new Date(primeiroVenc);
      dataVenc.setMonth(dataVenc.getMonth()+i);
      // Ajuste pra última parcela cobrir arredondamento
      const valorFinal=i===parcelas-1?Math.round((total-(valorParcela*(parcelas-1)))*100)/100:valorParcela;
      
      lancamentos.push({
        company_id:sel,
        tipo:'receita',
        descricao:`Pedido ${p.numero} - ${p.cliente_nome}${parcelas>1?` (${i+1}/${parcelas})`:''}`,
        valor:valorFinal,
        data_vencimento:dataVenc.toISOString().slice(0,10),
        data_emissao:new Date().toISOString().slice(0,10),
        cliente_nome:p.cliente_nome,
        cliente_cnpj:p.cliente_cnpj,
        status:'pendente',
        origem:'pedido',
        ref_tipo:'pedido',
        ref_id:p.id,
        observacoes:`Gerado automaticamente do pedido ${p.numero}`,
      });
    }
    
    const{error}=await supabase.from("erp_lancamentos").insert(lancamentos);
    if(error){setMsg("❌ "+error.message);return;}
    
    await supabase.from("erp_pedidos").update({titulos_gerados:true}).eq("id",p.id);
    setMsg(`✅ ${parcelas} título(s) gerado(s) no Operacional - Contas a Receber`);
    setShowGerarTitulos(null);
    loadPedidos();
    setTimeout(()=>setMsg(""),4000);
  };

  const filtrados=useMemo(()=>{
    let r=pedidos;
    if(filtroStatus!=="todos")r=r.filter(p=>p.status===filtroStatus);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(p=>(p.numero||'').toLowerCase().includes(b)||(p.cliente_nome||'').toLowerCase().includes(b)||(p.cliente_cnpj||'').includes(b.replace(/\D/g,'')));
    }
    return r;
  },[pedidos,filtroStatus,busca]);

  const kpiTotal=pedidos.filter(p=>!['cancelado','concluido'].includes(p.status)).length;
  const kpiProducao=pedidos.filter(p=>['producao','separacao'].includes(p.status)).length;
  const kpiEntrega=pedidos.filter(p=>['despachado','entregue'].includes(p.status)).length;
  const kpiValorAberto=pedidos.filter(p=>!['cancelado','concluido'].includes(p.status)).reduce((s,p)=>s+Number(p.total||0),0);
  const kpiFaturado30d=pedidos.filter(p=>{if(!p.data_faturamento)return false;const d=new Date(p.data_faturamento);return(Date.now()-d.getTime())<30*24*60*60*1000;}).reduce((s,p)=>s+Number(p.total||0),0);

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🎯 Pedidos de Venda</div>
          <div style={{fontSize:11,color:TXD}}>Gestão completa: do pedido à entrega e faturamento</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          {orcamentosAprovados.length>0&&(
            <button onClick={()=>setShowConverter(true)} style={{padding:"8px 16px",borderRadius:8,background:G+"15",color:G,fontSize:12,fontWeight:600,border:`1px solid ${G}40`,cursor:"pointer"}}>✅ Converter Orçamento ({orcamentosAprovados.length})</button>
          )}
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Pedidos Ativos",v:String(kpiTotal),c:B,icon:"🎯"},
          {l:"Em Produção",v:String(kpiProducao),c:P,icon:"🔨"},
          {l:"Em Entrega",v:String(kpiEntrega),c:Y,icon:"🚚"},
          {l:"Valor em Aberto",v:fmtR(kpiValorAberto),c:GO,icon:"💰"},
          {l:"Faturado 30d",v:fmtR(kpiFaturado30d),c:G,icon:"📊"},
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
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por número, cliente, CNPJ..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          <button onClick={()=>setFiltroStatus("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus==="todos"?GO:BD}`,background:filtroStatus==="todos"?GO+"12":"transparent",color:filtroStatus==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroStatus==="todos"?600:400}}>Todos</button>
          {Object.entries(STATUS_CFG).map(([k,cfg])=>(
            <button key={k} onClick={()=>setFiltroStatus(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===k?cfg.cor:BD}`,background:filtroStatus===k?cfg.cor+"12":"transparent",color:filtroStatus===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroStatus===k?600:400}}>{cfg.icon} {cfg.label}</button>
          ))}
        </div>
      </div>

      {/* Modal: converter orçamento */}
      {showConverter&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowConverter(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:800,width:"100%",maxHeight:"85vh",overflowY:"auto",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>✅ Converter Orçamento Aprovado em Pedido</div>
                <div style={{fontSize:11,color:TXD}}>Todos os itens, condições e valores serão copiados automaticamente</div>
              </div>
              <button onClick={()=>setShowConverter(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            {orcamentosAprovados.length===0?(
              <div style={{padding:30,textAlign:"center",color:TXD}}>Nenhum orçamento aprovado pendente de conversão.</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {orcamentosAprovados.map(o=>(
                  <div key={o.id} style={{background:BG3,borderRadius:10,padding:14,border:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,color:TX}}>
                        <span style={{color:GO,fontFamily:"monospace"}}>{o.numero}</span> · {o.cliente_nome}
                      </div>
                      <div style={{fontSize:10,color:TXD,marginTop:3}}>
                        Emissão: {fmtD(o.data_emissao)} · Aprovado: {fmtD(o.data_aprovacao?.slice(0,10))}
                      </div>
                      <div style={{fontSize:14,fontWeight:700,color:G,marginTop:4}}>{fmtR(o.total)}</div>
                    </div>
                    <button onClick={()=>converterOrcamento(o.id)} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>→ Criar Pedido</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Detalhes do Pedido */}
      {showDetalhes&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowDetalhes(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>Pedido <span style={{color:GO,fontFamily:"monospace"}}>{showDetalhes.numero}</span></div>
                <div style={{fontSize:11,color:TXD}}>{showDetalhes.cliente_nome}</div>
              </div>
              <button onClick={()=>setShowDetalhes(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {/* Info cards */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>EMISSÃO</div><div style={{fontSize:13,fontWeight:600,color:TX}}>{fmtD(showDetalhes.data_pedido)}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>ENTREGA PREV.</div><div style={{fontSize:13,fontWeight:600,color:TX}}>{fmtD(showDetalhes.data_prevista_entrega)}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>CONDIÇÃO</div><div style={{fontSize:13,fontWeight:600,color:TX}}>{showDetalhes.condicao_pagamento||'—'}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TOTAL</div><div style={{fontSize:15,fontWeight:700,color:G}}>{fmtR(showDetalhes.total)}</div></div>
            </div>

            {/* Itens */}
            <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:6}}>📦 Itens</div>
            <div style={{background:BG3,borderRadius:10,overflow:"hidden",marginBottom:16}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                  <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Produto</th>
                  <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Qtd</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Preço</th>
                  <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:110}}>Subtotal</th>
                </tr></thead>
                <tbody>
                  {itensDetalhe.map(it=>(
                    <tr key={it.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                      <td style={{padding:"6px 8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{it.produto_nome}</div>
                        {it.produto_codigo&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{it.produto_codigo}</div>}
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center",color:TXM}}>{Number(it.quantidade).toLocaleString("pt-BR")} {it.unidade}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",color:TXM}}>{fmtR(it.preco_unitario)}</td>
                      <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:G}}>{fmtR(it.subtotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ações */}
            <div style={{background:BG3,borderRadius:10,padding:14,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:10}}>🔄 Atualizar Status</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {Object.entries(STATUS_CFG).filter(([k])=>k!==showDetalhes.status).map(([k,cfg])=>(
                  <button key={k} onClick={()=>{mudarStatus(showDetalhes,k);setShowDetalhes(null);}} style={{padding:"6px 12px",borderRadius:6,fontSize:10,background:cfg.cor+"12",color:cfg.cor,border:`1px solid ${cfg.cor}30`,cursor:"pointer",fontWeight:600}}>{cfg.icon} {cfg.label}</button>
                ))}
              </div>
            </div>

            {!showDetalhes.titulos_gerados&&(
              <button onClick={()=>setShowGerarTitulos(showDetalhes)} style={{width:"100%",padding:"12px",borderRadius:10,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontSize:13,fontWeight:600}}>
                💸 Gerar Contas a Receber no Operacional
              </button>
            )}
            {showDetalhes.titulos_gerados&&(
              <div style={{padding:"10px",borderRadius:8,background:G+"15",color:G,textAlign:"center",fontSize:11,fontWeight:600}}>✅ Títulos já foram gerados no Operacional</div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Confirmar geração de títulos */}
      {showGerarTitulos&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:110,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowGerarTitulos(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:GO,marginBottom:8}}>💸 Gerar Contas a Receber</div>
            <div style={{fontSize:13,color:TXM,marginBottom:16}}>Serão criados <b style={{color:TX}}>{showGerarTitulos.parcelas||1} título(s)</b> no Operacional (Contas a Receber) no valor total de <b style={{color:G}}>{fmtR(showGerarTitulos.total)}</b>.</div>
            <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:16,fontSize:11,color:TXM}}>
              <div>Cliente: <b style={{color:TX}}>{showGerarTitulos.cliente_nome}</b></div>
              <div>Condição: <b style={{color:TX}}>{showGerarTitulos.condicao_pagamento||'—'}</b></div>
              <div>Parcelas: <b style={{color:TX}}>{showGerarTitulos.parcelas||1}x de {fmtR(Number(showGerarTitulos.total)/(Number(showGerarTitulos.parcelas)||1))}</b></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowGerarTitulos(null)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={()=>gerarTitulosReceber(showGerarTitulos)} style={{padding:"10px 24px",borderRadius:8,background:GO,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>Gerar Títulos</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>🎯</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum pedido ainda</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Aprove orçamentos e converta em pedidos automaticamente.</div>
              {orcamentosAprovados.length>0&&<button onClick={()=>setShowConverter(true)} style={{padding:"10px 20px",borderRadius:8,background:G+"15",color:G,fontSize:12,fontWeight:600,border:`1px solid ${G}40`,cursor:"pointer"}}>✅ Converter {orcamentosAprovados.length} Orçamento(s)</button>}
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Emissão</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Entrega Prev.</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Total</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtrados.map(p=>{
                  const cfg=STATUS_CFG[p.status]||STATUS_CFG.aberto;
                  return(
                    <tr key={p.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                      <td style={{padding:"8px"}}>
                        <div style={{fontFamily:"monospace",fontWeight:600,color:GO}}>{p.numero}</div>
                        {p.orcamento_origem_id&&<div style={{fontSize:9,color:TXD}}>📋 de orçamento</div>}
                      </td>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{p.cliente_nome}</div>
                        {p.cliente_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{p.cliente_cnpj}</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(p.data_pedido)}</td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(p.data_prevista_entrega)}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                        {p.titulos_gerados&&<div style={{fontSize:8,color:G,marginTop:2,fontWeight:600}}>💸 Títulos ✓</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:G,fontWeight:600}}>{fmtR(p.total)}</td>
                      <td style={{padding:"8px",textAlign:"right"}}>
                        <button onClick={()=>abrirDetalhes(p)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>Detalhes →</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Pedidos v1.0 · Conversão automática de orçamentos · Geração de títulos em lote</div>
    </div>
  );
}
