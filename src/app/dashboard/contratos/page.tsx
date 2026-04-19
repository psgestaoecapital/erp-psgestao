"use client";
import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Contrato={
  id:string;company_id:string;numero:string;
  cliente_id:string;cliente_nome:string;cliente_cnpj:string;cliente_email:string;
  tipo:string;nome:string;descricao:string;escopo:string;
  valor_mensal:number;valor_atual:number;
  data_inicio:string;data_fim:string;data_primeiro_vencimento:string;dia_vencimento:number;
  periodicidade:string;
  tipo_reajuste:string;reajuste_percentual:number;mes_reajuste:number;
  ultimo_reajuste_em:string;proximo_reajuste_em:string;
  forma_pagamento:string;status:string;
  data_encerramento:string;motivo_encerramento:string;
  responsavel:string;observacoes:string;
  ultimo_titulo_gerado_em:string;total_titulos_gerados:number;total_faturado:number;
  created_at:string;
};

const TIPOS_CONTRATO=[
  {v:'bpo_financeiro',l:'BPO Financeiro',icon:'💰'},
  {v:'consultoria',l:'Consultoria',icon:'📊'},
  {v:'assessoria_cvm',l:'Assessoria CVM',icon:'📈'},
  {v:'saas_erp',l:'SaaS / ERP',icon:'💻'},
  {v:'manutencao',l:'Manutenção',icon:'🔧'},
  {v:'academia',l:'Academia/Fitness',icon:'💪'},
  {v:'escola',l:'Escola/Curso',icon:'🎓'},
  {v:'clinica',l:'Clínica/Saúde',icon:'🏥'},
  {v:'limpeza',l:'Limpeza',icon:'🧹'},
  {v:'seguranca',l:'Segurança',icon:'🛡️'},
  {v:'ti',l:'TI/Infraestrutura',icon:'🖥️'},
  {v:'juridico',l:'Jurídico',icon:'⚖️'},
  {v:'contabilidade',l:'Contabilidade',icon:'📋'},
  {v:'outros',l:'Outros',icon:'📝'},
];

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}>={
  ativo:      {cor:G, icon:"✅", label:"Ativo"},
  suspenso:   {cor:Y, icon:"⏸️", label:"Suspenso"},
  encerrado:  {cor:TXD,icon:"🏁",label:"Encerrado"},
  cancelado:  {cor:R, icon:"❌", label:"Cancelado"},
};

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtRk=(v:any)=>{const n=Number(v)||0;if(Math.abs(n)>=1000)return`R$ ${(n/1000).toFixed(1)}k`;return`R$ ${n.toFixed(0)}`;};
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';
const fmtMes=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR",{month:'short',year:'2-digit'}):'—';
const hoje=()=>new Date().toISOString().slice(0,10);

