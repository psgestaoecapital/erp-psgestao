"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Cotacao={
  id:string;company_id:string;numero:string;descricao:string;
  data_abertura:string;data_limite:string;data_fechamento:string;
  status:string;fornecedor_vencedor_id:string;compra_gerada_id:string;
  solicitante:string;observacoes:string;created_at:string;
};

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}>={
  aberta:                 {cor:B, icon:"📋", label:"Aberta"},
  aguardando_respostas:   {cor:Y, icon:"⏳", label:"Aguardando"},
  em_analise:             {cor:P, icon:"🔍", label:"Em Análise"},
  aprovada:               {cor:G, icon:"✅", label:"Aprovada"},
  recusada:               {cor:R, icon:"❌", label:"Recusada"},
  cancelada:              {cor:TXD,icon:"🚫",label:"Cancelada"},
};

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtQ=(v:any)=>(Number(v)||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';
const hoje=()=>new Date().toISOString().slice(0,10);

export default function CotacoesPage(){
  const [cotacoes,setCotacoes]=useState<Cotacao[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [produtos,setProdutos]=useState<any[]>([]);
  const [fornecedores,setFornecedores]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroStatus,setFiltroStatus]=useState("todos");
  const [msg,setMsg]=useState("");
  
  const [showNova,setShowNova]=useState(false);
  const [novaCot,setNovaCot]=useState<any>({descricao:'',data_limite:'',itens:[],fornecedores:[]});
  const [showComparar,setShowComparar]=useState<Cotacao|null>(null);
  const [dadosComparar,setDadosComparar]=useState<any>(null);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadCotacoes();loadProdutos();loadFornecedores();}},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadCotacoes=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_cotacoes").select("*").eq("company_id",sel).order("data_abertura",{ascending:false}).limit(100);
    if(data)setCotacoes(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const loadProdutos=async()=>{
    const{data}=await supabase.from("erp_produtos").select("id,codigo,nome,unidade").eq("company_id",sel).eq("ativo",true).order("nome");
    if(data)setProdutos(data);
  };

  const loadFornecedores=async()=>{
    const{data}=await supabase.from("erp_fornecedores").select("id,razao_social,nome_fantasia,cpf_cnpj,telefone,email").eq("company_id",sel).eq("ativo",true).order("razao_social");
    if(data)setFornecedores(data);
  };

  const criarCotacao=async()=>{
    if(novaCot.itens.length===0){setMsg("❌ Adicione pelo menos 1 item à cotação");return;}
    if(novaCot.fornecedores.length===0){setMsg("❌ Selecione pelo menos 1 fornecedor");return;}
    
    const{data:{user}}=await supabase.auth.getUser();
    const{data:numero}=await supabase.rpc('next_cotacao_numero',{p_company_id:sel});
    
    const{data:cot,error}=await supabase.from("erp_cotacoes").insert({
      company_id:sel,
      numero,
      descricao:novaCot.descricao||`Cotação ${numero}`,
      data_limite:novaCot.data_limite||null,
      status:'aguardando_respostas',
      solicitante:user?.email,
      created_by:user?.id,
    }).select().single();
    
    if(error){setMsg("❌ "+error.message);return;}
    
    // Insere itens
    const itens=novaCot.itens.map((it:any,idx:number)=>({
      cotacao_id:cot.id,
      company_id:sel,
      ordem:idx,
      produto_id:it.produto_id,
      produto_codigo:it.produto_codigo,
      produto_nome:it.produto_nome,
      unidade:it.unidade,
      quantidade:it.quantidade,
      observacoes:it.observacoes,
    }));
    await supabase.from("erp_cotacoes_itens").insert(itens);
    
    // Insere fornecedores convidados
    const forns=novaCot.fornecedores.map((f:any)=>({
      cotacao_id:cot.id,
      company_id:sel,
      fornecedor_id:f.id,
      fornecedor_nome:f.razao_social||f.nome_fantasia,
      fornecedor_cnpj:f.cpf_cnpj,
      status:'convidado',
    }));
    await supabase.from("erp_cotacoes_fornecedores").insert(forns);
    
    setMsg(`✅ Cotação ${numero} criada com ${novaCot.itens.length} itens e ${novaCot.fornecedores.length} fornecedores`);
    setShowNova(false);
    setNovaCot({descricao:'',data_limite:'',itens:[],fornecedores:[]});
    loadCotacoes();
    setTimeout(()=>setMsg(""),4000);
  };

  const abrirComparar=async(c:Cotacao)=>{
    setShowComparar(c);
    
    const{data:itens}=await supabase.from("erp_cotacoes_itens").select("*").eq("cotacao_id",c.id).order("ordem");
    const{data:forns}=await supabase.from("erp_cotacoes_fornecedores").select("*").eq("cotacao_id",c.id).order("total");
    const{data:props}=await supabase.from("erp_cotacoes_propostas").select("*").in("cotacao_fornecedor_id",(forns||[]).map((f:any)=>f.id));
    
    setDadosComparar({itens:itens||[],fornecedores:forns||[],propostas:props||[]});
  };

  const atualizarProposta=async(cotForneId:string,cotItemId:string,campo:string,valor:any)=>{
    const existente=dadosComparar.propostas.find((p:any)=>p.cotacao_fornecedor_id===cotForneId&&p.cotacao_item_id===cotItemId);
    const item=dadosComparar.itens.find((i:any)=>i.id===cotItemId);
    const qtd=Number(item?.quantidade)||0;
    
    if(existente){
      const novoPreco=campo==='preco_unitario'?Number(valor):Number(existente.preco_unitario);
      const novoDesc=campo==='desconto_percentual'?Number(valor):Number(existente.desconto_percentual);
      const subtotal=(qtd*novoPreco)*(1-novoDesc/100);
      
      await supabase.from("erp_cotacoes_propostas").update({[campo]:Number(valor),subtotal}).eq("id",existente.id);
      setDadosComparar({...dadosComparar,propostas:dadosComparar.propostas.map((p:any)=>p.id===existente.id?{...p,[campo]:Number(valor),subtotal}:p)});
    }else{
      const novoPreco=campo==='preco_unitario'?Number(valor):0;
      const novoDesc=campo==='desconto_percentual'?Number(valor):0;
      const subtotal=(qtd*novoPreco)*(1-novoDesc/100);
      
      const{data}=await supabase.from("erp_cotacoes_propostas").insert({
        cotacao_fornecedor_id:cotForneId,
        cotacao_item_id:cotItemId,
        company_id:sel,
        [campo]:Number(valor),
        subtotal,
      }).select().single();
      if(data)setDadosComparar({...dadosComparar,propostas:[...dadosComparar.propostas,data]});
    }
    
    // Atualiza total do fornecedor
    recalcularTotalFornecedor(cotForneId);
  };

  const recalcularTotalFornecedor=async(cotForneId:string)=>{
    const{data:props}=await supabase.from("erp_cotacoes_propostas").select("subtotal").eq("cotacao_fornecedor_id",cotForneId);
    const subtotal=(props||[]).reduce((s:number,p:any)=>s+Number(p.subtotal||0),0);
    const forn=dadosComparar.fornecedores.find((f:any)=>f.id===cotForneId);
    const total=subtotal+(Number(forn?.frete_valor)||0)-(Number(forn?.desconto_valor)||0);
    await supabase.from("erp_cotacoes_fornecedores").update({subtotal,total,status:subtotal>0?'respondeu':'convidado'}).eq("id",cotForneId);
    setDadosComparar({...dadosComparar,fornecedores:dadosComparar.fornecedores.map((f:any)=>f.id===cotForneId?{...f,subtotal,total}:f)});
  };

  const atualizarCampoFornecedor=async(cotForneId:string,campo:string,valor:any)=>{
    await supabase.from("erp_cotacoes_fornecedores").update({[campo]:valor}).eq("id",cotForneId);
    setDadosComparar({...dadosComparar,fornecedores:dadosComparar.fornecedores.map((f:any)=>f.id===cotForneId?{...f,[campo]:valor}:f)});
    if(['frete_valor','desconto_valor'].includes(campo))recalcularTotalFornecedor(cotForneId);
  };

  const aprovarVencedor=async(cotForneId:string)=>{
    if(!showComparar)return;
    const forn=dadosComparar.fornecedores.find((f:any)=>f.id===cotForneId);
    if(!confirm(`Aprovar ${forn.fornecedor_nome} como vencedor? Uma Pedido de Compra será gerado automaticamente.`))return;
    
    const{data:{user}}=await supabase.auth.getUser();
    const{data:compraId,error}=await supabase.rpc('converter_cotacao_compra',{
      p_cotacao_id:showComparar.id,
      p_fornecedor_id:forn.fornecedor_id,
      p_user_id:user?.id,
    });
    
    if(error){setMsg("❌ "+error.message);return;}
    setMsg("✅ Cotação aprovada e pedido de compra gerado!");
    setShowComparar(null);
    loadCotacoes();
    setTimeout(()=>setMsg(""),4000);
  };

  const filtradas=useMemo(()=>{
    let r=cotacoes;
    if(filtroStatus!=='todos')r=r.filter(c=>c.status===filtroStatus);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(c=>(c.numero||'').toLowerCase().includes(b)||(c.descricao||'').toLowerCase().includes(b));
    }
    return r;
  },[cotacoes,filtroStatus,busca]);

  const kpis={
    total:cotacoes.length,
    abertas:cotacoes.filter(c=>['aberta','aguardando_respostas','em_analise'].includes(c.status)).length,
    aprovadas:cotacoes.filter(c=>c.status==='aprovada').length,
  };

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>📊 Cotações de Compra</div>
          <div style={{fontSize:11,color:TXD}}>Compare propostas lado a lado · Aprovação 1-clique gera pedido de compra</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <button onClick={()=>setShowNova(true)} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Nova Cotação</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Total de Cotações",v:String(kpis.total),c:B,icon:"📊"},
          {l:"Em Andamento",v:String(kpis.abertas),c:Y,icon:"⏳"},
          {l:"Aprovadas",v:String(kpis.aprovadas),c:G,icon:"✅"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por número ou descrição..." style={{...inp,paddingLeft:32}}/>
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
              <div style={{fontSize:40,marginBottom:8}}>📊</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhuma cotação ainda</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Cotações permitem comparar propostas de múltiplos fornecedores lado a lado</div>
              <button onClick={()=>setShowNova(true)} style={{padding:"10px 20px",borderRadius:8,background:GO,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Primeira Cotação</button>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Descrição</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Abertura</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Limite</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtradas.map(c=>{
                  const cfg=STATUS_CFG[c.status]||STATUS_CFG.aberta;
                  return(
                    <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}`,cursor:"pointer"}} onClick={()=>abrirComparar(c)}>
                      <td style={{padding:"8px",fontFamily:"monospace",fontWeight:600,color:GO}}>{c.numero}</td>
                      <td style={{padding:"8px",color:TX}}>{c.descricao}</td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(c.data_abertura)}</td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(c.data_limite)}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                      </td>
                      <td style={{padding:"8px",textAlign:"right"}} onClick={e=>e.stopPropagation()}>
                        <button onClick={()=>abrirComparar(c)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>{c.status==='aprovada'?'Ver':'Comparar →'}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal Nova Cotação */}
      {showNova&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowNova(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>+ Nova Cotação de Compra</div>
              <button onClick={()=>setShowNova(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginBottom:14}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Descrição</div>
                <input value={novaCot.descricao} onChange={e=>setNovaCot({...novaCot,descricao:e.target.value})} placeholder="Ex: Compra mensal de matéria-prima" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Limite para Respostas</div>
                <input type="date" value={novaCot.data_limite} onChange={e=>setNovaCot({...novaCot,data_limite:e.target.value})} style={inp}/></div>
            </div>

            {/* Itens */}
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                <div style={{fontSize:11,fontWeight:600,color:GO}}>📦 Itens a Cotar ({novaCot.itens.length})</div>
                <button onClick={()=>setNovaCot({...novaCot,itens:[...novaCot.itens,{produto_id:'',produto_codigo:'',produto_nome:'',unidade:'UN',quantidade:1,observacoes:''}]})} style={{padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,fontSize:10,fontWeight:600,border:`1px solid ${GO}40`,cursor:"pointer"}}>+ Adicionar Item</button>
              </div>
              {novaCot.itens.length===0?<div style={{background:BG3,borderRadius:8,padding:16,textAlign:"center",fontSize:11,color:TXD}}>Nenhum item ainda. Clique em "Adicionar Item".</div>:
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {novaCot.itens.map((it:any,idx:number)=>(
                  <div key={idx} style={{background:BG3,borderRadius:8,padding:8,display:"grid",gridTemplateColumns:"30px 1fr 80px 70px 30px",gap:6,alignItems:"center"}}>
                    <div style={{textAlign:"center",color:TXD,fontWeight:600,fontSize:10}}>{idx+1}</div>
                    <select value={it.produto_id} onChange={e=>{
                      const p=produtos.find(p=>p.id===e.target.value);
                      const novos=[...novaCot.itens];
                      novos[idx]={...novos[idx],produto_id:e.target.value,produto_codigo:p?.codigo||'',produto_nome:p?.nome||'',unidade:p?.unidade||'UN'};
                      setNovaCot({...novaCot,itens:novos});
                    }} style={{...inp,padding:"6px 8px",fontSize:11}}>
                      <option value="">Selecione produto...</option>
                      {produtos.map(p=><option key={p.id} value={p.id}>{p.codigo} - {p.nome}</option>)}
                    </select>
                    <input type="number" step="0.001" value={it.quantidade||''} onChange={e=>{const novos=[...novaCot.itens];novos[idx].quantidade=parseFloat(e.target.value)||0;setNovaCot({...novaCot,itens:novos});}} placeholder="Qtd" style={{...inp,padding:"6px 8px",fontSize:11,textAlign:"right"}}/>
                    <input value={it.unidade} onChange={e=>{const novos=[...novaCot.itens];novos[idx].unidade=e.target.value;setNovaCot({...novaCot,itens:novos});}} placeholder="UN" style={{...inp,padding:"6px 8px",fontSize:11,textAlign:"center"}}/>
                    <button onClick={()=>setNovaCot({...novaCot,itens:novaCot.itens.filter((_:any,i:number)=>i!==idx)})} style={{background:"none",border:"none",color:R,cursor:"pointer",fontSize:14}}>✕</button>
                  </div>
                ))}
              </div>}
            </div>

            {/* Fornecedores */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:6}}>🚚 Fornecedores a Convidar ({novaCot.fornecedores.length})</div>
              {fornecedores.length===0?<div style={{background:BG3,borderRadius:8,padding:16,textAlign:"center",fontSize:11,color:TXD}}>Nenhum fornecedor cadastrado. Cadastre em Fornecedores primeiro.</div>:
              <div style={{background:BG3,borderRadius:8,padding:10,maxHeight:200,overflowY:"auto"}}>
                {fornecedores.map(f=>{
                  const checked=novaCot.fornecedores.some((nf:any)=>nf.id===f.id);
                  return(
                    <label key={f.id} style={{display:"flex",alignItems:"center",gap:8,padding:6,cursor:"pointer",borderRadius:4,background:checked?GO+"15":"transparent"}}>
                      <input type="checkbox" checked={checked} onChange={e=>{
                        if(e.target.checked)setNovaCot({...novaCot,fornecedores:[...novaCot.fornecedores,f]});
                        else setNovaCot({...novaCot,fornecedores:novaCot.fornecedores.filter((nf:any)=>nf.id!==f.id)});
                      }} style={{cursor:"pointer"}}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,fontWeight:500,color:TX}}>{f.razao_social||f.nome_fantasia}</div>
                        {f.cpf_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{f.cpf_cnpj}</div>}
                      </div>
                    </label>
                  );
                })}
              </div>}
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowNova(false)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={criarCotacao} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>Criar Cotação</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Comparar */}
      {showComparar&&dadosComparar&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowComparar(null)}>
          <div style={{background:BG2,borderRadius:16,padding:20,maxWidth:1300,width:"100%",maxHeight:"95vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div style={{fontSize:20,fontWeight:700,color:TX}}>📊 Cotação <span style={{color:GO,fontFamily:"monospace"}}>{showComparar.numero}</span></div>
                <div style={{fontSize:11,color:TXD}}>{showComparar.descricao} · {dadosComparar.itens.length} itens · {dadosComparar.fornecedores.length} fornecedores</div>
              </div>
              <button onClick={()=>setShowComparar(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {/* Tabela comparativa */}
            <div style={{overflowX:"auto",background:BG3,borderRadius:10,padding:10,marginBottom:14}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,minWidth:800}}>
                <thead>
                  <tr>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10,background:BG2,borderRadius:"8px 0 0 0",minWidth:180}}>Item</th>
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,background:BG2,width:70}}>Qtd</th>
                    {dadosComparar.fornecedores.map((f:any,idx:number)=>{
                      const ehVencedor=f.status==='vencedor';
                      return(
                        <th key={f.id} style={{padding:"8px",textAlign:"center",fontSize:10,background:ehVencedor?G+"20":BG2,minWidth:140,borderRight:idx===dadosComparar.fornecedores.length-1?"none":`1px solid ${BD}`}}>
                          <div style={{color:ehVencedor?G:TX,fontWeight:700}}>{ehVencedor&&"🏆 "}{f.fornecedor_nome}</div>
                          <div style={{fontSize:8,color:TXD,fontWeight:400}}>{f.status==='respondeu'?'✓ Respondeu':f.status==='vencedor'?'Vencedor':f.status==='perdedor'?'Perdedor':'Aguardando'}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {dadosComparar.itens.map((item:any)=>{
                    // Encontra o menor preço entre as propostas
                    const propostas:any[]=dadosComparar.fornecedores.map((f:any)=>{
                      const p=dadosComparar.propostas.find((p:any)=>p.cotacao_fornecedor_id===f.id&&p.cotacao_item_id===item.id);
                      return{fornecedor:f,proposta:p};
                    });
                    const precos=propostas.filter((p:any)=>p.proposta&&Number(p.proposta.preco_unitario)>0).map((p:any)=>Number(p.proposta.preco_unitario));
                    const menorPreco=precos.length>0?Math.min(...precos):0;
                    
                    return(
                      <tr key={item.id} style={{borderTop:`1px solid ${BD}`}}>
                        <td style={{padding:"8px",background:BG2}}>
                          <div style={{fontWeight:500,color:TX}}>{item.produto_nome}</div>
                          {item.produto_codigo&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{item.produto_codigo}</div>}
                        </td>
                        <td style={{padding:"8px",textAlign:"center",color:TXM,background:BG2}}>{fmtQ(item.quantidade)} {item.unidade}</td>
                        {propostas.map(({fornecedor,proposta}:{fornecedor:any,proposta:any})=>{
                          const preco=Number(proposta?.preco_unitario||0);
                          const isMelhor=preco>0&&preco===menorPreco&&precos.length>1;
                          return(
                            <td key={fornecedor.id} style={{padding:"6px",textAlign:"center",background:isMelhor?G+"12":BG2,borderLeft:`1px solid ${BD}`}}>
                              {showComparar.status==='aprovada'?(
                                <div>
                                  {preco>0?<div style={{fontWeight:600,color:isMelhor?G:TX}}>{fmtR(preco)}</div>:<div style={{color:TXD,fontSize:10}}>—</div>}
                                  {proposta?.subtotal&&<div style={{fontSize:9,color:TXD}}>Subtotal: {fmtR(proposta.subtotal)}</div>}
                                </div>
                              ):(
                                <input type="number" step="0.01" value={proposta?.preco_unitario||''} onChange={e=>atualizarProposta(fornecedor.id,item.id,'preco_unitario',e.target.value)} placeholder="R$ 0,00" style={{...inp,padding:"4px 6px",fontSize:11,textAlign:"right",background:isMelhor?G+"20":BG3,borderColor:isMelhor?G:BD}}/>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {/* Linha Frete */}
                  <tr style={{borderTop:`1px solid ${BD}`,background:BG3}}>
                    <td colSpan={2} style={{padding:"8px",textAlign:"right",color:TXM,fontWeight:600,fontSize:10,background:BG3}}>Frete:</td>
                    {dadosComparar.fornecedores.map((f:any)=>(
                      <td key={f.id} style={{padding:"6px",textAlign:"center",background:BG3,borderLeft:`1px solid ${BD}`}}>
                        {showComparar.status==='aprovada'?fmtR(f.frete_valor):<input type="number" step="0.01" value={f.frete_valor||''} onChange={e=>atualizarCampoFornecedor(f.id,'frete_valor',parseFloat(e.target.value)||0)} placeholder="R$ 0" style={{...inp,padding:"4px 6px",fontSize:10,textAlign:"right"}}/>}
                      </td>
                    ))}
                  </tr>
                  {/* Linha Condição */}
                  <tr style={{background:BG3}}>
                    <td colSpan={2} style={{padding:"8px",textAlign:"right",color:TXM,fontWeight:600,fontSize:10,background:BG3}}>Condição:</td>
                    {dadosComparar.fornecedores.map((f:any)=>(
                      <td key={f.id} style={{padding:"6px",textAlign:"center",background:BG3,borderLeft:`1px solid ${BD}`}}>
                        {showComparar.status==='aprovada'?<span style={{fontSize:10,color:TXM}}>{f.condicao_pagamento||'—'}</span>:<input value={f.condicao_pagamento||''} onChange={e=>atualizarCampoFornecedor(f.id,'condicao_pagamento',e.target.value)} placeholder="30 dias" style={{...inp,padding:"4px 6px",fontSize:10,textAlign:"center"}}/>}
                      </td>
                    ))}
                  </tr>
                  {/* Linha Prazo */}
                  <tr style={{background:BG3}}>
                    <td colSpan={2} style={{padding:"8px",textAlign:"right",color:TXM,fontWeight:600,fontSize:10,background:BG3}}>Prazo (dias):</td>
                    {dadosComparar.fornecedores.map((f:any)=>(
                      <td key={f.id} style={{padding:"6px",textAlign:"center",background:BG3,borderLeft:`1px solid ${BD}`}}>
                        {showComparar.status==='aprovada'?<span style={{fontSize:10,color:TXM}}>{f.prazo_entrega_dias||'—'}d</span>:<input type="number" value={f.prazo_entrega_dias||''} onChange={e=>atualizarCampoFornecedor(f.id,'prazo_entrega_dias',parseInt(e.target.value)||0)} placeholder="7" style={{...inp,padding:"4px 6px",fontSize:10,textAlign:"center"}}/>}
                      </td>
                    ))}
                  </tr>
                  {/* Linha TOTAL */}
                  <tr style={{background:BG2,borderTop:`2px solid ${GO}`}}>
                    <td colSpan={2} style={{padding:"10px",textAlign:"right",color:TX,fontWeight:700,fontSize:11,background:BG2}}>TOTAL:</td>
                    {dadosComparar.fornecedores.map((f:any)=>{
                      const totais=dadosComparar.fornecedores.map((ff:any)=>Number(ff.total)||0).filter((t:number)=>t>0);
                      const menorTotal=totais.length>0?Math.min(...totais):0;
                      const ehMelhorTotal=Number(f.total)>0&&Number(f.total)===menorTotal;
                      const ehVencedor=f.status==='vencedor';
                      return(
                        <td key={f.id} style={{padding:"10px",textAlign:"center",background:ehVencedor?G+"20":ehMelhorTotal?G+"12":BG2,borderLeft:`1px solid ${BD}`}}>
                          <div style={{fontSize:16,fontWeight:800,color:ehVencedor||ehMelhorTotal?G:TX,fontFamily:"monospace"}}>{fmtR(f.total)}</div>
                          {ehMelhorTotal&&!ehVencedor&&<div style={{fontSize:9,color:G,fontWeight:600}}>🏆 Melhor preço</div>}
                        </td>
                      );
                    })}
                  </tr>
                  {/* Linha Ação */}
                  {showComparar.status!=='aprovada'&&(
                    <tr style={{background:BG2}}>
                      <td colSpan={2} style={{padding:"8px",background:BG2}}></td>
                      {dadosComparar.fornecedores.map((f:any)=>(
                        <td key={f.id} style={{padding:"8px",textAlign:"center",background:BG2,borderLeft:`1px solid ${BD}`}}>
                          {Number(f.total)>0&&<button onClick={()=>aprovarVencedor(f.id)} style={{padding:"8px 14px",borderRadius:8,background:G,color:"#FFF",fontSize:11,fontWeight:600,border:"none",cursor:"pointer",width:"100%"}}>🏆 Aprovar</button>}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {showComparar.status==='aprovada'&&showComparar.compra_gerada_id&&(
              <div style={{background:G+"15",borderRadius:10,padding:14,border:`1px solid ${G}40`,textAlign:"center"}}>
                <div style={{fontSize:13,fontWeight:600,color:G,marginBottom:4}}>✅ Cotação aprovada e Pedido de Compra gerado</div>
                <a href="/dashboard/compras" style={{fontSize:11,color:G,textDecoration:"underline"}}>Ver Pedidos de Compra →</a>
              </div>
            )}

            <div style={{display:"flex",justifyContent:"flex-end",marginTop:14}}>
              <button onClick={()=>setShowComparar(null)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Cotações v1.0 · Comparação visual · Sprint 3.1</div>
    </div>
  );
}
