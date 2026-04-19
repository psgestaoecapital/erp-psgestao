"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type ItemOrc = {
  id?:string; ordem:number;
  produto_id?:string; produto_codigo:string; produto_nome:string; produto_descricao?:string;
  unidade:string; quantidade:number; preco_unitario:number; preco_custo?:number;
  desconto_percentual:number; desconto_valor:number;
  subtotal:number; margem_percentual?:number;
  observacoes?:string;
};

type Orcamento = {
  id:string; company_id:string; numero:string; versao:number;
  cliente_id:string; cliente_nome:string; cliente_cnpj:string; cliente_email:string; cliente_telefone:string;
  data_emissao:string; data_validade:string; data_aprovacao:string;
  status:string; vendedor_nome:string; comissao_percentual:number;
  condicao_pagamento:string; prazo_entrega_dias:number; forma_pagamento:string;
  frete_tipo:string; frete_valor:number;
  subtotal:number; desconto_percentual:number; desconto_valor:number; acrescimo_valor:number; total:number;
  observacoes:string; observacoes_internas:string; texto_proposta:string;
  hash_publico:string; visualizado_em:string; qtd_visualizacoes:number;
  pedido_id:string; convertido_em:string;
  created_at:string; updated_at:string;
  itens?:ItemOrc[];
};

const CONDS = ['À vista','7 dias','14 dias','21 dias','30 dias','30/60 dias','30/60/90 dias','45 dias','60 dias','90 dias'];
const FORMAS = ['PIX','Boleto','Transferência','Cartão Crédito','Cartão Débito','Dinheiro','Cheque','Múltiplas'];
const FRETES = ['CIF (por conta do fornecedor)','FOB (por conta do cliente)','Retira','Incluso no valor','Combinar'];

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}> = {
  rascunho:    {cor:TXD,icon:"📝",label:"Rascunho"},
  enviado:     {cor:B,  icon:"📨",label:"Enviado"},
  visualizado: {cor:P,  icon:"👁️",label:"Visualizado"},
  aprovado:    {cor:G,  icon:"✅",label:"Aprovado"},
  recusado:    {cor:R,  icon:"❌",label:"Recusado"},
  expirado:    {cor:Y,  icon:"⏰",label:"Expirado"},
  convertido:  {cor:GO, icon:"🎯",label:"Virou Pedido"},
};

