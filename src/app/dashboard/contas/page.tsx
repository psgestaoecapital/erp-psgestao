"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Lancamento = {
  id:string; company_id:string;
  tipo:string; descricao:string; valor:number;
  data_emissao:string; data_vencimento:string; data_pagamento:string;
  status:string;
  cliente_nome:string; cliente_cnpj:string;
  fornecedor_nome:string; fornecedor_cnpj:string;
  forma_pagamento:string; banco_conta_id:string;
  categoria:string; centro_custo:string; origem:string;
  observacoes:string;
};

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}>={
  pendente:  {cor:Y, icon:"⏳", label:"Pendente"},
  aberto:    {cor:Y, icon:"⏳", label:"Em Aberto"},
  pago:      {cor:G, icon:"✅", label:"Pago"},
  atrasado:  {cor:R, icon:"⚠️", label:"Atrasado"},
  cancelado: {cor:TXD,icon:"🚫",label:"Cancelado"},
};

const FORMAS=['PIX','Boleto','Transferência','Cartão Crédito','Cartão Débito','Dinheiro','Cheque'];

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';
const hoje=()=>new Date().toISOString().slice(0,10);
const diffDias=(v:string)=>{if(!v)return 0;const d=new Date(v+'T00:00:00');return Math.floor((Date.now()-d.getTime())/(1000*60*60*24));};

