"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B";

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';
const hoje=()=>new Date().toISOString().slice(0,10);

const STATUS_CFG:Record<string,{cor:string;label:string}>={
  pendente:  {cor:Y, label:"Pendente"},
  aberto:    {cor:Y, label:"Aberto"},
  pago:      {cor:G, label:"Pago"},
  recebido:  {cor:G, label:"Recebido"},
  cancelado: {cor:TXD,label:"Cancelado"},
  atrasado:  {cor:R, label:"Atrasado"},
};

export default function ContasPage(){
  const { companyIds, selInfo, companies, loading: loadingCompanies } = useCompanyIds();
  const [lancamentos,setLancamentos]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroTipo,setFiltroTipo]=useState<"todos"|"receita"|"despesa">("todos");
  const [filtroStatus,setFiltroStatus]=useState<"todos"|"pendente"|"pago"|"atrasado">("pendente");
  const [msg,setMsg]=useState("");
  const [contasBancarias,setContasBancarias]=useState<any[]>([]);
  
  // Seleção em lote
  const [selecionados,setSelecionados]=useState<Set<string>>(new Set());
  const [showBaixa,setShowBaixa]=useState(false);
  const [baixaData,setBaixaData]=useState(hoje());
  const [baixaConta,setBaixaConta]=useState("");
  const [baixaForma,setBaixaForma]=useState("transferencia");
  const [showVencimento,setShowVencimento]=useState(false);
  const [novoVencimento,setNovoVencimento]=useState("");
  const [processando,setProcessando]=useState(false);

  useEffect(()=>{
    if(companyIds.length>0){
      loadData();
    }
  },[companyIds.join(',')]); // Recarrega quando muda empresa

  const loadData=async()=>{
    if(companyIds.length===0)return;
    setLoading(true);
    const hj=hoje();
    
    // Lançamentos (usa IN pra consolidar múltiplas empresas)
    const{data:lancs}=await supabase
      .from("erp_lancamentos")
      .select("*")
      .in("company_id",companyIds)
      .order("data_vencimento",{ascending:true})
      .limit(500);
    
    // Marca atrasados
    const comStatus=(lancs||[]).map((l:any)=>{
      if(['pendente','aberto'].includes(l.status)&&l.data_vencimento<hj){
        return{...l,_status_calc:'atrasado'};
      }
      return{...l,_status_calc:l.status};
    });
    setLancamentos(comStatus);
    
    // Contas bancárias (tenta carregar, mas não falha se tabela não existir)
    try{
      const{data:bancos}=await supabase
        .from("erp_banco_contas")
        .select("*")
        .in("company_id",companyIds)
        .eq("ativo",true);
      setContasBancarias(bancos||[]);
    }catch{}
    
    setLoading(false);
  };

  const filtrados=useMemo(()=>{
    let r=lancamentos;
    if(filtroTipo!=='todos'){
      if(filtroTipo==='receita')r=r.filter(l=>['receita','entrada','receber'].includes(l.tipo));
      else r=r.filter(l=>['despesa','saida','pagar'].includes(l.tipo));
    }
    if(filtroStatus!=='todos'){
      if(filtroStatus==='pendente')r=r.filter(l=>['pendente','aberto'].includes(l.status)&&l._status_calc!=='atrasado');
      else if(filtroStatus==='atrasado')r=r.filter(l=>l._status_calc==='atrasado');
      else r=r.filter(l=>l.status===filtroStatus);
    }
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(l=>
        (l.descricao||'').toLowerCase().includes(b)||
        (l.cliente_nome||'').toLowerCase().includes(b)||
        (l.fornecedor_nome||'').toLowerCase().includes(b)
      );
    }
    return r;
  },[lancamentos,filtroTipo,filtroStatus,busca]);

  // KPIs
  const kpis=useMemo(()=>{
    const pend=lancamentos.filter(l=>['pendente','aberto'].includes(l.status));
    const atras=pend.filter(l=>l._status_calc==='atrasado');
    const aReceber=pend.filter(l=>['receita','entrada','receber'].includes(l.tipo)).reduce((s,l)=>s+Number(l.valor||0),0);
    const aPagar=pend.filter(l=>['despesa','saida','pagar'].includes(l.tipo)).reduce((s,l)=>s+Number(l.valor||0),0);
    const atrasadoR=atras.filter(l=>['receita','entrada','receber'].includes(l.tipo)).reduce((s,l)=>s+Number(l.valor||0),0);
    const atrasadoP=atras.filter(l=>['despesa','saida','pagar'].includes(l.tipo)).reduce((s,l)=>s+Number(l.valor||0),0);
    return{aReceber,aPagar,atrasadoR,atrasadoP,totalPend:pend.length,totalAtras:atras.length};
  },[lancamentos]);

  const toggleSel=(id:string)=>{
    const n=new Set(selecionados);
    if(n.has(id))n.delete(id);else n.add(id);
    setSelecionados(n);
  };

  const selAll=()=>{
    if(selecionados.size===filtrados.length)setSelecionados(new Set());
    else setSelecionados(new Set(filtrados.map(l=>l.id)));
  };

  const baixarLote=async()=>{
    if(selecionados.size===0)return;
    setProcessando(true);
    try{
      const{data,error}=await supabase.rpc('batch_baixa_titulos',{
        p_titulos_ids:Array.from(selecionados),
        p_data_pagamento:baixaData,
        p_banco_conta_id:baixaConta||null,
        p_forma_pagamento:baixaForma,
      });
      if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
      setMsg(`✅ ${selecionados.size} título(s) baixado(s)`);
      setSelecionados(new Set());
      setShowBaixa(false);
      loadData();
    }catch(e:any){setMsg("❌ "+e.message);}
    setProcessando(false);
    setTimeout(()=>setMsg(""),4000);
  };

  const cancelarLote=async()=>{
    if(selecionados.size===0)return;
    if(!confirm(`Cancelar ${selecionados.size} título(s)?`))return;
    setProcessando(true);
    try{
      const{error}=await supabase.rpc('batch_cancelar_titulos',{p_titulos_ids:Array.from(selecionados)});
      if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
      setMsg(`✅ ${selecionados.size} título(s) cancelado(s)`);
      setSelecionados(new Set());
      loadData();
    }catch(e:any){setMsg("❌ "+e.message);}
    setProcessando(false);
    setTimeout(()=>setMsg(""),3000);
  };

  const alterarVencimentoLote=async()=>{
    if(selecionados.size===0||!novoVencimento)return;
    setProcessando(true);
    try{
      const{error}=await supabase.rpc('batch_alterar_vencimento',{
        p_titulos_ids:Array.from(selecionados),
        p_novo_vencimento:novoVencimento,
      });
      if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
      setMsg(`✅ Vencimento alterado para ${fmtD(novoVencimento)}`);
      setSelecionados(new Set());
      setShowVencimento(false);
      loadData();
    }catch(e:any){setMsg("❌ "+e.message);}
    setProcessando(false);
    setTimeout(()=>setMsg(""),3000);
  };

  const exportarCSV=()=>{
    const headers=["Data Vencimento","Tipo","Descrição","Cliente/Fornecedor","Valor","Status"];
    const rows=filtrados.map(l=>[
      l.data_vencimento,
      l.tipo,
      l.descricao,
      l.cliente_nome||l.fornecedor_nome||'',
      l.valor,
      l.status,
    ]);
    const csv=[headers,...rows].map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download=`contas_${hoje()}.csv`;
    a.click();
  };

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  // Adiciona badge de CNPJ de origem quando for consolidado/grupo
  const showCompanyColumn=selInfo.isGroup;

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{marginBottom:16}}>
        <div style={{fontSize:22,fontWeight:700,color:TX,fontFamily:"var(--ps-font-display,serif)"}}>💰 Contas a Pagar e Receber</div>
        <div style={{fontSize:11,color:TXD,display:"flex",gap:8,alignItems:"center"}}>
          <span>
            {selInfo.tipo==='consolidado'?'📊 Consolidado · ':selInfo.tipo==='grupo'?'📁 Grupo · ':'🏢 '}
            <strong>{selInfo.nome}</strong>
            {selInfo.isGroup&&` (${selInfo.count} empresas)`}
          </span>
          <span>·</span>
          <span>Baixa em lote · Alteração de vencimento · Exportação</span>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":R+"15",border:`1px solid ${msg.startsWith("✅")?G:R}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:R,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:10,marginBottom:16}}>
        <div style={{background:BG2,borderRadius:10,padding:14,border:`1px solid ${BD}`}}>
          <div style={{fontSize:10,color:TXD,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>A Receber</div>
          <div style={{fontSize:20,fontWeight:700,color:G,marginTop:4,fontFamily:"var(--ps-font-mono,monospace)"}}>{fmtR(kpis.aReceber)}</div>
          {kpis.atrasadoR>0&&<div style={{fontSize:10,color:R,marginTop:2}}>⚠️ {fmtR(kpis.atrasadoR)} atrasado</div>}
        </div>
        <div style={{background:BG2,borderRadius:10,padding:14,border:`1px solid ${BD}`}}>
          <div style={{fontSize:10,color:TXD,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>A Pagar</div>
          <div style={{fontSize:20,fontWeight:700,color:R,marginTop:4,fontFamily:"var(--ps-font-mono,monospace)"}}>{fmtR(kpis.aPagar)}</div>
          {kpis.atrasadoP>0&&<div style={{fontSize:10,color:R,marginTop:2}}>⚠️ {fmtR(kpis.atrasadoP)} atrasado</div>}
        </div>
        <div style={{background:BG2,borderRadius:10,padding:14,border:`1px solid ${BD}`}}>
          <div style={{fontSize:10,color:TXD,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>Saldo Projetado</div>
          <div style={{fontSize:20,fontWeight:700,color:kpis.aReceber-kpis.aPagar>=0?G:R,marginTop:4,fontFamily:"var(--ps-font-mono,monospace)"}}>{fmtR(kpis.aReceber-kpis.aPagar)}</div>
        </div>
        <div style={{background:BG2,borderRadius:10,padding:14,border:`1px solid ${BD}`}}>
          <div style={{fontSize:10,color:TXD,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>Pendentes / Atrasados</div>
          <div style={{fontSize:20,fontWeight:700,color:kpis.totalAtras>0?Y:B,marginTop:4}}>{kpis.totalPend} / <span style={{color:R}}>{kpis.totalAtras}</span></div>
        </div>
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:200}}>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="🔍 Buscar por descrição, cliente, fornecedor..." style={inp}/>
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {[
            {v:'todos',l:'Todos'},
            {v:'receita',l:'💰 Receitas'},
            {v:'despesa',l:'💸 Despesas'},
          ].map(f=>(
            <button key={f.v} onClick={()=>setFiltroTipo(f.v as any)} style={{padding:"6px 12px",borderRadius:6,fontSize:10,border:`1px solid ${filtroTipo===f.v?GO:BD}`,background:filtroTipo===f.v?GO+"12":"transparent",color:filtroTipo===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroTipo===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {[
            {v:'pendente',l:'Pendentes'},
            {v:'atrasado',l:'⚠️ Atrasados'},
            {v:'pago',l:'✅ Pagos'},
            {v:'todos',l:'Todos'},
          ].map(f=>(
            <button key={f.v} onClick={()=>setFiltroStatus(f.v as any)} style={{padding:"6px 12px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===f.v?GO:BD}`,background:filtroStatus===f.v?GO+"12":"transparent",color:filtroStatus===f.v?GO:TXM,cursor:"pointer",fontWeight:filtroStatus===f.v?600:400}}>{f.l}</button>
          ))}
        </div>
        <button onClick={exportarCSV} style={{padding:"8px 14px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TXM,fontSize:11,cursor:"pointer"}}>📥 CSV</button>
      </div>

      {/* Barra de ações em lote */}
      {selecionados.size>0&&(
        <div style={{background:GO+"12",border:`1px solid ${GO}`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,fontWeight:600,color:GO}}>{selecionados.size} selecionado(s)</span>
          <button onClick={()=>setShowBaixa(true)} style={{padding:"6px 14px",borderRadius:6,background:G,color:"#FFF",fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>✅ Baixar</button>
          <button onClick={()=>setShowVencimento(true)} style={{padding:"6px 14px",borderRadius:6,background:Y,color:"#FFF",fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>📅 Alterar Vencimento</button>
          <button onClick={cancelarLote} style={{padding:"6px 14px",borderRadius:6,background:R,color:"#FFF",fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>❌ Cancelar</button>
          <button onClick={()=>setSelecionados(new Set())} style={{padding:"6px 14px",borderRadius:6,background:"transparent",color:TXM,fontSize:11,border:`1px solid ${BD}`,cursor:"pointer"}}>Limpar seleção</button>
        </div>
      )}

      {/* Tabela */}
      {loading||loadingCompanies?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
          {filtrados.length===0?(
            <div style={{padding:40,textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:8}}>💼</div>
              <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum lançamento encontrado</div>
              <div style={{fontSize:11,color:TXD}}>Ajuste os filtros ou importe dados do Omie/ContaAzul</div>
            </div>
          ):(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                <th style={{padding:"8px",textAlign:"center",width:32}}>
                  <input type="checkbox" checked={selecionados.size===filtrados.length&&filtrados.length>0} onChange={selAll}/>
                </th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Venc.</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Descrição</th>
                <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente / Fornecedor</th>
                {showCompanyColumn&&<th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Empresa</th>}
                <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10}}>Valor</th>
                <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10}}>Status</th>
              </tr></thead>
              <tbody>
                {filtrados.map(l=>{
                  const isReceita=['receita','entrada','receber'].includes(l.tipo);
                  const st=l._status_calc||l.status;
                  const cfg=STATUS_CFG[st]||STATUS_CFG.pendente;
                  const empNome=companies.find((c:any)=>c.id===l.company_id);
                  return(
                    <tr key={l.id} style={{borderBottom:`0.5px solid ${BD}`,background:selecionados.has(l.id)?GO+"08":"transparent"}}>
                      <td style={{padding:"6px 8px",textAlign:"center"}}>
                        <input type="checkbox" checked={selecionados.has(l.id)} onChange={()=>toggleSel(l.id)} disabled={!['pendente','aberto'].includes(l.status)}/>
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center",color:TXM,fontFamily:"var(--ps-font-mono,monospace)"}}>{fmtD(l.data_vencimento)}</td>
                      <td style={{padding:"6px 8px",color:TX,fontWeight:500}}>{l.descricao}</td>
                      <td style={{padding:"6px 8px",color:TXM}}>{l.cliente_nome||l.fornecedor_nome||'—'}</td>
                      {showCompanyColumn&&<td style={{padding:"6px 8px",color:TXM,fontSize:10}}>{empNome?.nome_fantasia||empNome?.razao_social||'—'}</td>}
                      <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:isReceita?G:R,fontFamily:"var(--ps-font-mono,monospace)"}}>
                        {isReceita?'+':'−'} {fmtR(l.valor)}
                      </td>
                      <td style={{padding:"6px 8px",textAlign:"center"}}>
                        <span style={{fontSize:9,padding:"3px 8px",borderRadius:4,background:cfg.cor+"15",color:cfg.cor,fontWeight:600}}>{cfg.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal Baixa */}
      {showBaixa&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowBaixa(false)}>
          <div style={{background:BG2,borderRadius:14,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:G,marginBottom:14,fontFamily:"var(--ps-font-display,serif)"}}>✅ Baixar {selecionados.size} título(s)</div>
            <div style={{display:"grid",gap:10,marginBottom:16}}>
              <div><div style={{fontSize:11,color:TXD,marginBottom:4}}>Data do Pagamento</div>
                <input type="date" value={baixaData} onChange={e=>setBaixaData(e.target.value)} style={inp}/></div>
              {contasBancarias.length>0&&(
                <div><div style={{fontSize:11,color:TXD,marginBottom:4}}>Conta Bancária</div>
                  <select value={baixaConta} onChange={e=>setBaixaConta(e.target.value)} style={inp}>
                    <option value="">Sem conta específica</option>
                    {contasBancarias.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select></div>
              )}
              <div><div style={{fontSize:11,color:TXD,marginBottom:4}}>Forma</div>
                <select value={baixaForma} onChange={e=>setBaixaForma(e.target.value)} style={inp}>
                  <option value="transferencia">Transferência</option>
                  <option value="pix">PIX</option>
                  <option value="boleto">Boleto</option>
                  <option value="dinheiro">Dinheiro</option>
                  <option value="cartao">Cartão</option>
                </select></div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowBaixa(false)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={baixarLote} disabled={processando} style={{padding:"10px 24px",borderRadius:8,background:G,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>{processando?"⏳":"Confirmar Baixa"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Vencimento */}
      {showVencimento&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowVencimento(false)}>
          <div style={{background:BG2,borderRadius:14,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:Y,marginBottom:14,fontFamily:"var(--ps-font-display,serif)"}}>📅 Alterar vencimento de {selecionados.size} título(s)</div>
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,color:TXD,marginBottom:4}}>Novo Vencimento</div>
              <input type="date" value={novoVencimento} onChange={e=>setNovoVencimento(e.target.value)} style={inp}/>
            </div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:16}}>
              {[{d:7,l:"+7d"},{d:15,l:"+15d"},{d:30,l:"+30d"},{d:60,l:"+60d"},{d:90,l:"+90d"}].map(o=>(
                <button key={o.d} onClick={()=>{const d=new Date();d.setDate(d.getDate()+o.d);setNovoVencimento(d.toISOString().slice(0,10));}} style={{padding:"4px 10px",borderRadius:4,background:BG3,color:TXM,border:`1px solid ${BD}`,fontSize:10,cursor:"pointer"}}>{o.l}</button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowVencimento(false)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={alterarVencimentoLote} disabled={processando||!novoVencimento} style={{padding:"10px 24px",borderRadius:8,background:Y,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>{processando?"⏳":"Confirmar"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão · Contas v2.0 · Consolidado/Grupo · Sprint 1.4</div>
    </div>
  );
}