const fmtR=(v:number)=>`R$ ${(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtQ=(v:number)=>(v||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';
const addDias=(d:number)=>{const x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10);};

const EMPTY_ITEM:ItemOrc = {ordem:0,produto_codigo:'',produto_nome:'',unidade:'UN',quantidade:1,preco_unitario:0,desconto_percentual:0,desconto_valor:0,subtotal:0};

export default function OrcamentosPage(){
  const [orcamentos,setOrcamentos]=useState<Orcamento[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroStatus,setFiltroStatus]=useState("todos");
  const [showForm,setShowForm]=useState(false);
  const [editing,setEditing]=useState<Orcamento|null>(null);
  const [msg,setMsg]=useState("");

  // Form state
  const [form,setForm]=useState<Partial<Orcamento>>({});
  const [itens,setItens]=useState<ItemOrc[]>([]);
  
  // Autocomplete
  const [buscaCliente,setBuscaCliente]=useState("");
  const [clientesBusca,setClientesBusca]=useState<any[]>([]);
  const [showBuscaCliente,setShowBuscaCliente]=useState(false);
  const [produtosCache,setProdutosCache]=useState<any[]>([]);
  const [buscaProduto,setBuscaProduto]=useState<{idx:number;termo:string}|null>(null);
  const [produtosBusca,setProdutosBusca]=useState<any[]>([]);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadOrcamentos();loadProdutos();}},[sel]);
  useEffect(()=>{
    if(buscaCliente.length<2){setClientesBusca([]);return;}
    const t=setTimeout(async()=>{
      const{data}=await supabase.from("erp_clientes").select("id,razao_social,nome_fantasia,cpf_cnpj,email,telefone").eq("company_id",sel).eq("ativo",true).or(`razao_social.ilike.%${buscaCliente}%,nome_fantasia.ilike.%${buscaCliente}%,cpf_cnpj.ilike.%${buscaCliente.replace(/\D/g,'')}%`).limit(8);
      setClientesBusca(data||[]);
    },250);
    return()=>clearTimeout(t);
  },[buscaCliente,sel]);
  useEffect(()=>{
    if(!buscaProduto||buscaProduto.termo.length<1){setProdutosBusca([]);return;}
    const termo=buscaProduto.termo.toLowerCase();
    const r=produtosCache.filter(p=>(p.nome||'').toLowerCase().includes(termo)||(p.codigo||'').toLowerCase().includes(termo)).slice(0,8);
    setProdutosBusca(r);
  },[buscaProduto,produtosCache]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadOrcamentos=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_orcamentos").select("*").eq("company_id",sel).order("data_emissao",{ascending:false}).limit(100);
    if(data)setOrcamentos(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const loadProdutos=async()=>{
    const{data}=await supabase.from("erp_produtos").select("id,codigo,nome,unidade,preco_venda,preco_custo").eq("company_id",sel).eq("ativo",true).limit(1000);
    if(data)setProdutosCache(data);
  };

  const abrirNovo=async()=>{
    setEditing(null);
    // Gera número automático
    const{data}=await supabase.rpc('next_orcamento_numero',{p_company_id:sel});
    const numero=data||`ORC-${new Date().getFullYear()}-0001`;
    setForm({
      numero,data_emissao:new Date().toISOString().slice(0,10),data_validade:addDias(15),
      status:'rascunho',versao:1,
      condicao_pagamento:'30 dias',prazo_entrega_dias:10,
      subtotal:0,desconto_percentual:0,desconto_valor:0,acrescimo_valor:0,frete_valor:0,total:0,
    });
    setItens([{...EMPTY_ITEM,ordem:1}]);
    setBuscaCliente("");
    setShowForm(true);
  };

  const abrirEdicao=async(o:Orcamento)=>{
    setEditing(o);setForm({...o});
    const{data}=await supabase.from("erp_orcamentos_itens").select("*").eq("orcamento_id",o.id).order("ordem");
    setItens((data||[]).map(i=>({...i,quantidade:Number(i.quantidade),preco_unitario:Number(i.preco_unitario),desconto_percentual:Number(i.desconto_percentual),desconto_valor:Number(i.desconto_valor),subtotal:Number(i.subtotal)})));
    setBuscaCliente(o.cliente_nome||'');
    setShowForm(true);
  };

  const selecionarCliente=(c:any)=>{
    setForm({...form,cliente_id:c.id,cliente_nome:c.nome_fantasia||c.razao_social,cliente_cnpj:c.cpf_cnpj,cliente_email:c.email,cliente_telefone:c.telefone});
    setBuscaCliente(c.nome_fantasia||c.razao_social);
    setShowBuscaCliente(false);
  };

  const selecionarProduto=(idx:number,p:any)=>{
    const novosItens=[...itens];
    novosItens[idx]={...novosItens[idx],produto_id:p.id,produto_codigo:p.codigo,produto_nome:p.nome,unidade:p.unidade||'UN',preco_unitario:Number(p.preco_venda)||0,preco_custo:Number(p.preco_custo)||0};
    recalcularItem(idx,novosItens);
    setBuscaProduto(null);
  };

  const addItem=()=>setItens([...itens,{...EMPTY_ITEM,ordem:itens.length+1}]);
  const removerItem=(idx:number)=>setItens(itens.filter((_,i)=>i!==idx).map((it,i)=>({...it,ordem:i+1})));
  
  const atualizarItem=(idx:number,campo:keyof ItemOrc,valor:any)=>{
    const novosItens=[...itens];
    (novosItens[idx] as any)[campo]=valor;
    recalcularItem(idx,novosItens);
  };

  const recalcularItem=(idx:number,arr:ItemOrc[])=>{
    const it=arr[idx];
    const bruto=(Number(it.quantidade)||0)*(Number(it.preco_unitario)||0);
    const descPct=bruto*(Number(it.desconto_percentual)||0)/100;
    it.subtotal=Math.max(bruto-descPct-(Number(it.desconto_valor)||0),0);
    if(it.preco_custo&&it.preco_custo>0&&it.preco_unitario>0){
      it.margem_percentual=Math.round(((it.preco_unitario-it.preco_custo)/it.preco_unitario)*1000)/10;
    }
    setItens(arr);
  };

  const totalItens=useMemo(()=>itens.reduce((s,i)=>s+i.subtotal,0),[itens]);
  const totalFinal=useMemo(()=>{
    const descPct=totalItens*(Number(form.desconto_percentual)||0)/100;
    return Math.max(totalItens-descPct-(Number(form.desconto_valor)||0)+(Number(form.acrescimo_valor)||0)+(Number(form.frete_valor)||0),0);
  },[totalItens,form.desconto_percentual,form.desconto_valor,form.acrescimo_valor,form.frete_valor]);

  const salvar=async()=>{
    if(!form.cliente_id&&!form.cliente_nome){setMsg("❌ Selecione um cliente.");return;}
    if(itens.length===0||!itens.some(i=>i.produto_nome)){setMsg("❌ Adicione pelo menos um item.");return;}

    const dadosOrc={
      company_id:sel,
      numero:form.numero,
      versao:form.versao||1,
      cliente_id:form.cliente_id,cliente_nome:form.cliente_nome,cliente_cnpj:(form.cliente_cnpj||'').replace(/\D/g,''),
      cliente_email:form.cliente_email,cliente_telefone:form.cliente_telefone,
      data_emissao:form.data_emissao,data_validade:form.data_validade,
      status:form.status||'rascunho',
      vendedor_nome:form.vendedor_nome,comissao_percentual:Number(form.comissao_percentual)||0,
      condicao_pagamento:form.condicao_pagamento,prazo_entrega_dias:Number(form.prazo_entrega_dias)||0,
      forma_pagamento:form.forma_pagamento,
      frete_tipo:form.frete_tipo,frete_valor:Number(form.frete_valor)||0,
      desconto_percentual:Number(form.desconto_percentual)||0,
      desconto_valor:Number(form.desconto_valor)||0,
      acrescimo_valor:Number(form.acrescimo_valor)||0,
      subtotal:totalItens,total:totalFinal,
      observacoes:form.observacoes,texto_proposta:form.texto_proposta,
    };

    let orcId=editing?.id;
    if(editing){
      const{error}=await supabase.from("erp_orcamentos").update(dadosOrc).eq("id",editing.id);
      if(error){setMsg("Erro: "+error.message);return;}
    }else{
      const{data,error}=await supabase.from("erp_orcamentos").insert(dadosOrc).select().single();
      if(error){setMsg("Erro: "+error.message);return;}
      orcId=data.id;
    }

    // Salvar itens: delete all e re-insert
    if(orcId){
      await supabase.from("erp_orcamentos_itens").delete().eq("orcamento_id",orcId);
      const itensValidos=itens.filter(i=>i.produto_nome).map((i,idx)=>({
        orcamento_id:orcId,company_id:sel,ordem:idx+1,
        produto_id:i.produto_id,produto_codigo:i.produto_codigo,produto_nome:i.produto_nome,produto_descricao:i.produto_descricao,
        unidade:i.unidade,quantidade:i.quantidade,preco_unitario:i.preco_unitario,preco_custo:i.preco_custo,
        desconto_percentual:i.desconto_percentual,desconto_valor:i.desconto_valor,subtotal:i.subtotal,
        margem_percentual:i.margem_percentual,observacoes:i.observacoes,
      }));
      if(itensValidos.length>0)await supabase.from("erp_orcamentos_itens").insert(itensValidos);
    }

    // Log no histórico
    await supabase.from("erp_orcamento_historico").insert({
      orcamento_id:orcId,company_id:sel,
      evento:editing?'editado':'criado',
      detalhe:`${editing?'Atualizado':'Criado'} — Total ${fmtR(totalFinal)}`,
    });

    setMsg(`✅ Orçamento ${form.numero} ${editing?'atualizado':'criado'}!`);
    setShowForm(false);setEditing(null);loadOrcamentos();
    setTimeout(()=>setMsg(""),3000);
  };

  const mudarStatus=async(o:Orcamento,novoStatus:string)=>{
    const update:any={status:novoStatus};
    if(novoStatus==='aprovado')update.data_aprovacao=new Date().toISOString();
    if(novoStatus==='recusado')update.data_recusa=new Date().toISOString();
    await supabase.from("erp_orcamentos").update(update).eq("id",o.id);
    await supabase.from("erp_orcamento_historico").insert({
      orcamento_id:o.id,company_id:sel,evento:`status_${novoStatus}`,detalhe:`Status alterado para ${STATUS_CFG[novoStatus]?.label}`
    });
    setMsg(`✅ Status alterado para ${STATUS_CFG[novoStatus]?.label}`);
    loadOrcamentos();
    setTimeout(()=>setMsg(""),3000);
  };

  const copiarLinkPublico=(o:Orcamento)=>{
    const url=`${window.location.origin}/orcamento/${o.hash_publico}`;
    navigator.clipboard.writeText(url);
    setMsg(`✅ Link copiado: ${url}`);
    setTimeout(()=>setMsg(""),3000);
  };

  const duplicar=async(o:Orcamento)=>{
    const{data:numero}=await supabase.rpc('next_orcamento_numero',{p_company_id:sel});
    const novoOrc={...o,id:undefined,numero,versao:(o.versao||1)+1,status:'rascunho',data_emissao:new Date().toISOString().slice(0,10),data_validade:addDias(15),data_aprovacao:null,data_recusa:null,pedido_id:null,convertido_em:null,created_at:undefined,updated_at:undefined};
    const{data:novo,error}=await supabase.from("erp_orcamentos").insert(novoOrc).select().single();
    if(error){setMsg("Erro: "+error.message);return;}
    // Copiar itens
    const{data:itensAnt}=await supabase.from("erp_orcamentos_itens").select("*").eq("orcamento_id",o.id);
    if(itensAnt&&itensAnt.length>0){
      const novosItens=itensAnt.map(i=>({...i,id:undefined,orcamento_id:novo.id,created_at:undefined,updated_at:undefined}));
      await supabase.from("erp_orcamentos_itens").insert(novosItens);
    }
    setMsg(`✅ Orçamento duplicado como ${numero}`);
    loadOrcamentos();
    setTimeout(()=>setMsg(""),3000);
  };

  const filtrados=useMemo(()=>{
    let r=orcamentos;
    if(filtroStatus!=="todos")r=r.filter(o=>o.status===filtroStatus);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(o=>(o.numero||'').toLowerCase().includes(b)||(o.cliente_nome||'').toLowerCase().includes(b)||(o.cliente_cnpj||'').includes(b.replace(/\D/g,'')));
    }
    return r;
  },[orcamentos,filtroStatus,busca]);

  const kpiTotal=orcamentos.filter(o=>o.status!=='recusado'&&o.status!=='expirado').length;
  const kpiAprovados=orcamentos.filter(o=>o.status==='aprovado').length;
  const kpiPendentes=orcamentos.filter(o=>['enviado','visualizado'].includes(o.status)).length;
  const kpiValorPendente=orcamentos.filter(o=>['enviado','visualizado','rascunho'].includes(o.status)).reduce((s,o)=>s+Number(o.total||0),0);
  const kpiTaxaConversao=kpiTotal>0?(kpiAprovados/kpiTotal)*100:0;

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>💰 Orçamentos</div>
          <div style={{fontSize:11,color:TXD}}>Ciclo de vendas — propostas comerciais com aprovação digital</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <button onClick={abrirNovo} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo Orçamento</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Total Ativos",v:String(kpiTotal),c:B,icon:"📋"},
          {l:"Aguardando",v:String(kpiPendentes),c:Y,icon:"⏳"},
          {l:"Aprovados",v:String(kpiAprovados),c:G,icon:"✅"},
          {l:"Conversão",v:`${kpiTaxaConversao.toFixed(1)}%`,c:kpiTaxaConversao>50?G:kpiTaxaConversao>30?Y:R,icon:"📊"},
          {l:"Valor em Negociação",v:fmtR(kpiValorPendente),c:P,icon:"💰"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
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

      {/* Formulário */}
      {showForm&&(
        <div style={{background:BG2,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${GO}40`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:TX}}>{editing?"Editar":"Novo"} Orçamento</div>
              <div style={{fontSize:11,color:TXD}}>Número: <span style={{fontFamily:"monospace",fontWeight:600,color:GO}}>{form.numero}</span>{(form.versao||1)>1&&<span> · v{form.versao}</span>}</div>
            </div>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{background:"none",border:"none",color:TXD,fontSize:18,cursor:"pointer"}}>✕</button>
          </div>

          {/* Cliente */}
          <div style={{fontSize:11,fontWeight:600,color:B,marginBottom:8}}>👥 Cliente</div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:12,position:"relative"}}>
            <div style={{position:"relative"}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Buscar Cliente *</div>
              <input value={buscaCliente} onChange={e=>{setBuscaCliente(e.target.value);setShowBuscaCliente(true);}} onFocus={()=>setShowBuscaCliente(true)} placeholder="Digite nome, fantasia ou CNPJ..." style={inp}/>
              {showBuscaCliente&&clientesBusca.length>0&&(
                <div style={{position:"absolute",top:"100%",left:0,right:0,background:BG2,border:`1px solid ${BD}`,borderRadius:6,marginTop:2,zIndex:10,maxHeight:240,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
                  {clientesBusca.map(c=>(
                    <div key={c.id} onClick={()=>selecionarCliente(c)} style={{padding:"8px 12px",cursor:"pointer",borderBottom:`1px solid ${BD}`}} onMouseEnter={e=>(e.currentTarget.style.background=BG3)} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                      <div style={{fontSize:12,fontWeight:500,color:TX}}>{c.nome_fantasia||c.razao_social}</div>
                      <div style={{fontSize:9,color:TXD}}>{c.cpf_cnpj?`CNPJ: ${c.cpf_cnpj}`:''}  {c.email?`· ${c.email}`:''}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Data Emissão</div>
              <input type="date" value={form.data_emissao} onChange={e=>setForm({...form,data_emissao:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Validade</div>
              <input type="date" value={form.data_validade} onChange={e=>setForm({...form,data_validade:e.target.value})} style={inp}/></div>
          </div>

          {/* Itens */}
          <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>📦 Itens do Orçamento</span>
            <button onClick={addItem} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>+ Adicionar Item</button>
          </div>
          <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:12}}>
            <div style={{display:"grid",gridTemplateColumns:"40px 2fr 80px 80px 100px 70px 90px 30px",gap:6,alignItems:"center",fontSize:10,color:TXD,fontWeight:600,padding:"4px 0",borderBottom:`1px solid ${BD}`}}>
              <div>#</div><div>Produto / Serviço</div><div>Qtd</div><div>UN</div><div>Preço Unit</div><div>Desc %</div><div style={{textAlign:"right"}}>Subtotal</div><div></div>
            </div>
            {itens.map((it,idx)=>(
              <div key={idx} style={{display:"grid",gridTemplateColumns:"40px 2fr 80px 80px 100px 70px 90px 30px",gap:6,alignItems:"center",padding:"4px 0",borderBottom:`0.5px solid ${BD}`,position:"relative"}}>
                <div style={{fontSize:10,color:TXD,textAlign:"center"}}>{it.ordem}</div>
                <div style={{position:"relative"}}>
                  <input value={it.produto_nome} onChange={e=>{atualizarItem(idx,'produto_nome',e.target.value);setBuscaProduto({idx,termo:e.target.value});}} onFocus={()=>setBuscaProduto({idx,termo:it.produto_nome||''})} placeholder="Buscar produto ou digitar manualmente" style={{...inp,padding:"6px 8px",fontSize:11}}/>
                  {buscaProduto?.idx===idx&&produtosBusca.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:BG2,border:`1px solid ${BD}`,borderRadius:6,marginTop:2,zIndex:20,maxHeight:200,overflowY:"auto",boxShadow:"0 4px 12px rgba(0,0,0,0.1)"}}>
                      {produtosBusca.map(p=>(
                        <div key={p.id} onClick={()=>selecionarProduto(idx,p)} style={{padding:"6px 10px",cursor:"pointer",borderBottom:`1px solid ${BD}`,fontSize:11}} onMouseEnter={e=>(e.currentTarget.style.background=BG3)} onMouseLeave={e=>(e.currentTarget.style.background='transparent')}>
                          <div style={{fontWeight:500,color:TX}}><span style={{color:P,fontFamily:"monospace",fontSize:10}}>{p.codigo}</span> {p.nome}</div>
                          <div style={{fontSize:9,color:G}}>{fmtR(Number(p.preco_venda))}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <input type="number" step="0.01" value={it.quantidade||''} onChange={e=>atualizarItem(idx,'quantidade',parseFloat(e.target.value)||0)} style={{...inp,padding:"6px 8px",fontSize:11,textAlign:"right"}}/>
                <input value={it.unidade} onChange={e=>atualizarItem(idx,'unidade',e.target.value)} style={{...inp,padding:"6px 8px",fontSize:11,textAlign:"center"}}/>
                <input type="number" step="0.01" value={it.preco_unitario||''} onChange={e=>atualizarItem(idx,'preco_unitario',parseFloat(e.target.value)||0)} style={{...inp,padding:"6px 8px",fontSize:11,textAlign:"right"}}/>
                <input type="number" step="0.1" value={it.desconto_percentual||''} onChange={e=>atualizarItem(idx,'desconto_percentual',parseFloat(e.target.value)||0)} style={{...inp,padding:"6px 8px",fontSize:11,textAlign:"right"}}/>
                <div style={{textAlign:"right",fontSize:12,fontWeight:600,color:G}}>{fmtR(it.subtotal)}</div>
                <button onClick={()=>removerItem(idx)} style={{background:"none",border:"none",color:R,cursor:"pointer",fontSize:14}} title="Remover">🗑</button>
              </div>
            ))}
          </div>

          {/* Condições */}
          <div style={{fontSize:11,fontWeight:600,color:G,marginBottom:8}}>📝 Condições Comerciais</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:12}}>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cond. Pagamento</div>
              <select value={form.condicao_pagamento} onChange={e=>setForm({...form,condicao_pagamento:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{CONDS.map(c=><option key={c} value={c}>{c}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Forma Pagamento</div>
              <select value={form.forma_pagamento} onChange={e=>setForm({...form,forma_pagamento:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{FORMAS.map(f=><option key={f} value={f}>{f}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Prazo Entrega (dias)</div>
              <input type="number" value={form.prazo_entrega_dias||''} onChange={e=>setForm({...form,prazo_entrega_dias:parseInt(e.target.value)||0})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Vendedor</div>
              <input value={form.vendedor_nome} onChange={e=>setForm({...form,vendedor_nome:e.target.value})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Frete</div>
              <select value={form.frete_tipo} onChange={e=>setForm({...form,frete_tipo:e.target.value})} style={{...inp,cursor:"pointer"}}>
                <option value="">—</option>{FRETES.map(f=><option key={f} value={f}>{f}</option>)}
              </select></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Valor Frete (R$)</div>
              <input type="number" step="0.01" value={form.frete_valor||''} onChange={e=>setForm({...form,frete_valor:parseFloat(e.target.value)||0})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Desc. Geral (%)</div>
              <input type="number" step="0.1" value={form.desconto_percentual||''} onChange={e=>setForm({...form,desconto_percentual:parseFloat(e.target.value)||0})} style={inp}/></div>
            <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Desc. Geral (R$)</div>
              <input type="number" step="0.01" value={form.desconto_valor||''} onChange={e=>setForm({...form,desconto_valor:parseFloat(e.target.value)||0})} style={inp}/></div>
          </div>

          {/* Totais */}
          <div style={{background:BG3,borderRadius:8,padding:16,marginBottom:12,border:`1px solid ${GO}40`}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,fontSize:11}}>
              <div>
                <div style={{color:TXD,fontSize:9}}>Subtotal</div>
                <div style={{color:TX,fontWeight:600}}>{fmtR(totalItens)}</div>
              </div>
              <div>
                <div style={{color:TXD,fontSize:9}}>Descontos</div>
                <div style={{color:R,fontWeight:600}}>- {fmtR(totalItens*(Number(form.desconto_percentual)||0)/100+(Number(form.desconto_valor)||0))}</div>
              </div>
              <div>
                <div style={{color:TXD,fontSize:9}}>Frete / Acréscimo</div>
                <div style={{color:Y,fontWeight:600}}>+ {fmtR((Number(form.frete_valor)||0)+(Number(form.acrescimo_valor)||0))}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{color:TXD,fontSize:9}}>TOTAL GERAL</div>
                <div style={{color:G,fontWeight:700,fontSize:20}}>{fmtR(totalFinal)}</div>
              </div>
            </div>
          </div>

          {/* Observações */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,color:TXD,marginBottom:3}}>Texto da Proposta (visível para o cliente)</div>
            <textarea value={form.texto_proposta} onChange={e=>setForm({...form,texto_proposta:e.target.value})} rows={2} style={{...inp,resize:"vertical"}} placeholder="Ex: Prezado cliente, apresentamos nossa proposta comercial conforme solicitado..."/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:10,color:TXD,marginBottom:3}}>Observações (visível para o cliente)</div>
            <textarea value={form.observacoes} onChange={e=>setForm({...form,observacoes:e.target.value})} rows={2} style={{...inp,resize:"vertical"}} placeholder="Garantia, condições especiais, etc."/>
          </div>

          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>{setShowForm(false);setEditing(null);}} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            <button onClick={salvar} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>{editing?"Salvar Alterações":"Criar Orçamento"}</button>
          </div>
        </div>
      )}

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>💰</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum orçamento ainda</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Crie seu primeiro orçamento e acompanhe o ciclo de vendas.</div>
              <button onClick={abrirNovo} style={{padding:"10px 20px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Primeiro Orçamento</button>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Emissão</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Validade</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Total</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtrados.map(o=>{
                  const cfg=STATUS_CFG[o.status]||STATUS_CFG.rascunho;
                  const expirado=o.data_validade&&new Date(o.data_validade)<new Date()&&!['aprovado','recusado','convertido'].includes(o.status);
                  return(
                    <tr key={o.id} style={{borderBottom:`0.5px solid ${BD}`,background:expirado?R+"06":"transparent"}}>
                      <td style={{padding:"8px"}}>
                        <div style={{fontFamily:"monospace",fontWeight:600,color:GO}}>{o.numero}</div>
                        {(o.versao||1)>1&&<div style={{fontSize:9,color:TXD}}>v{o.versao}</div>}
                      </td>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{o.cliente_nome||"—"}</div>
                        {o.cliente_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{o.cliente_cnpj}</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(o.data_emissao)}</td>
                      <td style={{padding:"8px",textAlign:"center",fontSize:10,color:expirado?R:TXM,fontWeight:expirado?600:400}}>{fmtD(o.data_validade)}{expirado&&" ⚠️"}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                        {o.qtd_visualizacoes>0&&<div style={{fontSize:8,color:TXD,marginTop:2}}>👁 {o.qtd_visualizacoes} visualiz.</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:G,fontWeight:600}}>{fmtR(Number(o.total))}</td>
                      <td style={{padding:"8px"}}>
                        <div style={{display:"flex",gap:3,justifyContent:"flex-end",flexWrap:"wrap"}}>
                          <button onClick={()=>abrirEdicao(o)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:B+"12",color:B,border:`1px solid ${B}25`,cursor:"pointer"}}>Editar</button>
                          {o.status==='rascunho'&&<button onClick={()=>mudarStatus(o,'enviado')} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:B+"12",color:B,border:`1px solid ${B}25`,cursor:"pointer"}}>📨 Enviar</button>}
                          {['enviado','visualizado'].includes(o.status)&&<button onClick={()=>mudarStatus(o,'aprovado')} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:G+"12",color:G,border:`1px solid ${G}25`,cursor:"pointer"}}>✅ Aprovar</button>}
                          {['enviado','visualizado'].includes(o.status)&&<button onClick={()=>mudarStatus(o,'recusado')} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:R+"12",color:R,border:`1px solid ${R}25`,cursor:"pointer"}}>❌ Recusar</button>}
                          {o.status==='aprovado'&&<button onClick={async()=>{const{data:{user}}=await supabase.auth.getUser();const{data,error}=await supabase.rpc('converter_orcamento_pedido',{p_orcamento_id:o.id,p_user_id:user?.id});if(error){setMsg("❌ "+error.message);return;}setMsg("✅ Convertido em pedido!");loadOrcamentos();setTimeout(()=>setMsg(""),3000);}} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>🎯 → Pedido</button>}
                          <button onClick={()=>copiarLinkPublico(o)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:P+"12",color:P,border:`1px solid ${P}25`,cursor:"pointer"}} title="Copiar link público">🔗</button>
                          <button onClick={()=>duplicar(o)} style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:Y+"12",color:Y,border:`1px solid ${Y}25`,cursor:"pointer"}} title="Duplicar/Nova versão">📋</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Orçamentos v1.0 · Link público · Histórico · IA de preço em breve</div>
    </div>
  );
}
