"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Extrato = {
  id:string; data_transacao:string; valor:number; tipo:string;
  descricao:string; descricao_limpa:string; status:string;
  lancamento_id:string; score_match:number;
  banco_conta_id:string; arquivo_origem:string;
};

type BancoConta = {
  id:string; nome:string; banco:string; agencia:string; conta:string;
  saldo_atual:number; cor:string; ativo:boolean; principal:boolean;
};

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}> = {
  pendente:   {cor:Y, icon:"❓", label:"Pendente"},
  conciliado: {cor:G, icon:"✅", label:"Conciliado"},
  ignorado:   {cor:TXD,icon:"🚫",label:"Ignorado"},
  divergente: {cor:R, icon:"⚠️",label:"Divergente"},
};

const fmtR=(v:any)=>`${Number(v)<0?'- ':''}R$ ${Math.abs(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';

export default function ConciliacaoPage(){
  const [extratos,setExtratos]=useState<Extrato[]>([]);
  const [contas,setContas]=useState<BancoConta[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [contaSel,setContaSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [filtroStatus,setFiltroStatus]=useState("pendente");
  const [busca,setBusca]=useState("");
  const [msg,setMsg]=useState("");
  const [uploading,setUploading]=useState(false);
  const [matchExtrato,setMatchExtrato]=useState<Extrato|null>(null);
  const [matches,setMatches]=useState<any[]>([]);
  const [showNovaConta,setShowNovaConta]=useState(false);
  const [novaConta,setNovaConta]=useState({nome:'',banco:'',banco_codigo:'',agencia:'',conta:'',saldo_inicial:0,cor:'#3B82F6',principal:false});

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadContas();loadExtratos();}},[sel,contaSel,filtroStatus]);

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
    const{data}=await supabase.from("erp_banco_contas").select("*").eq("company_id",sel).eq("ativo",true).order("principal",{ascending:false});
    if(data)setContas(data);
  };

  const loadExtratos=async()=>{
    setLoading(true);
    let q=supabase.from("erp_extrato").select("*").eq("company_id",sel);
    if(contaSel)q=q.eq("banco_conta_id",contaSel);
    if(filtroStatus!=='todos')q=q.eq("status",filtroStatus);
    const{data,error}=await q.order("data_transacao",{ascending:false}).limit(200);
    if(data)setExtratos(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const criarConta=async()=>{
    if(!novaConta.nome.trim()){setMsg("❌ Nome obrigatório");return;}
    const{error}=await supabase.from("erp_banco_contas").insert({...novaConta,company_id:sel,saldo_atual:novaConta.saldo_inicial});
    if(error){setMsg("❌ "+error.message);return;}
    setMsg("✅ Conta criada!");
    setShowNovaConta(false);
    setNovaConta({nome:'',banco:'',banco_codigo:'',agencia:'',conta:'',saldo_inicial:0,cor:'#3B82F6',principal:false});
    loadContas();
    setTimeout(()=>setMsg(""),3000);
  };

  const uploadOFX=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];
    if(!file)return;
    if(!contaSel){setMsg("❌ Selecione uma conta bancária antes");return;}
    setUploading(true);
    const{data:{session}}=await supabase.auth.getSession();
    const fd=new FormData();
    fd.append("file",file);
    fd.append("company_id",sel);
    fd.append("banco_conta_id",contaSel);
    try{
      const r=await fetch("/api/ofx-upload",{method:"POST",body:fd,headers:{Authorization:`Bearer ${session?.access_token}`}});
      const d=await r.json();
      if(d.error){setMsg("❌ "+d.error);}
      else{setMsg(`✅ ${d.mensagem}`);loadExtratos();}
    }catch(err:any){setMsg("❌ "+err.message);}
    setUploading(false);
    e.target.value="";
    setTimeout(()=>setMsg(""),5000);
  };

  const buscarMatches=async(ext:Extrato)=>{
    setMatchExtrato(ext);
    const{data}=await supabase.rpc('buscar_matches_extrato',{p_extrato_id:ext.id,p_dias_tolerancia:5});
    setMatches(data||[]);
  };

  const conciliar=async(ext:Extrato,lancamentoId:string,score:number,automatico=false)=>{
    await supabase.from("erp_extrato").update({status:'conciliado',lancamento_id:lancamentoId,score_match:score,conciliado_em:new Date().toISOString()}).eq("id",ext.id);
    await supabase.from("erp_lancamentos").update({status:'pago',data_pagamento:ext.data_transacao}).eq("id",lancamentoId);
    await supabase.from("erp_conciliacoes").insert({company_id:sel,extrato_id:ext.id,lancamento_id:lancamentoId,acao:'conciliado',score,automatico});
    setMsg("✅ Conciliado com sucesso!");
    setMatchExtrato(null);
    loadExtratos();
    setTimeout(()=>setMsg(""),3000);
  };

  const ignorar=async(ext:Extrato)=>{
    await supabase.from("erp_extrato").update({status:'ignorado'}).eq("id",ext.id);
    setMsg("Transação ignorada");
    loadExtratos();
    setTimeout(()=>setMsg(""),2000);
  };

  const criarLancamento=async(ext:Extrato)=>{
    const tipo=ext.valor>0?'receita':'despesa';
    const{data,error}=await supabase.from("erp_lancamentos").insert({
      company_id:sel,
      tipo,
      descricao:ext.descricao||`Transação ${ext.tipo}`,
      valor:Math.abs(ext.valor),
      data_vencimento:ext.data_transacao,
      data_emissao:ext.data_transacao,
      data_pagamento:ext.data_transacao,
      status:'pago',
      origem:'conciliacao_ofx',
    }).select().single();
    if(error){setMsg("❌ "+error.message);return;}
    await supabase.from("erp_extrato").update({status:'conciliado',lancamento_id:data.id,score_match:100,conciliado_em:new Date().toISOString()}).eq("id",ext.id);
    setMsg("✅ Lançamento criado e conciliado");
    setMatchExtrato(null);
    loadExtratos();
    setTimeout(()=>setMsg(""),3000);
  };

  const conciliarAutomaticoTodos=async()=>{
    if(!confirm("Buscar matches automáticos para todas as transações pendentes? Apenas matches com score ≥ 90 serão conciliados automaticamente."))return;
    let conciliados=0;
    for(const ext of extratos.filter(e=>e.status==='pendente')){
      const{data}=await supabase.rpc('buscar_matches_extrato',{p_extrato_id:ext.id,p_dias_tolerancia:5});
      const top=data?.[0];
      if(top&&top.score>=90){
        await conciliar(ext,top.lancamento_id,top.score,true);
        conciliados++;
      }
    }
    setMsg(`✅ ${conciliados} transações conciliadas automaticamente`);
    loadExtratos();
  };

  const filtrados=useMemo(()=>{
    if(!busca.trim())return extratos;
    const b=busca.toLowerCase();
    return extratos.filter(e=>(e.descricao||'').toLowerCase().includes(b)||String(e.valor).includes(b));
  },[extratos,busca]);

  const kpis={
    pendentes: extratos.filter(e=>e.status==='pendente').length,
    conciliados: extratos.filter(e=>e.status==='conciliado').length,
    entradas: extratos.filter(e=>e.valor>0).reduce((s,e)=>s+Number(e.valor),0),
    saidas: extratos.filter(e=>e.valor<0).reduce((s,e)=>s+Number(e.valor),0),
  };

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🏦 Conciliação Bancária</div>
          <div style={{fontSize:11,color:TXD}}>Upload OFX · Match inteligente com IA · Conciliação automática</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* Contas bancárias */}
      <div style={{marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:600,color:TXD,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}>Contas Bancárias</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {contas.map(c=>(
            <div key={c.id} onClick={()=>setContaSel(c.id===contaSel?'':c.id)} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`2px solid ${contaSel===c.id?c.cor:BD}`,cursor:"pointer",minWidth:180,transition:"all 0.2s"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:c.cor}}></div>
                <div style={{fontSize:12,fontWeight:600,color:TX}}>{c.nome}{c.principal&&" ⭐"}</div>
              </div>
              <div style={{fontSize:9,color:TXD,marginTop:3}}>{c.banco||'—'} {c.agencia&&c.conta&&`· Ag ${c.agencia} / CC ${c.conta}`}</div>
              <div style={{fontSize:13,color:Number(c.saldo_atual)>=0?G:R,fontWeight:700,marginTop:4}}>{fmtR(c.saldo_atual)}</div>
            </div>
          ))}
          <button onClick={()=>setShowNovaConta(true)} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`2px dashed ${BD}`,cursor:"pointer",minWidth:120,display:"flex",alignItems:"center",justifyContent:"center",gap:6,color:TXM,fontSize:12}}>+ Nova Conta</button>
        </div>
      </div>

      {/* Modal Nova Conta */}
      {showNovaConta&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowNovaConta(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:600,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>🏦 Nova Conta Bancária</div>
              <button onClick={()=>setShowNovaConta(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome de referência *</div>
                <input value={novaConta.nome} onChange={e=>setNovaConta({...novaConta,nome:e.target.value})} placeholder="Ex: BTG CC Principal" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Banco</div>
                <input value={novaConta.banco} onChange={e=>setNovaConta({...novaConta,banco:e.target.value})} placeholder="Ex: BTG Pactual" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Código</div>
                <input value={novaConta.banco_codigo} onChange={e=>setNovaConta({...novaConta,banco_codigo:e.target.value})} placeholder="208" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Agência</div>
                <input value={novaConta.agencia} onChange={e=>setNovaConta({...novaConta,agencia:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Conta</div>
                <input value={novaConta.conta} onChange={e=>setNovaConta({...novaConta,conta:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Saldo Inicial (R$)</div>
                <input type="number" step="0.01" value={novaConta.saldo_inicial||''} onChange={e=>setNovaConta({...novaConta,saldo_inicial:parseFloat(e.target.value)||0})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cor</div>
                <input type="color" value={novaConta.cor} onChange={e=>setNovaConta({...novaConta,cor:e.target.value})} style={{...inp,padding:4,height:38}}/></div>
              <div style={{gridColumn:"span 2"}}>
                <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:TX,cursor:"pointer"}}>
                  <input type="checkbox" checked={novaConta.principal} onChange={e=>setNovaConta({...novaConta,principal:e.target.checked})} style={{width:16,height:16}}/>
                  ⭐ Conta principal
                </label>
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowNovaConta(false)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={criarConta} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>Criar Conta</button>
            </div>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Pendentes",v:String(kpis.pendentes),c:Y,icon:"❓"},
          {l:"Conciliados",v:String(kpis.conciliados),c:G,icon:"✅"},
          {l:"Total Entradas",v:fmtR(kpis.entradas),c:G,icon:"💰"},
          {l:"Total Saídas",v:fmtR(kpis.saidas),c:R,icon:"💸"},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{k.icon} {k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Upload e ações */}
      {contaSel&&(
        <div style={{background:BG2,borderRadius:10,padding:14,marginBottom:16,border:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:11,fontWeight:600,color:TX}}>Importar Extrato</div>
            <div style={{fontSize:10,color:TXD}}>Arquivo OFX do seu internet banking (Bradesco, Itaú, BB, Santander, Sicoob, BTG, Inter, Nubank...)</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <label style={{padding:"10px 16px",borderRadius:8,background:B+"15",color:B,fontSize:12,fontWeight:600,border:`1px solid ${B}40`,cursor:uploading?"wait":"pointer",opacity:uploading?0.5:1}}>
              {uploading?'Processando...':'📤 Upload OFX'}
              <input type="file" accept=".ofx" onChange={uploadOFX} disabled={uploading} style={{display:"none"}}/>
            </label>
            {kpis.pendentes>0&&<button onClick={conciliarAutomaticoTodos} style={{padding:"10px 16px",borderRadius:8,background:G+"15",color:G,fontSize:12,fontWeight:600,border:`1px solid ${G}40`,cursor:"pointer"}}>🤖 Conciliar Automaticamente</button>}
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200,position:"relative"}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por descrição ou valor..." style={{...inp,paddingLeft:32}}/>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
        </div>
        <div style={{display:"flex",gap:4}}>
          <button onClick={()=>setFiltroStatus("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus==="todos"?GO:BD}`,background:filtroStatus==="todos"?GO+"12":"transparent",color:filtroStatus==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroStatus==="todos"?600:400}}>Todos</button>
          {Object.entries(STATUS_CFG).map(([k,cfg])=>(
            <button key={k} onClick={()=>setFiltroStatus(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===k?cfg.cor:BD}`,background:filtroStatus===k?cfg.cor+"12":"transparent",color:filtroStatus===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroStatus===k?600:400}}>{cfg.icon} {cfg.label}</button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>🏦</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>{contas.length===0?'Cadastre uma conta bancária primeiro':contaSel?'Nenhum extrato nesta conta':'Selecione uma conta bancária'}</div>
              <div style={{fontSize:11,color:TXD}}>{contas.length===0?'Clique em "+ Nova Conta" acima.':contaSel?'Faça upload de um arquivo OFX do seu banco.':'Clique em uma conta acima.'}</div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:90}}>Data</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Descrição</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:130}}>Valor</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:110}}>Status</th>
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Ações</th>
              </tr></thead>
              <tbody>
                {filtrados.map(e=>{
                  const cfg=STATUS_CFG[e.status]||STATUS_CFG.pendente;
                  return(
                    <tr key={e.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                      <td style={{padding:"8px",textAlign:"center",color:TXM,fontSize:10}}>{fmtD(e.data_transacao)}</td>
                      <td style={{padding:"8px"}}>
                        <div style={{fontWeight:500,color:TX}}>{e.descricao}</div>
                        {e.tipo&&<div style={{fontSize:9,color:TXD}}>{e.tipo}</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"right",color:e.valor>=0?G:R,fontWeight:700}}>{fmtR(e.valor)}</td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                        {e.score_match>0&&<div style={{fontSize:8,color:TXD,marginTop:2}}>Score: {e.score_match}%</div>}
                      </td>
                      <td style={{padding:"8px",textAlign:"right"}}>
                        {e.status==='pendente'&&(
                          <div style={{display:"flex",gap:3,justifyContent:"flex-end"}}>
                            <button onClick={()=>buscarMatches(e)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>🔗 Conciliar</button>
                            <button onClick={()=>ignorar(e)} style={{fontSize:10,padding:"4px 8px",borderRadius:6,background:TXD+"15",color:TXD,border:`1px solid ${TXD}40`,cursor:"pointer"}}>Ignorar</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal: Buscar Match */}
      {matchExtrato&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setMatchExtrato(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div>
                <div style={{fontSize:18,fontWeight:700,color:TX}}>🔗 Conciliar Transação</div>
                <div style={{fontSize:11,color:TXD}}>Encontre o lançamento correspondente ou crie um novo</div>
              </div>
              <button onClick={()=>setMatchExtrato(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {/* Transação */}
            <div style={{background:BG3,borderRadius:10,padding:14,marginBottom:16,borderLeft:`4px solid ${matchExtrato.valor>=0?G:R}`}}>
              <div style={{fontSize:11,color:TXD}}>TRANSAÇÃO DO BANCO</div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:4}}>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:TX}}>{matchExtrato.descricao}</div>
                  <div style={{fontSize:10,color:TXD}}>{fmtD(matchExtrato.data_transacao)}</div>
                </div>
                <div style={{fontSize:22,fontWeight:700,color:matchExtrato.valor>=0?G:R}}>{fmtR(matchExtrato.valor)}</div>
              </div>
            </div>

            {/* Matches */}
            <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:8}}>🎯 Lançamentos Sugeridos ({matches.length})</div>
            {matches.length===0?(
              <div style={{background:Y+"10",borderRadius:10,padding:20,textAlign:"center",border:`1px dashed ${Y}40`,marginBottom:16}}>
                <div style={{fontSize:30,marginBottom:6}}>🤔</div>
                <div style={{fontSize:13,fontWeight:600,color:TX}}>Nenhum lançamento compatível encontrado</div>
                <div style={{fontSize:10,color:TXD,marginBottom:12}}>Você pode criar um novo lançamento agora</div>
                <button onClick={()=>criarLancamento(matchExtrato)} style={{padding:"10px 20px",borderRadius:8,background:GO,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Criar Lançamento Novo</button>
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
                {matches.map(m=>(
                  <div key={m.lancamento_id} style={{background:BG3,borderRadius:10,padding:12,display:"flex",justifyContent:"space-between",alignItems:"center",border:`1px solid ${m.score>=90?G:m.score>=70?Y:BD}`}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:500,color:TX}}>{m.descricao}</div>
                      <div style={{fontSize:10,color:TXD}}>{fmtD(m.data_vencimento)}</div>
                      <div style={{fontSize:9,marginTop:2}}>
                        <span style={{padding:"2px 8px",borderRadius:4,background:m.score>=90?G+"20":m.score>=70?Y+"20":TXD+"20",color:m.score>=90?G:m.score>=70?Y:TXD,fontWeight:600}}>Score: {Math.round(m.score)}%</span>
                      </div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{fontSize:15,fontWeight:700,color:G}}>{fmtR(m.valor)}</div>
                      <button onClick={()=>conciliar(matchExtrato,m.lancamento_id,Number(m.score))} style={{padding:"6px 14px",borderRadius:6,background:G+"15",color:G,fontSize:11,fontWeight:600,border:`1px solid ${G}40`,cursor:"pointer"}}>✅ Parear</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{paddingTop:14,borderTop:`1px solid ${BD}`,display:"flex",gap:8,justifyContent:"space-between"}}>
              <button onClick={()=>criarLancamento(matchExtrato)} style={{padding:"8px 16px",borderRadius:8,background:B+"15",color:B,fontSize:11,fontWeight:600,border:`1px solid ${B}40`,cursor:"pointer"}}>+ Criar Lançamento Novo</button>
              <button onClick={()=>setMatchExtrato(null)} style={{padding:"8px 16px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:11,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Conciliação Bancária v1.0 · Parser OFX nativo · Match com IA</div>
    </div>
  );
}
