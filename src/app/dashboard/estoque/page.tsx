"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

const TIPO_CFG:Record<string,{cor:string;icon:string;label:string}>={
  entrada:      {cor:G, icon:"📥",label:"Entrada"},
  saida:        {cor:R, icon:"📤",label:"Saída"},
  ajuste:       {cor:Y, icon:"⚙️",label:"Ajuste"},
  transferencia:{cor:P, icon:"🔄",label:"Transf."},
  perda:        {cor:R, icon:"⚠️",label:"Perda"},
  devolucao:    {cor:T, icon:"↩️",label:"Devolução"},
  inicial:      {cor:B, icon:"🏁",label:"Inicial"},
};

const MOTIVOS_ENTRADA=['Compra','Devolução de cliente','Produção','Ajuste positivo','Importação','Transferência recebida','Outro'];
const MOTIVOS_SAIDA=['Venda','Perda','Vencimento','Avaria','Amostra','Transferência enviada','Uso interno','Devolução a fornecedor','Outro'];

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtQ=(v:any)=>(Number(v)||0).toLocaleString("pt-BR",{maximumFractionDigits:3});
const fmtD=(v:string)=>v?new Date(v).toLocaleDateString("pt-BR"):'—';
const fmtDT=(v:string)=>v?new Date(v).toLocaleString("pt-BR",{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';

export default function EstoquePage(){
  const { companyIds, selInfo, companies, sel } = useCompanyIds();
  const [tab,setTab]=useState<'saldos'|'movimentacoes'|'inventario'>('saldos');
  const [produtos,setProdutos]=useState<any[]>([]);
  const [movs,setMovs]=useState<any[]>([]);
  const [invs,setInvs]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroEstoque,setFiltroEstoque]=useState<string>("todos");
  const [filtroTipo,setFiltroTipo]=useState<string>("todos");
  const [msg,setMsg]=useState("");
  const [showMovimento,setShowMovimento]=useState(false);
  const [novoMov,setNovoMov]=useState<any>({produto_id:'',tipo:'entrada',quantidade:0,custo_unitario:0,motivo:'Compra',observacoes:''});
  const [showInventario,setShowInventario]=useState(false);
  const [invAtivo,setInvAtivo]=useState<any>(null);
  const [invItens,setInvItens]=useState<any[]>([]);

  // Empresa individual para movimentações/inventários (primeiro da lista quando consolidado/grupo)
  const companyIdParaOperacao = useMemo(()=>{
    if(sel && !sel.startsWith("group_") && sel!=="consolidado") return sel;
    return companyIds[0] || "";
  },[sel, companyIds]);

  useEffect(()=>{
    if(companyIds.length>0){loadProdutos();loadMovs();loadInvs();}
  },[companyIds.join(",")]);

  const loadProdutos=async()=>{
    if(companyIds.length===0)return;
    const{data}=await supabase.from("erp_produtos").select("*").in("company_id",companyIds).eq("ativo",true).neq("tipo","servico").order("nome");
    if(data)setProdutos(data);
  };

  const loadMovs=async()=>{
    if(companyIds.length===0){setLoading(false);return;}
    setLoading(true);
    const{data}=await supabase.from("erp_estoque_movimentacoes").select("*, produto:produto_id(nome,codigo)").in("company_id",companyIds).order("data_movimento",{ascending:false}).limit(200);
    if(data)setMovs(data);
    setLoading(false);
  };

  const loadInvs=async()=>{
    if(companyIds.length===0)return;
    const{data}=await supabase.from("erp_inventarios").select("*").in("company_id",companyIds).order("data_inicio",{ascending:false}).limit(20);
    if(data)setInvs(data);
  };

  const registrarMovimento=async()=>{
    if(!novoMov.produto_id){setMsg("❌ Selecione um produto");return;}
    if(!novoMov.quantidade||Number(novoMov.quantidade)<=0){setMsg("❌ Informe a quantidade");return;}
    if(!companyIdParaOperacao){setMsg("❌ Selecione uma empresa");return;}
    
    // Ao operar em modo consolidado/grupo, usa a empresa do produto selecionado
    const produtoSel = produtos.find(p=>p.id===novoMov.produto_id);
    const companyIdMov = produtoSel?.company_id || companyIdParaOperacao;
    
    const{data:{user}}=await supabase.auth.getUser();
    const{error}=await supabase.rpc('registrar_movimento_estoque',{
      p_company_id:companyIdMov,
      p_produto_id:novoMov.produto_id,
      p_tipo:novoMov.tipo,
      p_quantidade:Number(novoMov.quantidade),
      p_custo_unitario:Number(novoMov.custo_unitario)||0,
      p_motivo:novoMov.motivo,
      p_observacoes:novoMov.observacoes,
      p_usuario_id:user?.id,
    });
    if(error){setMsg("❌ "+error.message);return;}
    setMsg("✅ Movimento registrado");
    setShowMovimento(false);
    setNovoMov({produto_id:'',tipo:'entrada',quantidade:0,custo_unitario:0,motivo:'Compra',observacoes:''});
    loadProdutos();loadMovs();
    setTimeout(()=>setMsg(""),3000);
  };

  const iniciarInventario=async()=>{
    if(!companyIdParaOperacao){setMsg("❌ Selecione uma empresa");return;}
    
    const empresaNome = companies.find(c=>c.id===companyIdParaOperacao)?.nome_fantasia || "primeira empresa";
    const msgConfirma = (sel==="consolidado"||sel.startsWith("group_"))
      ? `Iniciar novo inventário em "${empresaNome}"? Todos os produtos ativos dessa empresa serão incluídos para contagem.`
      : "Iniciar novo inventário? Todos os produtos ativos serão incluídos para contagem.";
    if(!confirm(msgConfirma))return;
    
    // Filtra só os produtos da empresa onde o inventário será criado
    const produtosEmpresa = produtos.filter(p=>p.company_id===companyIdParaOperacao);
    
    const{data:{user}}=await supabase.auth.getUser();
    const{data:numero}=await supabase.rpc('next_inventario_numero',{p_company_id:companyIdParaOperacao});
    const{data:inv,error}=await supabase.from("erp_inventarios").insert({
      company_id:companyIdParaOperacao,
      numero,
      responsavel:user?.email||'',
      total_produtos:produtosEmpresa.length,
      created_by:user?.id,
    }).select().single();
    if(error){setMsg("❌ "+error.message);return;}
    // Inserir itens de inventário
    const itens=produtosEmpresa.map(p=>({
      inventario_id:inv.id,
      company_id:companyIdParaOperacao,
      produto_id:p.id,
      quantidade_sistema:Number(p.estoque_atual)||0,
      custo_unitario:Number(p.preco_custo_medio||p.preco_custo)||0,
    }));
    await supabase.from("erp_inventario_itens").insert(itens);
    setMsg(`✅ Inventário ${numero} criado com ${produtosEmpresa.length} produtos`);
    await abrirInventario(inv.id);
    loadInvs();
    setTimeout(()=>setMsg(""),3000);
  };

  const abrirInventario=async(id:string)=>{
    const{data:inv}=await supabase.from("erp_inventarios").select("*").eq("id",id).single();
    const{data:itens}=await supabase.from("erp_inventario_itens").select("*, produto:produto_id(nome,codigo,unidade)").eq("inventario_id",id).order("id");
    setInvAtivo(inv);
    setInvItens(itens||[]);
    setShowInventario(true);
  };

  const atualizarContagem=async(itemId:string,qtd:number)=>{
    await supabase.from("erp_inventario_itens").update({
      quantidade_contada:qtd,
      contado_em:new Date().toISOString(),
    }).eq("id",itemId);
    setInvItens(invItens.map(i=>i.id===itemId?{...i,quantidade_contada:qtd,diferenca:qtd-(Number(i.quantidade_sistema)||0)}:i));
  };

  const fecharInventario=async()=>{
    if(!invAtivo)return;
    const naoContados=invItens.filter(i=>i.quantidade_contada===null||i.quantidade_contada===undefined).length;
    if(naoContados>0&&!confirm(`Existem ${naoContados} produto(s) não contados. Eles não terão ajustes. Deseja fechar mesmo assim?`))return;
    
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('fechar_inventario',{p_inventario_id:invAtivo.id,p_usuario_id:user?.id});
    if(error){setMsg("❌ "+error.message);return;}
    const r=data?.[0];
    setMsg(`✅ Inventário fechado: ${r?.ajustes||0} ajustes aplicados (${fmtR(r?.valor_total)})`);
    setShowInventario(false);
    loadInvs();loadProdutos();loadMovs();
    setTimeout(()=>setMsg(""),5000);
  };

  // Filtros
  const produtosFiltrados=useMemo(()=>{
    let r=produtos;
    if(filtroEstoque==='baixo')r=r.filter(p=>Number(p.estoque_minimo)>0&&Number(p.estoque_atual)<=Number(p.estoque_minimo));
    else if(filtroEstoque==='zero')r=r.filter(p=>Number(p.estoque_atual)<=0);
    else if(filtroEstoque==='com')r=r.filter(p=>Number(p.estoque_atual)>0);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(p=>(p.nome||'').toLowerCase().includes(b)||(p.codigo||'').toLowerCase().includes(b)||(p.categoria||'').toLowerCase().includes(b));
    }
    return r;
  },[produtos,filtroEstoque,busca]);

  const movsFiltrados=useMemo(()=>{
    let r=movs;
    if(filtroTipo!=='todos')r=r.filter(m=>m.tipo===filtroTipo);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(m=>(m.produto?.nome||'').toLowerCase().includes(b)||(m.motivo||'').toLowerCase().includes(b));
    }
    return r;
  },[movs,filtroTipo,busca]);

  const kpis={
    totalProdutos: produtos.length,
    valorEstoque: produtos.reduce((s,p)=>s+(Number(p.estoque_atual)*Number(p.preco_custo_medio||p.preco_custo||0)),0),
    alertasBaixo: produtos.filter(p=>Number(p.estoque_minimo)>0&&Number(p.estoque_atual)<=Number(p.estoque_minimo)).length,
    zerados: produtos.filter(p=>Number(p.estoque_atual)<=0).length,
    movs30d: movs.filter(m=>{const d=new Date(m.data_movimento);return(Date.now()-d.getTime())<30*24*60*60*1000;}).length,
  };

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>📦 Estoque</div>
          <div style={{fontSize:11,color:TXD,display:"flex",alignItems:"center",gap:6}}>
            <span>Saldos · Movimentações · Inventário · Custo médio ponderado</span>
            <span>·</span>
            <span style={{fontWeight:600,color:selInfo.isGroup?GO:TXM}}>
              {selInfo.tipo==='consolidado'?'📊 Todas':selInfo.tipo==='grupo'?'📁 Grupo':'🏢'} {selInfo.nome}
              {selInfo.isGroup&&` (${selInfo.count})`}
            </span>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setShowMovimento(true)} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Movimento</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Produtos Ativos",v:String(kpis.totalProdutos),c:B,icon:"📦"},
          {l:"Valor em Estoque",v:fmtR(kpis.valorEstoque),c:G,icon:"💰"},
          {l:"Alertas Mínimo",v:String(kpis.alertasBaixo),c:kpis.alertasBaixo>0?Y:G,icon:kpis.alertasBaixo>0?"⚠️":"✅"},
          {l:"Zerados",v:String(kpis.zerados),c:kpis.zerados>0?R:G,icon:kpis.zerados>0?"🔴":"✅"},
          {l:"Movs 30 dias",v:String(kpis.movs30d),c:P,icon:"🔄"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:15,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,borderBottom:`1px solid ${BD}`}}>
        {[{k:'saldos',l:'📋 Saldos'},{k:'movimentacoes',l:'🔄 Movimentações'},{k:'inventario',l:'📝 Inventário'}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k as any)} style={{padding:"10px 20px",fontSize:12,fontWeight:tab===t.k?700:500,background:"transparent",border:"none",color:tab===t.k?GO:TXM,borderBottom:`3px solid ${tab===t.k?GO:"transparent"}`,cursor:"pointer",marginBottom:-1}}>{t.l}</button>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder={tab==='saldos'?"Buscar produto, código, categoria...":"Buscar produto, motivo..."} style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        {tab==='saldos'&&(
          <div style={{display:"flex",gap:4}}>
            {[{v:"todos",l:"Todos"},{v:"com",l:"✅ Com estoque"},{v:"baixo",l:"⚠️ Baixo"},{v:"zero",l:"🔴 Zerados"}].map(f=>(
              <button key={f.v} onClick={()=>setFiltroEstoque(f.v)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroEstoque===f.v?GO:BD}`,background:filtroEstoque===f.v?GO+"12":"transparent",color:filtroEstoque===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroEstoque===f.v?600:400}}>{f.l}</button>
            ))}
          </div>
        )}
        {tab==='movimentacoes'&&(
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            <button onClick={()=>setFiltroTipo("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroTipo==="todos"?GO:BD}`,background:filtroTipo==="todos"?GO+"12":"transparent",color:filtroTipo==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroTipo==="todos"?600:400}}>Todos</button>
            {Object.entries(TIPO_CFG).map(([k,cfg])=>(
              <button key={k} onClick={()=>setFiltroTipo(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroTipo===k?cfg.cor:BD}`,background:filtroTipo===k?cfg.cor+"12":"transparent",color:filtroTipo===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroTipo===k?600:400}}>{cfg.icon} {cfg.label}</button>
            ))}
          </div>
        )}
        {tab==='inventario'&&(
          <button onClick={iniciarInventario} style={{padding:"6px 14px",borderRadius:8,background:G+"15",color:G,fontSize:12,fontWeight:600,border:`1px solid ${G}40`,cursor:"pointer"}}>+ Novo Inventário</button>
        )}
      </div>

      {/* Tab: Saldos */}
      {tab==='saldos'&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {produtosFiltrados.length===0?(
            <div style={{padding:40,textAlign:"center",color:TXD}}>Nenhum produto encontrado</div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Produto</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10,width:100}}>Categoria</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:90}}>Estoque</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:80}}>Mínimo</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Custo Médio</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:120}}>Valor em Estoque</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Status</th>
              </tr></thead>
              <tbody>
                {produtosFiltrados.map(p=>{
                  const est=Number(p.estoque_atual)||0;
                  const min=Number(p.estoque_minimo)||0;
                  const custo=Number(p.preco_custo_medio||p.preco_custo)||0;
                  const valor=est*custo;
                  const alerta=min>0&&est<=min;
                  const zero=est<=0;
                  return(
                    <tr key={p.id} style={{borderBottom:`0.5px solid ${BD}`,background:zero?R+"06":alerta?Y+"06":"transparent"}}>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{p.nome}</div>
                        {p.codigo&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{p.codigo}</div>}
                      </td>
                      <td style={{padding:"8px",color:TXM,fontSize:10}}>{p.categoria||'—'}</td>
                      <td style={{padding:"8px",textAlign:"right",color:zero?R:alerta?Y:TX,fontWeight:600}}>{fmtQ(est)} {p.unidade||'UN'}</td>
                      <td style={{padding:"8px",textAlign:"right",color:TXM,fontSize:10}}>{min>0?fmtQ(min):'—'}</td>
                      <td style={{padding:"8px",textAlign:"right",color:TXM}}>{custo>0?fmtR(custo):'—'}</td>
                      <td style={{padding:"8px",textAlign:"right",color:G,fontWeight:600}}>{valor>0?fmtR(valor):'—'}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        {zero?<span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:R+"15",color:R,fontWeight:600}}>🔴 Zerado</span>:
                         alerta?<span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:Y+"15",color:Y,fontWeight:600}}>⚠️ Baixo</span>:
                         <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:G+"15",color:G,fontWeight:600}}>✅ OK</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Movimentações */}
      {tab==='movimentacoes'&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {loading?<div style={{padding:40,textAlign:"center",color:TXD}}>Carregando...</div>:
           movsFiltrados.length===0?<div style={{padding:40,textAlign:"center",color:TXD}}>Nenhuma movimentação encontrada</div>:(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:120}}>Data/Hora</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:80}}>Tipo</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Produto</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Motivo / Ref</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Qtd</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:100}}>Antes → Depois</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:110}}>Valor</th>
              </tr></thead>
              <tbody>
                {movsFiltrados.map(m=>{
                  const cfg=TIPO_CFG[m.tipo]||TIPO_CFG.ajuste;
                  const isEntrada=['entrada','devolucao','inicial'].includes(m.tipo);
                  return(
                    <tr key={m.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                      <td style={{padding:"8px",textAlign:"center",fontSize:10,color:TXM,fontFamily:"monospace"}}>{fmtDT(m.data_movimento)}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,background:cfg.cor+"15",color:cfg.cor,fontWeight:600}}>{cfg.icon} {cfg.label}</span>
                      </td>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX,fontSize:11}}>{m.produto?.nome||'—'}</div>
                        {m.produto?.codigo&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{m.produto.codigo}</div>}
                      </td>
                      <td style={{padding:"8px",color:TXM,fontSize:10}}>
                        {m.motivo||'—'}
                        {m.ref_numero&&<div style={{fontSize:9,color:GO,fontFamily:"monospace"}}>{m.ref_numero}</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:isEntrada?G:R,fontWeight:600}}>{isEntrada?'+':'-'}{fmtQ(m.quantidade)}</td>
                      <td style={{padding:"8px",textAlign:"right",fontSize:9,color:TXM}}>{fmtQ(m.quantidade_antes)} → <b style={{color:TX}}>{fmtQ(m.quantidade_depois)}</b></td>
                      <td style={{padding:"8px",textAlign:"right",color:TXM}}>{Number(m.valor_total)>0?fmtR(m.valor_total):'—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab: Inventário */}
      {tab==='inventario'&&(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`}}>
          {invs.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>📝</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum inventário ainda</div>
              <div style={{fontSize:11,color:TXD,marginBottom:16}}>Crie seu primeiro inventário para fazer a conferência física do estoque.</div>
              <button onClick={iniciarInventario} style={{padding:"10px 20px",borderRadius:8,background:G,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Primeiro Inventário</button>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Início</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Fim</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Produtos</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Divergências</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Valor Ajustado</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ação</th>
              </tr></thead>
              <tbody>
                {invs.map(i=>(
                  <tr key={i.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                    <td style={{padding:"8px",fontFamily:"monospace",fontWeight:600,color:GO}}>{i.numero}</td>
                    <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(i.data_inicio)}</td>
                    <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(i.data_fim)||'—'}</td>
                    <td style={{padding:"8px",textAlign:"center",color:TX}}>{i.total_produtos}</td>
                    <td style={{padding:"8px",textAlign:"center",color:i.total_divergencias>0?Y:G,fontWeight:600}}>{i.total_divergencias||0}</td>
                    <td style={{padding:"8px",textAlign:"right",color:TXM}}>{Number(i.valor_divergencia)>0?fmtR(i.valor_divergencia):'—'}</td>
                    <td style={{padding:"8px",textAlign:"center"}}>
                      <span style={{fontSize:9,padding:"2px 8px",borderRadius:4,fontWeight:600,background:i.status==='fechado'?G+"15":Y+"15",color:i.status==='fechado'?G:Y}}>{i.status==='fechado'?'✅ Fechado':'⏳ '+i.status}</span>
                    </td>
                    <td style={{padding:"8px",textAlign:"right"}}>
                      <button onClick={()=>abrirInventario(i.id)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>{i.status==='fechado'?'Ver':'Contar →'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal: Novo Movimento */}
      {showMovimento&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowMovimento(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:600,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>+ Novo Movimento de Estoque</div>
              <button onClick={()=>setShowMovimento(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo *</div>
                <select value={novoMov.tipo} onChange={e=>setNovoMov({...novoMov,tipo:e.target.value,motivo:e.target.value==='entrada'?'Compra':e.target.value==='saida'?'Venda':'Ajuste'})} style={{...inp,cursor:"pointer"}}>
                  <option value="entrada">📥 Entrada</option>
                  <option value="saida">📤 Saída</option>
                  <option value="ajuste">⚙️ Ajuste (+ ou -)</option>
                  <option value="perda">⚠️ Perda</option>
                  <option value="devolucao">↩️ Devolução</option>
                </select></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Motivo</div>
                <select value={novoMov.motivo} onChange={e=>setNovoMov({...novoMov,motivo:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  {(novoMov.tipo==='entrada'?MOTIVOS_ENTRADA:MOTIVOS_SAIDA).map(m=><option key={m} value={m}>{m}</option>)}
                </select></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Produto *</div>
                <select value={novoMov.produto_id} onChange={e=>setNovoMov({...novoMov,produto_id:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="">Selecione um produto...</option>
                  {produtos.map(p=><option key={p.id} value={p.id}>{p.codigo} - {p.nome} (estoque: {fmtQ(p.estoque_atual)} {p.unidade})</option>)}
                </select></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Quantidade *</div>
                <input type="number" step="0.001" value={novoMov.quantidade||''} onChange={e=>setNovoMov({...novoMov,quantidade:parseFloat(e.target.value)||0})} placeholder={novoMov.tipo==='ajuste'?"Use - para diminuir":""} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Custo Unitário (R$)</div>
                <input type="number" step="0.01" value={novoMov.custo_unitario||''} onChange={e=>setNovoMov({...novoMov,custo_unitario:parseFloat(e.target.value)||0})} placeholder="Para recalcular custo médio" style={inp}/></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Observações</div>
                <textarea value={novoMov.observacoes} onChange={e=>setNovoMov({...novoMov,observacoes:e.target.value})} rows={2} style={{...inp,resize:"vertical"}}/></div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowMovimento(false)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={registrarMovimento} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>Registrar Movimento</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Inventário */}
      {showInventario&&invAtivo&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowInventario(false)}>
          <div style={{background:BG2,borderRadius:16,padding:20,maxWidth:1100,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>📝 Inventário <span style={{color:GO,fontFamily:"monospace"}}>{invAtivo.numero}</span></div>
                <div style={{fontSize:11,color:TXD}}>{fmtD(invAtivo.data_inicio)} · {invAtivo.status==='fechado'?'✅ Fechado':'⏳ Em andamento'}</div>
              </div>
              <button onClick={()=>setShowInventario(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {/* Stats */}
            {(()=>{
              const contados=invItens.filter(i=>i.quantidade_contada!==null&&i.quantidade_contada!==undefined).length;
              const divs=invItens.filter(i=>i.quantidade_contada!==null&&Number(i.diferenca)!==0).length;
              const valorDiv=invItens.filter(i=>i.quantidade_contada!==null).reduce((s,i)=>s+Math.abs(Number(i.valor_diferenca||0)),0);
              return(
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
                  <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>PRODUTOS</div><div style={{fontSize:14,fontWeight:700,color:TX}}>{invItens.length}</div></div>
                  <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>CONTADOS</div><div style={{fontSize:14,fontWeight:700,color:contados===invItens.length?G:Y}}>{contados}/{invItens.length}</div></div>
                  <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>DIVERGÊNCIAS</div><div style={{fontSize:14,fontWeight:700,color:divs>0?Y:G}}>{divs}</div></div>
                  <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>VALOR DIF.</div><div style={{fontSize:14,fontWeight:700,color:valorDiv>0?Y:G}}>{fmtR(valorDiv)}</div></div>
                </div>
              );
            })()}

            <div style={{background:BG3,borderRadius:8,overflow:"auto",maxHeight:400,marginBottom:12}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead style={{position:"sticky",top:0,background:BG3,zIndex:1}}>
                  <tr style={{borderBottom:`2px solid ${BD}`}}>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:9}}>Produto</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:9,width:100}}>Sistema</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:9,width:120}}>Contado</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:9,width:100}}>Diferença</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:9,width:100}}>Valor Dif.</th>
                  </tr>
                </thead>
                <tbody>
                  {invItens.map(it=>{
                    const sis=Number(it.quantidade_sistema)||0;
                    const cont=it.quantidade_contada;
                    const dif=cont===null||cont===undefined?null:Number(cont)-sis;
                    return(
                      <tr key={it.id} style={{borderBottom:`0.5px solid ${BD}`,background:dif===null?"transparent":dif===0?G+"06":Y+"06"}}>
                        <td style={{padding:"6px 8px"}}>
                          <div style={{fontWeight:500,color:TX,fontSize:10}}>{it.produto?.nome}</div>
                          {it.produto?.codigo&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{it.produto.codigo}</div>}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",color:TXM,fontSize:10}}>{fmtQ(sis)} {it.produto?.unidade||''}</td>
                        <td style={{padding:"6px 8px",textAlign:"right"}}>
                          {invAtivo.status==='fechado'?(
                            <span style={{color:TX,fontWeight:600}}>{cont!==null?fmtQ(cont):'—'}</span>
                          ):(
                            <input type="number" step="0.001" value={cont??''} onChange={e=>atualizarContagem(it.id,parseFloat(e.target.value)||0)} placeholder="—" style={{...inp,padding:"4px 6px",textAlign:"right",fontSize:10}}/>
                          )}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:dif===null?TXD:dif===0?G:dif>0?B:R}}>
                          {dif===null?'—':dif===0?'✓':(dif>0?'+':'')+fmtQ(dif)}
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right",color:TXM,fontSize:10}}>
                          {it.valor_diferenca&&Number(it.valor_diferenca)!==0?fmtR(Math.abs(Number(it.valor_diferenca))):'—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {invAtivo.status!=='fechado'&&(
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowInventario(false)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Continuar Depois</button>
                <button onClick={fecharInventario} style={{padding:"10px 24px",borderRadius:8,background:G,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>✅ Fechar Inventário (Aplicar Ajustes)</button>
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Estoque v1.0 · Custo Médio Ponderado · Sprint 3.2</div>
    </div>
  );
}