export default function ContratosPage(){
  const [contratos,setContratos]=useState<Contrato[]>([]);
  const [companies,setCompanies]=useState<any[]>([]);
  const [clientes,setClientes]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [tab,setTab]=useState<'contratos'|'dashboard'|'acoes'>('dashboard');
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroStatus,setFiltroStatus]=useState("ativo");
  const [msg,setMsg]=useState("");
  
  const [metricas,setMetricas]=useState<any>(null);
  const [historico,setHistorico]=useState<any[]>([]);
  
  const [showNovo,setShowNovo]=useState(false);
  const [showDetalhe,setShowDetalhe]=useState<Contrato|null>(null);
  const [eventosDetalhe,setEventosDetalhe]=useState<any[]>([]);
  const [reajustesDetalhe,setReajustesDetalhe]=useState<any[]>([]);
  const [buscaCli,setBuscaCli]=useState("");
  const [novoContrato,setNovoContrato]=useState<any>({
    cliente_id:'',cliente_nome:'',cliente_cnpj:'',cliente_email:'',
    tipo:'bpo_financeiro',nome:'',descricao:'',escopo:'',
    valor_mensal:0,data_inicio:hoje(),data_fim:'',dia_vencimento:10,
    periodicidade:'mensal',tipo_reajuste:'ipca',reajuste_percentual:0,mes_reajuste:1,
    forma_pagamento:'boleto',
  });
  
  const [showReajuste,setShowReajuste]=useState<Contrato|null>(null);
  const [pctReajuste,setPctReajuste]=useState(0);
  const [processando,setProcessando]=useState(false);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadContratos();loadClientes();loadMetricas();}},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"||up?.role==="adm_investimentos"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    if(d.length>0){setCompanies(d);const s=(typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"")||"";const m=s?d.find((c:any)=>c.id===s):null;setSel(m?m.id:d[0].id);}
    setLoading(false);
  };

  const loadContratos=async()=>{
    setLoading(true);
    const{data,error}=await supabase.from("erp_contratos").select("*").eq("company_id",sel).order("data_inicio",{ascending:false});
    if(data)setContratos(data);
    if(error&&!error.message.includes('does not exist'))setMsg("Erro: "+error.message);
    setLoading(false);
  };

  const loadClientes=async()=>{
    const{data}=await supabase.from("erp_clientes").select("id,razao_social,nome_fantasia,nome,cpf_cnpj,email").eq("company_id",sel).eq("ativo",true).order("razao_social");
    if(data)setClientes(data);
  };

  const loadMetricas=async()=>{
    const[{data:m},{data:h}]=await Promise.all([
      supabase.rpc('calcular_metricas_saas',{p_company_id:sel}),
      supabase.rpc('historico_mrr',{p_company_id:sel,p_meses:12}),
    ]);
    if(m&&m[0])setMetricas(m[0]);
    if(h)setHistorico(h);
  };

  const criarContrato=async()=>{
    if(!novoContrato.cliente_nome||!novoContrato.nome||!novoContrato.valor_mensal){
      setMsg("❌ Preencha cliente, nome e valor");return;
    }
    const{data:{user}}=await supabase.auth.getUser();
    const{data:numero}=await supabase.rpc('next_contrato_numero',{p_company_id:sel});
    
    // Calcula primeiro vencimento
    const dataIni=new Date(novoContrato.data_inicio+'T00:00:00');
    const primeiroVenc=new Date(dataIni.getFullYear(),dataIni.getMonth(),novoContrato.dia_vencimento);
    if(primeiroVenc<dataIni)primeiroVenc.setMonth(primeiroVenc.getMonth()+1);
    
    // Calcula próximo reajuste
    const proxReaj=new Date(dataIni);
    proxReaj.setFullYear(proxReaj.getFullYear()+1);
    
    const{error}=await supabase.from("erp_contratos").insert({
      ...novoContrato,
      company_id:sel,
      numero,
      valor_atual:novoContrato.valor_mensal,
      data_primeiro_vencimento:primeiroVenc.toISOString().slice(0,10),
      proximo_reajuste_em:proxReaj.toISOString().slice(0,10),
      data_fim:novoContrato.data_fim||null,
      created_by:user?.id,
    });
    
    if(error){setMsg("❌ "+error.message);return;}
    setMsg(`✅ Contrato ${numero} criado com sucesso`);
    setShowNovo(false);
    setNovoContrato({cliente_id:'',cliente_nome:'',cliente_cnpj:'',cliente_email:'',tipo:'bpo_financeiro',nome:'',descricao:'',escopo:'',valor_mensal:0,data_inicio:hoje(),data_fim:'',dia_vencimento:10,periodicidade:'mensal',tipo_reajuste:'ipca',reajuste_percentual:0,mes_reajuste:1,forma_pagamento:'boleto'});
    setBuscaCli("");
    loadContratos();loadMetricas();
    setTimeout(()=>setMsg(""),3000);
  };

  const gerarTitulosMes=async()=>{
    if(!confirm(`Gerar títulos de ${new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'})} para todos os contratos ativos?`))return;
    setProcessando(true);
    const{data:{user}}=await supabase.auth.getUser();
    const{data,error}=await supabase.rpc('gerar_titulos_contratos_mes',{p_company_id:sel,p_usuario_id:user?.id});
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    const r=data?.[0];
    setMsg(`✅ ${r?.gerados||0} títulos gerados (${fmtR(r?.total_faturado)}) · ${r?.ja_existentes||0} já existiam`);
    setProcessando(false);
    loadContratos();loadMetricas();
    setTimeout(()=>setMsg(""),5000);
  };

  const aplicarReajuste=async()=>{
    if(!showReajuste||pctReajuste<=0)return;
    setProcessando(true);
    const{data:{user}}=await supabase.auth.getUser();
    const{error}=await supabase.rpc('aplicar_reajuste_contrato',{p_contrato_id:showReajuste.id,p_percentual:pctReajuste,p_usuario_id:user?.id});
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    setMsg(`✅ Reajuste de ${pctReajuste}% aplicado`);
    setShowReajuste(null);
    setPctReajuste(0);
    setProcessando(false);
    loadContratos();loadMetricas();
    setTimeout(()=>setMsg(""),3000);
  };

  const encerrarContrato=async(c:Contrato)=>{
    const motivo=prompt("Motivo do encerramento:");
    if(!motivo)return;
    await supabase.from("erp_contratos").update({
      status:'encerrado',
      data_encerramento:hoje(),
      motivo_encerramento:motivo,
    }).eq("id",c.id);
    await supabase.from("erp_contratos_eventos").insert({
      contrato_id:c.id,
      company_id:sel,
      evento:'encerrado',
      detalhe:'Motivo: '+motivo,
    });
    setMsg("✅ Contrato encerrado");
    setShowDetalhe(null);
    loadContratos();loadMetricas();
    setTimeout(()=>setMsg(""),3000);
  };

  const abrirDetalhe=async(c:Contrato)=>{
    setShowDetalhe(c);
    const[{data:ev},{data:rj}]=await Promise.all([
      supabase.from("erp_contratos_eventos").select("*").eq("contrato_id",c.id).order("created_at",{ascending:false}).limit(20),
      supabase.from("erp_contratos_reajustes").select("*").eq("contrato_id",c.id).order("data_reajuste",{ascending:false}),
    ]);
    setEventosDetalhe(ev||[]);
    setReajustesDetalhe(rj||[]);
  };

  const filtrados=useMemo(()=>{
    let r=contratos;
    if(filtroStatus!=='todos')r=r.filter(c=>c.status===filtroStatus);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(c=>(c.numero||'').toLowerCase().includes(b)||(c.cliente_nome||'').toLowerCase().includes(b)||(c.nome||'').toLowerCase().includes(b));
    }
    return r;
  },[contratos,filtroStatus,busca]);

  const clientesBusca=useMemo(()=>{
    if(!buscaCli.trim())return[];
    const b=buscaCli.toLowerCase();
    return clientes.filter(c=>(c.razao_social||'').toLowerCase().includes(b)||(c.nome_fantasia||'').toLowerCase().includes(b)||(c.cpf_cnpj||'').includes(b.replace(/\D/g,''))).slice(0,8);
  },[clientes,buscaCli]);

  // Próximas renovações e reajustes pendentes
  const proximasRenovacoes=useMemo(()=>{
    const hoje=new Date();
    const limite=new Date();
    limite.setDate(limite.getDate()+60);
    return contratos.filter(c=>c.status==='ativo'&&c.data_fim&&new Date(c.data_fim+'T00:00:00')>=hoje&&new Date(c.data_fim+'T00:00:00')<=limite).sort((a,b)=>a.data_fim.localeCompare(b.data_fim));
  },[contratos]);

  const reajustesPendentes=useMemo(()=>{
    const hoje=new Date();
    return contratos.filter(c=>c.status==='ativo'&&c.tipo_reajuste!=='nenhum'&&c.proximo_reajuste_em&&new Date(c.proximo_reajuste_em+'T00:00:00')<=hoje);
  },[contratos]);

  const gerandoEsteMes=useMemo(()=>{
    const mesAtual=new Date().toISOString().slice(0,7);
    return contratos.filter(c=>c.status==='ativo'&&(!c.ultimo_titulo_gerado_em||!c.ultimo_titulo_gerado_em.startsWith(mesAtual))).length;
  },[contratos]);

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  // Gráfico MRR
  const graficoMRR=useMemo(()=>{
    if(historico.length===0)return null;
    const W=900,H=180,PAD_L=60,PAD_R=20,PAD_T=15,PAD_B=35;
    const plotW=W-PAD_L-PAD_R,plotH=H-PAD_T-PAD_B;
    const maxMRR=Math.max(...historico.map((h:any)=>Number(h.mrr)),1);
    
    const xAt=(i:number)=>PAD_L+(plotW*i)/Math.max(historico.length-1,1);
    const yAt=(v:number)=>PAD_T+plotH-(v/maxMRR)*plotH;
    
    const path=historico.map((h:any,i:number)=>`${i===0?'M':'L'}${xAt(i)},${yAt(Number(h.mrr))}`).join(' ');
    
    return(
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto"}}>
        {[0,0.25,0.5,0.75,1].map((t,i)=>(
          <g key={i}>
            <line x1={PAD_L} y1={yAt(maxMRR*t)} x2={W-PAD_R} y2={yAt(maxMRR*t)} stroke={BD} strokeWidth={0.5} strokeDasharray="2 4"/>
            <text x={PAD_L-8} y={yAt(maxMRR*t)+3} fontSize={9} fill={TXD} textAnchor="end">{fmtRk(maxMRR*t)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={GO} strokeWidth={2.5}/>
        <path d={path+' L'+xAt(historico.length-1)+','+(PAD_T+plotH)+' L'+PAD_L+','+(PAD_T+plotH)+' Z'} fill={GO} opacity={0.1}/>
        {historico.map((h:any,i:number)=>(
          <g key={i}>
            <circle cx={xAt(i)} cy={yAt(Number(h.mrr))} r={3} fill={GO}/>
            {i%2===0&&<text x={xAt(i)} y={H-PAD_B+12} fontSize={9} fill={TXD} textAnchor="middle">{fmtMes(h.mes)}</text>}
          </g>
        ))}
      </svg>
    );
  },[historico]);

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🔄 Contratos Recorrentes</div>
          <div style={{fontSize:11,color:TXD}}>BPO · Consultoria · SaaS · Serviços mensais · Geração automática · MRR/Churn/LTV</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={selSt}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <button onClick={()=>setShowNovo(true)} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Novo Contrato</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,borderBottom:`1px solid ${BD}`}}>
        {[{k:'dashboard',l:'📊 Dashboard SaaS'},{k:'contratos',l:'📋 Contratos'},{k:'acoes',l:'⚡ Ações'}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k as any)} style={{padding:"10px 20px",fontSize:12,fontWeight:tab===t.k?700:500,background:"transparent",border:"none",color:tab===t.k?GO:TXM,borderBottom:`3px solid ${tab===t.k?GO:"transparent"}`,cursor:"pointer",marginBottom:-1}}>{t.l}</button>
        ))}
      </div>

      {/* TAB DASHBOARD SAAS */}
      {tab==='dashboard'&&(
        <>
          {metricas?(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>💎 MRR Mensal</div>
                  <div style={{fontSize:20,fontWeight:800,color:GO,marginTop:2,fontFamily:"monospace"}}>{fmtR(metricas.mrr)}</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>ARR: {fmtR(metricas.arr)}</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>👥 Clientes Ativos</div>
                  <div style={{fontSize:20,fontWeight:800,color:B,marginTop:2}}>{metricas.total_clientes_ativos}</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>Ticket: {fmtR(metricas.ticket_medio)}</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>📉 Churn Rate (12m)</div>
                  <div style={{fontSize:20,fontWeight:800,color:Number(metricas.churn_rate_12m)>10?R:Number(metricas.churn_rate_12m)>5?Y:G,marginTop:2}}>{Number(metricas.churn_rate_12m||0).toFixed(1)}%</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>LTV: {fmtR(metricas.ltv)}</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>📈 Novo MRR (30d)</div>
                  <div style={{fontSize:20,fontWeight:800,color:G,marginTop:2}}>+{fmtR(metricas.novo_mrr_30d)}</div>
                  <div style={{fontSize:9,color:R,marginTop:2}}>-{fmtR(metricas.churned_mrr_30d)} churn</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>📅 Renovações 60d</div>
                  <div style={{fontSize:20,fontWeight:800,color:metricas.proximas_renovacoes_60d>0?Y:G,marginTop:2}}>{metricas.proximas_renovacoes_60d}</div>
                </div>
              </div>

              {/* Gráfico de evolução MRR */}
              <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${BD}`}}>
                <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>📈 Evolução do MRR (últimos 12 meses)</div>
                {graficoMRR||<div style={{padding:40,textAlign:"center",color:TXD}}>Sem dados históricos ainda</div>}
              </div>

              {/* Split por tipo */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
                <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>💼 MRR por Tipo de Serviço</div>
                  {(()=>{
                    const porTipo:Record<string,{count:number,mrr:number}>={};
                    contratos.filter(c=>c.status==='ativo').forEach(c=>{
                      const t=c.tipo||'outros';
                      if(!porTipo[t])porTipo[t]={count:0,mrr:0};
                      porTipo[t].count++;
                      porTipo[t].mrr+=Number(c.valor_atual||c.valor_mensal);
                    });
                    const itens=Object.entries(porTipo).sort((a,b)=>b[1].mrr-a[1].mrr);
                    const maxMRR=Math.max(...itens.map(i=>i[1].mrr),1);
                    return itens.length===0?<div style={{padding:20,textAlign:"center",color:TXD,fontSize:11}}>Nenhum contrato ativo ainda</div>:(
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        {itens.map(([tipo,d]:any)=>{
                          const cfg=TIPOS_CONTRATO.find(t=>t.v===tipo);
                          return(
                            <div key={tipo}>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                                <span style={{color:TX,fontWeight:500}}>{cfg?.icon} {cfg?.l||tipo} ({d.count})</span>
                                <span style={{color:GO,fontWeight:700}}>{fmtR(d.mrr)}</span>
                              </div>
                              <div style={{background:BG3,height:8,borderRadius:4,overflow:"hidden"}}>
                                <div style={{width:(d.mrr/maxMRR)*100+"%",height:"100%",background:GO}}/>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>

                <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>🏆 Top 5 Clientes por MRR</div>
                  {(()=>{
                    const top=[...contratos].filter(c=>c.status==='ativo').sort((a,b)=>Number(b.valor_atual||b.valor_mensal)-Number(a.valor_atual||a.valor_mensal)).slice(0,5);
                    return top.length===0?<div style={{padding:20,textAlign:"center",color:TXD,fontSize:11}}>Nenhum contrato ativo</div>:(
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {top.map((c,i)=>(
                          <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:8,background:BG3,borderRadius:6}}>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              <div style={{fontSize:14,fontWeight:800,color:i===0?GO:TXD,minWidth:20}}>{i+1}</div>
                              <div>
                                <div style={{fontSize:11,fontWeight:600,color:TX}}>{c.cliente_nome}</div>
                                <div style={{fontSize:9,color:TXD}}>{c.nome}</div>
                              </div>
                            </div>
                            <div style={{fontSize:13,fontWeight:700,color:G,fontFamily:"monospace"}}>{fmtR(c.valor_atual||c.valor_mensal)}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          ):(
            <div style={{padding:40,textAlign:"center",color:TXD}}>Carregando métricas...</div>
          )}
        </>
      )}

      {/* TAB CONTRATOS */}
      {tab==='contratos'&&(
        <>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200,position:"relative"}}>
              <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por número, cliente, nome do contrato..." style={{...inp,paddingLeft:32}}/>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setFiltroStatus("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus==="todos"?GO:BD}`,background:filtroStatus==="todos"?GO+"12":"transparent",color:filtroStatus==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroStatus==="todos"?600:400}}>Todos</button>
              {Object.entries(STATUS_CFG).map(([k,cfg])=>(
                <button key={k} onClick={()=>setFiltroStatus(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===k?cfg.cor:BD}`,background:filtroStatus===k?cfg.cor+"12":"transparent",color:filtroStatus===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroStatus===k?600:400}}>{cfg.icon} {cfg.label}</button>
              ))}
            </div>
          </div>

          {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
              {filtrados.length===0?(
                <div style={{padding:40,textAlign:"center"}}>
                  <div style={{fontSize:40,marginBottom:8}}>🔄</div>
                  <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum contrato ainda</div>
                  <div style={{fontSize:11,color:TXD,marginBottom:16}}>Cadastre seus clientes BPO, de consultoria, SaaS, etc.</div>
                  <button onClick={()=>setShowNovo(true)} style={{padding:"10px 20px",borderRadius:8,background:GO,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Primeiro Contrato</button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente</th>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Contrato</th>
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:60}}>Venc</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:110}}>Valor Mensal</th>
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:110}}>Reajuste</th>
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:100}}>Status</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:80}}>Ações</th>
                  </tr></thead>
                  <tbody>
                    {filtrados.map(c=>{
                      const cfg=STATUS_CFG[c.status]||STATUS_CFG.ativo;
                      const tipoCfg=TIPOS_CONTRATO.find(t=>t.v===c.tipo);
                      return(
                        <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}`,cursor:"pointer"}} onClick={()=>abrirDetalhe(c)}>
                          <td style={{padding:"8px",fontFamily:"monospace",fontWeight:600,color:GO}}>{c.numero}</td>
                          <td style={{padding:"8px"}}>
                            <div style={{fontWeight:500,color:TX}}>{c.cliente_nome}</div>
                            {c.cliente_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{c.cliente_cnpj}</div>}
                          </td>
                          <td style={{padding:"8px"}}>
                            <div style={{fontSize:11,fontWeight:500,color:TX}}>{tipoCfg?.icon} {c.nome}</div>
                            <div style={{fontSize:9,color:TXD}}>{tipoCfg?.l||c.tipo} · {c.periodicidade}</div>
                          </td>
                          <td style={{padding:"8px",textAlign:"center",color:TXM,fontWeight:600}}>{c.dia_vencimento}</td>
                          <td style={{padding:"8px",textAlign:"right"}}>
                            <div style={{color:G,fontWeight:700}}>{fmtR(c.valor_atual||c.valor_mensal)}</div>
                            {Number(c.valor_atual)!==Number(c.valor_mensal)&&<div style={{fontSize:9,color:TXD}}>inicial: {fmtR(c.valor_mensal)}</div>}
                          </td>
                          <td style={{padding:"8px",textAlign:"center"}}>
                            {c.tipo_reajuste!=='nenhum'?(
                              <div>
                                <div style={{fontSize:10,color:TX,fontWeight:600}}>{c.tipo_reajuste.toUpperCase()}</div>
                                {c.proximo_reajuste_em&&<div style={{fontSize:9,color:TXD}}>{fmtD(c.proximo_reajuste_em)}</div>}
                              </div>
                            ):<span style={{fontSize:10,color:TXD}}>—</span>}
                          </td>
                          <td style={{padding:"8px",textAlign:"center"}}>
                            <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                          </td>
                          <td style={{padding:"8px",textAlign:"right"}} onClick={e=>e.stopPropagation()}>
                            <button onClick={()=>abrirDetalhe(c)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>Ver →</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* TAB AÇÕES */}
      {tab==='acoes'&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {/* Gerar títulos do mês */}
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:14,fontWeight:700,color:TX,marginBottom:8}}>⚡ Gerar Títulos do Mês</div>
            <div style={{fontSize:11,color:TXD,marginBottom:14}}>Cria lançamentos em Contas a Receber para todos os contratos ativos com vencimento neste mês.</div>
            <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:12}}>
              <div style={{fontSize:10,color:TXD,marginBottom:4}}>MÊS ATUAL</div>
              <div style={{fontSize:16,fontWeight:700,color:TX}}>{new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</div>
              <div style={{fontSize:11,color:TXM,marginTop:4}}><b>{gerandoEsteMes}</b> contrato(s) ainda não tiveram título gerado este mês</div>
            </div>
            <button onClick={gerarTitulosMes} disabled={processando||gerandoEsteMes===0} style={{width:"100%",padding:"12px",borderRadius:10,background:G,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:gerandoEsteMes===0?"not-allowed":"pointer",opacity:gerandoEsteMes===0?0.5:1}}>{processando?"⏳ Processando...":gerandoEsteMes===0?"✅ Tudo em dia":`💰 Gerar ${gerandoEsteMes} Título(s)`}</button>
          </div>

          {/* Reajustes pendentes */}
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:14,fontWeight:700,color:TX,marginBottom:8}}>📈 Reajustes Devidos</div>
            <div style={{fontSize:11,color:TXD,marginBottom:14}}>Contratos cujo aniversário de reajuste já passou.</div>
            {reajustesPendentes.length===0?(
              <div style={{background:G+"10",borderRadius:8,padding:16,textAlign:"center",fontSize:11,color:G,fontWeight:600,border:`1px solid ${G}30`}}>✅ Nenhum reajuste pendente</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {reajustesPendentes.map(c=>(
                  <div key={c.id} style={{background:BG3,borderRadius:8,padding:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:11,fontWeight:600,color:TX}}>{c.cliente_nome}</div>
                      <div style={{fontSize:9,color:TXD}}>{c.numero} · {c.tipo_reajuste.toUpperCase()} · devido desde {fmtD(c.proximo_reajuste_em)}</div>
                    </div>
                    <button onClick={()=>{setShowReajuste(c);setPctReajuste(Number(c.reajuste_percentual)||5);}} style={{padding:"6px 12px",borderRadius:6,background:Y+"15",color:Y,fontSize:10,fontWeight:600,border:`1px solid ${Y}40`,cursor:"pointer"}}>Aplicar</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Próximas renovações */}
          <div style={{gridColumn:"span 2",background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:14,fontWeight:700,color:TX,marginBottom:8}}>📅 Próximas Renovações (60 dias)</div>
            {proximasRenovacoes.length===0?(
              <div style={{background:G+"10",borderRadius:8,padding:16,textAlign:"center",fontSize:11,color:G,fontWeight:600,border:`1px solid ${G}30`}}>✅ Nenhum contrato vencendo nos próximos 60 dias</div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                {proximasRenovacoes.map(c=>{
                  const dias=Math.ceil((new Date(c.data_fim+'T00:00:00').getTime()-Date.now())/(1000*60*60*24));
                  return(
                    <div key={c.id} style={{background:BG3,borderRadius:8,padding:12,borderLeft:`4px solid ${dias<=15?R:dias<=30?Y:B}`}}>
                      <div style={{fontSize:11,fontWeight:600,color:TX}}>{c.cliente_nome}</div>
                      <div style={{fontSize:10,color:TXM}}>{c.nome}</div>
                      <div style={{fontSize:13,fontWeight:700,color:dias<=15?R:dias<=30?Y:B,marginTop:6}}>
                        Vence em {dias} dias
                      </div>
                      <div style={{fontSize:9,color:TXD}}>{fmtD(c.data_fim)} · MRR: {fmtR(c.valor_atual||c.valor_mensal)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Novo Contrato */}
      {showNovo&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowNovo(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:800,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>+ Novo Contrato Recorrente</div>
              <button onClick={()=>setShowNovo(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {/* Cliente */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:6}}>👤 Cliente</div>
              {novoContrato.cliente_nome?(
                <div style={{background:BG3,borderRadius:8,padding:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:TX}}>{novoContrato.cliente_nome}</div>
                    {novoContrato.cliente_cnpj&&<div style={{fontSize:10,color:TXD,fontFamily:"monospace"}}>{novoContrato.cliente_cnpj}</div>}
                  </div>
                  <button onClick={()=>setNovoContrato({...novoContrato,cliente_id:'',cliente_nome:'',cliente_cnpj:'',cliente_email:''})} style={{background:"none",border:"none",color:R,cursor:"pointer"}}>✕</button>
                </div>
              ):(
                <div style={{position:"relative"}}>
                  <input value={buscaCli} onChange={e=>setBuscaCli(e.target.value)} placeholder="Digite nome ou CNPJ do cliente..." style={inp}/>
                  {clientesBusca.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:BG2,border:`1px solid ${BD}`,borderRadius:8,maxHeight:240,overflowY:"auto",zIndex:10}}>
                      {clientesBusca.map(c=>(
                        <div key={c.id} onClick={()=>{setNovoContrato({...novoContrato,cliente_id:c.id,cliente_nome:c.razao_social||c.nome_fantasia||c.nome,cliente_cnpj:c.cpf_cnpj,cliente_email:c.email||''});setBuscaCli("");}} style={{padding:10,cursor:"pointer",borderBottom:`0.5px solid ${BD}`}} onMouseEnter={e=>(e.currentTarget.style.background=GO+"10")} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                          <div style={{fontSize:11,fontWeight:500,color:TX}}>{c.razao_social||c.nome_fantasia||c.nome}</div>
                          {c.cpf_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{c.cpf_cnpj}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo *</div>
                <select value={novoContrato.tipo} onChange={e=>setNovoContrato({...novoContrato,tipo:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  {TIPOS_CONTRATO.map(t=><option key={t.v} value={t.v}>{t.icon} {t.l}</option>)}
                </select></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Periodicidade</div>
                <select value={novoContrato.periodicidade} onChange={e=>setNovoContrato({...novoContrato,periodicidade:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="mensal">Mensal</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                </select></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome do Contrato *</div>
                <input value={novoContrato.nome} onChange={e=>setNovoContrato({...novoContrato,nome:e.target.value})} placeholder="Ex: BPO Financeiro Mensal Premium" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Valor Mensal (R$) *</div>
                <input type="number" step="0.01" value={novoContrato.valor_mensal||''} onChange={e=>setNovoContrato({...novoContrato,valor_mensal:parseFloat(e.target.value)||0})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Dia do Vencimento</div>
                <input type="number" min="1" max="28" value={novoContrato.dia_vencimento} onChange={e=>setNovoContrato({...novoContrato,dia_vencimento:parseInt(e.target.value)||10})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Data de Início *</div>
                <input type="date" value={novoContrato.data_inicio} onChange={e=>setNovoContrato({...novoContrato,data_inicio:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Data Final (opcional)</div>
                <input type="date" value={novoContrato.data_fim} onChange={e=>setNovoContrato({...novoContrato,data_fim:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo de Reajuste</div>
                <select value={novoContrato.tipo_reajuste} onChange={e=>setNovoContrato({...novoContrato,tipo_reajuste:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="nenhum">Sem reajuste</option>
                  <option value="ipca">IPCA anual</option>
                  <option value="igpm">IGPM anual</option>
                  <option value="inpc">INPC anual</option>
                  <option value="fixo">Fixo %</option>
                  <option value="custom">Customizado</option>
                </select></div>
              {(novoContrato.tipo_reajuste==='fixo'||novoContrato.tipo_reajuste==='custom')&&(
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>% Reajuste</div>
                  <input type="number" step="0.01" value={novoContrato.reajuste_percentual||''} onChange={e=>setNovoContrato({...novoContrato,reajuste_percentual:parseFloat(e.target.value)||0})} style={inp}/></div>
              )}
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Forma de Pagamento</div>
                <select value={novoContrato.forma_pagamento} onChange={e=>setNovoContrato({...novoContrato,forma_pagamento:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="boleto">Boleto</option>
                  <option value="pix">PIX</option>
                  <option value="transferencia">Transferência</option>
                  <option value="cartao">Cartão de Crédito</option>
                  <option value="debito_automatico">Débito Automático</option>
                </select></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Escopo dos Serviços</div>
                <textarea value={novoContrato.escopo} onChange={e=>setNovoContrato({...novoContrato,escopo:e.target.value})} rows={3} placeholder="Ex: Conciliação bancária · Lançamentos · Relatórios mensais · Atendimento ilimitado..." style={{...inp,resize:"vertical"}}/></div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowNovo(false)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={criarContrato} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>Criar Contrato</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalhe */}
      {showDetalhe&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowDetalhe(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div style={{fontSize:20,fontWeight:700,color:TX}}>{showDetalhe.nome}</div>
                <div style={{fontSize:11,color:TXD}}>Contrato <span style={{color:GO,fontFamily:"monospace"}}>{showDetalhe.numero}</span> · {showDetalhe.cliente_nome}</div>
              </div>
              <button onClick={()=>setShowDetalhe(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>VALOR ATUAL</div><div style={{fontSize:15,fontWeight:700,color:G}}>{fmtR(showDetalhe.valor_atual||showDetalhe.valor_mensal)}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>DIA VENCIMENTO</div><div style={{fontSize:15,fontWeight:700,color:TX}}>{showDetalhe.dia_vencimento}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TÍTULOS GERADOS</div><div style={{fontSize:15,fontWeight:700,color:B}}>{showDetalhe.total_titulos_gerados||0}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TOTAL FATURADO</div><div style={{fontSize:15,fontWeight:700,color:GO}}>{fmtR(showDetalhe.total_faturado)}</div></div>
            </div>

            {showDetalhe.escopo&&(
              <div style={{background:BG3,borderRadius:10,padding:12,marginBottom:16,borderLeft:`3px solid ${GO}`}}>
                <div style={{fontSize:10,color:TXD,marginBottom:4,textTransform:"uppercase"}}>Escopo</div>
                <div style={{fontSize:12,color:TX,whiteSpace:"pre-wrap"}}>{showDetalhe.escopo}</div>
              </div>
            )}

            {reajustesDetalhe.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:GO,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📈 Histórico de Reajustes</div>
                <div style={{background:BG3,borderRadius:8,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                      <th style={{padding:6,textAlign:"left",color:TXD,fontSize:9}}>Data</th>
                      <th style={{padding:6,textAlign:"right",color:TXD,fontSize:9}}>De</th>
                      <th style={{padding:6,textAlign:"right",color:TXD,fontSize:9}}>Para</th>
                      <th style={{padding:6,textAlign:"right",color:TXD,fontSize:9}}>%</th>
                      <th style={{padding:6,textAlign:"center",color:TXD,fontSize:9}}>Índice</th>
                    </tr></thead>
                    <tbody>
                      {reajustesDetalhe.map((r:any)=>(
                        <tr key={r.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                          <td style={{padding:6,color:TXM,fontSize:10}}>{fmtD(r.data_reajuste)}</td>
                          <td style={{padding:6,textAlign:"right",color:TXM}}>{fmtR(r.valor_anterior)}</td>
                          <td style={{padding:6,textAlign:"right",color:G,fontWeight:600}}>{fmtR(r.valor_novo)}</td>
                          <td style={{padding:6,textAlign:"right",color:Y,fontWeight:600}}>+{Number(r.percentual_aplicado).toFixed(2)}%</td>
                          <td style={{padding:6,textAlign:"center",color:TXD,fontSize:9}}>{r.tipo_indice}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {eventosDetalhe.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:GO,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📜 Histórico de Eventos</div>
                <div style={{background:BG3,borderRadius:8,padding:10,maxHeight:200,overflowY:"auto"}}>
                  {eventosDetalhe.map((e:any)=>(
                    <div key={e.id} style={{padding:6,borderBottom:`0.5px solid ${BD}`,fontSize:11}}>
                      <span style={{fontSize:10,color:TXD,fontFamily:"monospace"}}>{new Date(e.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                      <span style={{margin:"0 6px",color:P,fontWeight:600}}>{e.evento}</span>
                      <span style={{color:TX}}>{e.detalhe}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap",paddingTop:14,borderTop:`1px solid ${BD}`}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {showDetalhe.status==='ativo'&&(
                  <>
                    <button onClick={()=>{setShowReajuste(showDetalhe);setPctReajuste(Number(showDetalhe.reajuste_percentual)||5);}} style={{padding:"8px 14px",borderRadius:8,background:Y+"15",color:Y,fontSize:11,fontWeight:600,border:`1px solid ${Y}40`,cursor:"pointer"}}>📈 Reajustar</button>
                    <button onClick={()=>encerrarContrato(showDetalhe)} style={{padding:"8px 14px",borderRadius:8,background:R+"15",color:R,fontSize:11,fontWeight:600,border:`1px solid ${R}40`,cursor:"pointer"}}>🏁 Encerrar</button>
                  </>
                )}
              </div>
              <button onClick={()=>setShowDetalhe(null)} style={{padding:"8px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reajuste */}
      {showReajuste&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:110,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowReajuste(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:Y,marginBottom:8}}>📈 Aplicar Reajuste</div>
            <div style={{fontSize:12,color:TXM,marginBottom:16}}>{showReajuste.cliente_nome} · {showReajuste.nome}</div>
            
            <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:11,color:TXD}}>Valor atual:</span>
                <span style={{fontSize:13,fontWeight:600,color:TX}}>{fmtR(showReajuste.valor_atual||showReajuste.valor_mensal)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:11,color:TXD}}>Novo valor (com reajuste):</span>
                <span style={{fontSize:15,fontWeight:700,color:G}}>{fmtR((Number(showReajuste.valor_atual||showReajuste.valor_mensal))*(1+pctReajuste/100))}</span>
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Percentual de Reajuste (%)</div>
              <input type="number" step="0.01" value={pctReajuste||''} onChange={e=>setPctReajuste(parseFloat(e.target.value)||0)} style={inp}/>
              <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                {[3,4,5,6,8,10].map(p=>(
                  <button key={p} onClick={()=>setPctReajuste(p)} style={{padding:"4px 10px",borderRadius:4,background:pctReajuste===p?Y+"20":BG3,color:pctReajuste===p?Y:TXM,border:`1px solid ${pctReajuste===p?Y:BD}`,fontSize:10,cursor:"pointer"}}>+{p}%</button>
                ))}
              </div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowReajuste(null)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={aplicarReajuste} disabled={processando||pctReajuste<=0} style={{padding:"10px 24px",borderRadius:8,background:Y,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:processando?"wait":"pointer",opacity:pctReajuste<=0?0.5:1}}>{processando?"⏳":"Aplicar"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Contratos Recorrentes v1.0 · MRR/Churn/LTV · Sprint 2.4</div>
    </div>
  );
}