export default function ContasPage(){
  const [lancs,setLancs]=useState<Lancamento[]>([]);
  const [contas,setContas]=useState<any[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroTipo,setFiltroTipo]=useState<string>("todos");
  const [filtroStatus,setFiltroStatus]=useState<string>("pendentes");
  const [filtroPeriodo,setFiltroPeriodo]=useState<string>("mes");
  const [dataIni,setDataIni]=useState("");
  const [dataFim,setDataFim]=useState("");
  const [selecionados,setSelecionados]=useState<Set<string>>(new Set());
  const [msg,setMsg]=useState("");
  const [showBaixar,setShowBaixar]=useState(false);
  const [showCancelar,setShowCancelar]=useState(false);
  const [showRenegociar,setShowRenegociar]=useState(false);
  const [baixa,setBaixa]=useState({data_pagamento:hoje(),banco_conta_id:'',forma_pagamento:'PIX'});
  const [motivoCancelar,setMotivoCancelar]=useState("");
  const [diasRenegociar,setDiasRenegociar]=useState(30);
  const [processando,setProcessando]=useState(false);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadLancs();loadContas();}},[sel,filtroPeriodo,dataIni,dataFim]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadContas=async()=>{
    const{data}=await supabase.from("erp_banco_contas").select("*").eq("company_id",sel).eq("ativo",true);
    if(data)setContas(data);
  };

  const loadLancs=async()=>{
    setLoading(true);
    setSelecionados(new Set());
    
    let iniFilter=dataIni, fimFilter=dataFim;
    if(!iniFilter||!fimFilter){
      const h=new Date();
      if(filtroPeriodo==='hoje'){iniFilter=fimFilter=hoje();}
      else if(filtroPeriodo==='semana'){const d1=new Date(h);d1.setDate(d1.getDate()-7);iniFilter=d1.toISOString().slice(0,10);fimFilter=hoje();}
      else if(filtroPeriodo==='mes'){iniFilter=new Date(h.getFullYear(),h.getMonth(),1).toISOString().slice(0,10);fimFilter=new Date(h.getFullYear(),h.getMonth()+1,0).toISOString().slice(0,10);}
      else if(filtroPeriodo==='proximos30'){iniFilter=hoje();const d=new Date(h);d.setDate(d.getDate()+30);fimFilter=d.toISOString().slice(0,10);}
      else if(filtroPeriodo==='atrasados'){fimFilter=hoje();iniFilter='2020-01-01';}
      else if(filtroPeriodo==='todos'){iniFilter='2020-01-01';fimFilter='2030-12-31';}
    }
    
    let q=supabase.from("erp_lancamentos").select("*").eq("company_id",sel).gte("data_vencimento",iniFilter).lte("data_vencimento",fimFilter);
    const{data,error}=await q.order("data_vencimento",{ascending:true}).limit(500);
    if(data)setLancs(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const toggleSelecao=(id:string)=>{
    const novo=new Set(selecionados);
    if(novo.has(id))novo.delete(id);else novo.add(id);
    setSelecionados(novo);
  };

  const selecionarTodos=()=>{
    if(selecionados.size===filtrados.length)setSelecionados(new Set());
    else setSelecionados(new Set(filtrados.map(l=>l.id)));
  };

  const baixarLote=async()=>{
    if(selecionados.size===0)return;
    setProcessando(true);
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('batch_baixa_titulos',{
      p_lancamento_ids:Array.from(selecionados),
      p_data_pagamento:baixa.data_pagamento,
      p_banco_conta_id:baixa.banco_conta_id||null,
      p_forma_pagamento:baixa.forma_pagamento,
      p_usuario_id:user?.id,
    });
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    const r=data?.[0];
    setMsg(`✅ ${r?.mensagem||'Baixa realizada'}`);
    setShowBaixar(false);
    setSelecionados(new Set());
    setProcessando(false);
    loadLancs();
    setTimeout(()=>setMsg(""),4000);
  };

  const cancelarLote=async()=>{
    if(selecionados.size===0)return;
    setProcessando(true);
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('batch_cancelar_titulos',{
      p_lancamento_ids:Array.from(selecionados),
      p_motivo:motivoCancelar||'Cancelamento em lote',
      p_usuario_id:user?.id,
    });
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    const r=data?.[0];
    setMsg(`✅ ${r?.mensagem||'Cancelamento realizado'}`);
    setShowCancelar(false);
    setSelecionados(new Set());
    setProcessando(false);
    setMotivoCancelar("");
    loadLancs();
    setTimeout(()=>setMsg(""),3000);
  };

  const renegociarLote=async()=>{
    if(selecionados.size===0)return;
    setProcessando(true);
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('batch_alterar_vencimento',{
      p_lancamento_ids:Array.from(selecionados),
      p_dias_adicionar:diasRenegociar,
      p_usuario_id:user?.id,
    });
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    const r=data?.[0];
    setMsg(`✅ ${r?.mensagem||'Renegociação realizada'}`);
    setShowRenegociar(false);
    setSelecionados(new Set());
    setProcessando(false);
    loadLancs();
    setTimeout(()=>setMsg(""),3000);
  };

  const exportarCSV=()=>{
    const sel=filtrados.filter(l=>selecionados.has(l.id));
    if(sel.length===0){setMsg("⚠️ Selecione pelo menos 1 título");return;}
    const header="Tipo;Descrição;Valor;Vencimento;Pagamento;Status;Cliente/Fornecedor;CNPJ";
    const rows=sel.map(l=>[
      l.tipo==='receita'?'Receber':'Pagar',
      (l.descricao||'').replace(/;/g,','),
      Number(l.valor).toFixed(2).replace('.',','),
      fmtD(l.data_vencimento),
      fmtD(l.data_pagamento)||'',
      l.status,
      l.cliente_nome||l.fornecedor_nome||'',
      l.cliente_cnpj||l.fornecedor_cnpj||'',
    ].join(';'));
    const csv=[header,...rows].join('\n');
    const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`titulos_${hoje()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setMsg(`✅ ${sel.length} títulos exportados`);
    setTimeout(()=>setMsg(""),3000);
  };

  // Filtros
  const filtrados=useMemo(()=>{
    let r=lancs;
    if(filtroTipo==='pagar')r=r.filter(l=>l.tipo==='despesa'||l.tipo==='saida'||l.tipo==='pagar');
    else if(filtroTipo==='receber')r=r.filter(l=>l.tipo==='receita'||l.tipo==='entrada'||l.tipo==='receber');
    
    if(filtroStatus==='pendentes')r=r.filter(l=>['pendente','aberto','atrasado'].includes(l.status));
    else if(filtroStatus==='pagos')r=r.filter(l=>l.status==='pago');
    else if(filtroStatus==='atrasados')r=r.filter(l=>['pendente','aberto','atrasado'].includes(l.status)&&l.data_vencimento<hoje());
    else if(filtroStatus==='cancelados')r=r.filter(l=>l.status==='cancelado');
    
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(l=>(l.descricao||'').toLowerCase().includes(b)||(l.cliente_nome||'').toLowerCase().includes(b)||(l.fornecedor_nome||'').toLowerCase().includes(b)||String(l.valor).includes(b));
    }
    return r;
  },[lancs,filtroTipo,filtroStatus,busca]);

  const selLancs=filtrados.filter(l=>selecionados.has(l.id));
  const valorSelecionado=selLancs.reduce((s,l)=>s+Number(l.valor),0);

  const kpis={
    total: filtrados.length,
    aReceber: filtrados.filter(l=>(l.tipo==='receita'||l.tipo==='entrada'||l.tipo==='receber')&&['pendente','aberto'].includes(l.status)).reduce((s,l)=>s+Number(l.valor),0),
    aPagar: filtrados.filter(l=>(l.tipo==='despesa'||l.tipo==='saida'||l.tipo==='pagar')&&['pendente','aberto'].includes(l.status)).reduce((s,l)=>s+Number(l.valor),0),
    atrasados: filtrados.filter(l=>['pendente','aberto'].includes(l.status)&&l.data_vencimento<hoje()).reduce((s,l)=>s+Number(l.valor),0),
    saldoLiquido: filtrados.filter(l=>l.status==='pago').reduce((s,l)=>s+(l.tipo==='receita'||l.tipo==='entrada'||l.tipo==='receber'?Number(l.valor):-Number(l.valor)),0),
  };

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>💳 Contas a Pagar & Receber</div>
          <div style={{fontSize:11,color:TXD}}>Gestão em lote · Baixa rápida · Exportação · Renegociação</div>
        </div>
        <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
          {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
        </select>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Títulos",v:String(kpis.total),c:B,icon:"📋"},
          {l:"A Receber",v:fmtR(kpis.aReceber),c:G,icon:"💰"},
          {l:"A Pagar",v:fmtR(kpis.aPagar),c:R,icon:"💸"},
          {l:"Atrasados",v:fmtR(kpis.atrasados),c:kpis.atrasados>0?R:G,icon:kpis.atrasados>0?"⚠️":"✅"},
          {l:"Saldo Líquido",v:fmtR(kpis.saldoLiquido),c:kpis.saldoLiquido>=0?G:R,icon:"📊"},
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
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por descrição, cliente, fornecedor, valor..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        
        <div style={{display:"flex",gap:4}}>
          {[{v:"todos",l:"Todos"},{v:"pagar",l:"💸 A Pagar"},{v:"receber",l:"💰 A Receber"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroTipo(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroTipo===f.v?GO:BD}`,background:filtroTipo===f.v?GO+"12":"transparent",color:filtroTipo===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroTipo===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        
        <div style={{display:"flex",gap:4}}>
          {[{v:"pendentes",l:"⏳ Pendentes"},{v:"pagos",l:"✅ Pagos"},{v:"atrasados",l:"⚠️ Atrasados"},{v:"cancelados",l:"🚫 Cancelados"},{v:"todos",l:"Todos"}].map(f=>(
            <button key={f.v} onClick={()=>setFiltroStatus(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===f.v?GO:BD}`,background:filtroStatus===f.v?GO+"12":"transparent",color:filtroStatus===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroStatus===f.v?600:400}}>{f.l}</button>
          ))}
        </div>

        <select value={filtroPeriodo} onChange={e=>setFiltroPeriodo(e.target.value)} style={{...inp,width:"auto",cursor:"pointer"}}>
          <option value="hoje">Hoje</option>
          <option value="semana">Últimos 7d</option>
          <option value="mes">Este mês</option>
          <option value="proximos30">Próximos 30d</option>
          <option value="atrasados">Todos atrasados</option>
          <option value="todos">Todo período</option>
        </select>
      </div>

      {/* Barra de ações em lote */}
      {selecionados.size>0&&(
        <div style={{background:GO+"15",borderRadius:10,padding:"12px 16px",marginBottom:12,border:`1px solid ${GO}40`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div>
            <span style={{fontSize:13,fontWeight:700,color:GO}}>✓ {selecionados.size} título{selecionados.size>1?'s':''} selecionado{selecionados.size>1?'s':''}</span>
            <span style={{fontSize:11,color:TXM,marginLeft:12}}>Valor total: <b style={{color:GO}}>{fmtR(valorSelecionado)}</b></span>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={()=>setShowBaixar(true)} style={{padding:"8px 14px",borderRadius:8,background:G,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>✅ Baixar em Lote</button>
            <button onClick={()=>setShowRenegociar(true)} style={{padding:"8px 14px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>📅 Renegociar</button>
            <button onClick={()=>setShowCancelar(true)} style={{padding:"8px 14px",borderRadius:8,background:R+"15",color:R,fontSize:12,fontWeight:600,border:`1px solid ${R}40`,cursor:"pointer"}}>🚫 Cancelar</button>
            <button onClick={exportarCSV} style={{padding:"8px 14px",borderRadius:8,background:P+"15",color:P,fontSize:12,fontWeight:600,border:`1px solid ${P}40`,cursor:"pointer"}}>📥 Exportar CSV</button>
            <button onClick={()=>setSelecionados(new Set())} style={{padding:"8px 14px",borderRadius:8,background:"transparent",color:TXM,fontSize:11,border:`1px solid ${BD}`,cursor:"pointer"}}>Limpar</button>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>💳</div>
              <div style={{fontSize:14,fontWeight:600,color:TX}}>Nenhum título encontrado no período</div>
              <div style={{fontSize:11,color:TXD}}>Ajuste os filtros acima.</div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"center",width:30}}>
                  <input type="checkbox" checked={selecionados.size===filtrados.length&&filtrados.length>0} onChange={selecionarTodos} style={{cursor:"pointer",width:14,height:14}}/>
                </th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:40}}>Tipo</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Descrição</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente/Fornecedor</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Vencimento</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Valor</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
              </tr></thead>
              <tbody>
                {filtrados.map(l=>{
                  const atrasado=['pendente','aberto'].includes(l.status)&&l.data_vencimento<hoje();
                  const cfg=STATUS_CFG[atrasado?'atrasado':l.status]||STATUS_CFG.pendente;
                  const isReceita=l.tipo==='receita'||l.tipo==='entrada'||l.tipo==='receber';
                  const dias=atrasado?diffDias(l.data_vencimento):0;
                  return(
                    <tr key={l.id} style={{borderBottom:`0.5px solid ${BD}`,background:selecionados.has(l.id)?GO+"08":"transparent"}}>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <input type="checkbox" checked={selecionados.has(l.id)} onChange={()=>toggleSelecao(l.id)} style={{cursor:"pointer",width:14,height:14}}/>
                      </td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:12}} title={isReceita?"A Receber":"A Pagar"}>{isReceita?"💰":"💸"}</span>
                      </td>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX,fontSize:11}}>{l.descricao}</div>
                        {l.categoria&&<div style={{fontSize:9,color:TXD}}>{l.categoria}</div>}
                      </td>
                      <td style={{padding:"8px",color:TXM,fontSize:10}}>{l.cliente_nome||l.fornecedor_nome||"—"}</td>
                      <td style={{padding:"8px",textAlign:"center",fontSize:10,color:atrasado?R:TXM,fontWeight:atrasado?600:400}}>
                        {fmtD(l.data_vencimento)}
                        {atrasado&&<div style={{fontSize:9,color:R,fontWeight:600}}>-{dias}d</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:isReceita?G:R,fontWeight:600}}>{fmtR(l.valor)}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal Baixar em Lote */}
      {showBaixar&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>!processando&&setShowBaixar(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:G,marginBottom:8}}>✅ Baixar {selecionados.size} título{selecionados.size>1?'s':''}</div>
            <div style={{fontSize:13,color:TXM,marginBottom:16}}>Valor total: <b style={{color:G,fontSize:18}}>{fmtR(valorSelecionado)}</b></div>
            
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Data do Pagamento *</div>
                <input type="date" value={baixa.data_pagamento} onChange={e=>setBaixa({...baixa,data_pagamento:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Forma de Pagamento</div>
                <select value={baixa.forma_pagamento} onChange={e=>setBaixa({...baixa,forma_pagamento:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  {FORMAS.map(f=><option key={f} value={f}>{f}</option>)}
                </select></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Conta Bancária (atualiza saldo automaticamente)</div>
                <select value={baixa.banco_conta_id} onChange={e=>setBaixa({...baixa,banco_conta_id:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="">— Não movimentar conta —</option>
                  {contas.map(c=><option key={c.id} value={c.id}>{c.nome} ({c.banco})</option>)}
                </select></div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowBaixar(false)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={baixarLote} disabled={processando} style={{padding:"10px 24px",borderRadius:8,background:G,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:processando?"wait":"pointer"}}>{processando?"Processando...":"✅ Confirmar Baixa"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Cancelar */}
      {showCancelar&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>!processando&&setShowCancelar(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:R,marginBottom:8}}>🚫 Cancelar {selecionados.size} título{selecionados.size>1?'s':''}</div>
            <div style={{fontSize:12,color:TXM,marginBottom:16}}>Esta ação não pode ser desfeita. Valor total: <b style={{color:R}}>{fmtR(valorSelecionado)}</b></div>
            
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Motivo (opcional)</div>
              <textarea value={motivoCancelar} onChange={e=>setMotivoCancelar(e.target.value)} rows={3} placeholder="Ex: Cancelamento negociado com cliente, duplicata, etc." style={{...inp,resize:"vertical"}}/>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowCancelar(false)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Voltar</button>
              <button onClick={cancelarLote} disabled={processando} style={{padding:"10px 24px",borderRadius:8,background:R,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:processando?"wait":"pointer"}}>{processando?"Processando...":"🚫 Confirmar Cancelamento"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Renegociar */}
      {showRenegociar&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>!processando&&setShowRenegociar(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:B,marginBottom:8}}>📅 Renegociar {selecionados.size} título{selecionados.size>1?'s':''}</div>
            <div style={{fontSize:12,color:TXM,marginBottom:16}}>Alterar vencimento de todos os selecionados de uma vez.</div>
            
            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Adicionar dias ao vencimento atual</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
                {[7,15,30,60,90].map(d=>(
                  <button key={d} onClick={()=>setDiasRenegociar(d)} style={{padding:"6px 14px",borderRadius:6,fontSize:11,border:`1px solid ${diasRenegociar===d?B:BD}`,background:diasRenegociar===d?B+"15":"transparent",color:diasRenegociar===d?B:TXM,cursor:"pointer",fontWeight:diasRenegociar===d?600:400}}>+{d} dias</button>
                ))}
              </div>
              <input type="number" value={diasRenegociar} onChange={e=>setDiasRenegociar(parseInt(e.target.value)||0)} style={inp}/>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowRenegociar(false)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={renegociarLote} disabled={processando} style={{padding:"10px 24px",borderRadius:8,background:B,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:processando?"wait":"pointer"}}>{processando?"Processando...":"📅 Renegociar"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Contas v1.0 · Baixa em Lote · Sprint 1.4</div>
    </div>
  );
}
