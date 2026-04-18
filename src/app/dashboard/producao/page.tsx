"use client";
import React, { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
  BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>v===0?"—":`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

type Cliente={id:string;nome:string;nome_fantasia:string;cnpj_cpf:string;email:string;telefone:string;contato_principal:string;segmento:string;fee_mensal:number;tipo_contrato:string;status:string;data_inicio:string;observacoes:string};
type Job={id:string;numero:string;titulo:string;tipo:string;status:string;prioridade:string;cliente_id:string;responsavel_id:string;data_prazo:string;valor_job:number;horas_estimadas:number;horas_realizadas:number;created_at:string;cliente?:any};
type Tarefa={id:string;job_id:string;titulo:string;responsavel_id:string;status:string;prioridade:string;data_prazo:string;horas_estimadas:number;ordem:number};
type Timesheet={id:string;job_id:string;user_id:string;data:string;horas:number;descricao:string;tipo_atividade:string;custo_hora:number;custo_total:number};

const STATUS_COLORS:Record<string,string>={
  ativo:G,inativo:TXD,prospect:B,
  novo:B,em_analise:Y,aprovado:G,recusado:R,convertido_job:P,
  rascunho:TXD,enviada:B,em_negociacao:Y,aprovada:G,recusada:R,cancelada:TXD,
  briefing:P,em_producao:B,revisao:Y,aprovacao_cliente:GOL,entregue:G,cancelado:TXD,
  pendente:TXD,em_andamento:B,concluida:G,
};

const PRIORIDADE_COLORS:Record<string,string>={baixa:TXD,normal:B,alta:Y,urgente:R};

const JOB_COLUMNS=[
  {id:"briefing",label:"Briefing",cor:P},
  {id:"em_producao",label:"Em produção",cor:B},
  {id:"revisao",label:"Revisão",cor:Y},
  {id:"aprovacao_cliente",label:"Aprov. cliente",cor:GOL},
  {id:"entregue",label:"Entregue",cor:G},
];

function ProducaoPageInner(){
  const searchParams=useSearchParams();
  const empresaParam=searchParams.get("empresa");
  const [companies,setCompanies]=useState<any[]>([]);
  const [sel,setSel]=useState("");
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState<"clientes"|"jobs"|"timesheet">("clientes");

  // Data states
  const [clientes,setClientes]=useState<Cliente[]>([]);
  const [jobs,setJobs]=useState<Job[]>([]);
  const [tarefas,setTarefas]=useState<Tarefa[]>([]);
  const [timesheets,setTimesheets]=useState<Timesheet[]>([]);
  const [users,setUsers]=useState<any[]>([]);

  // Forms
  const [showForm,setShowForm]=useState<"cliente"|"job"|"tarefa"|"timesheet"|null>(null);
  const [editId,setEditId]=useState<string|null>(null);
  const [form,setForm]=useState<any>({});

  // Metrics
  const [metrics,setMetrics]=useState({clientes:0,jobs_ativos:0,horas_mes:0,receita_mes:0});

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(sel){loadAll();}},[sel]);

  const loadCompanies=async()=>{
    const{data:{user}}=await supabase.auth.getUser();if(!user)return;
    const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
    let d:any[]=[];
    if(up?.role==="adm"||up?.role==="acesso_total"){const r=await supabase.from("companies").select("*").order("nome_fantasia");d=r.data||[];}
    else{const r=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);d=(r.data||[]).map((u:any)=>u.companies).filter(Boolean);}
    setCompanies(d);
    const s=empresaParam||((typeof window!=="undefined")?localStorage.getItem("ps_empresa_sel"):"")||"";
    const m=s?d.find((c:any)=>c.id===s):null;
    setSel(m?m.id:d[0]?.id||"");
    setLoading(false);
  };

  const loadAll=async()=>{
    const[{data:cl},{data:jb},{data:tf},{data:ts},{data:us}]=await Promise.all([
      supabase.from("agency_clientes").select("*").eq("company_id",sel).order("nome"),
      supabase.from("agency_jobs").select("*,agency_clientes(nome)").eq("company_id",sel).order("created_at",{ascending:false}),
      supabase.from("agency_tarefas").select("*").eq("company_id",sel).order("ordem"),
      supabase.from("agency_timesheet").select("*").eq("company_id",sel).order("data",{ascending:false}),
      supabase.from("user_companies").select("users(id,email,role)").eq("company_id",sel),
    ]);
    setClientes(cl||[]);
    setJobs(jb||[]);
    setTarefas(tf||[]);
    setTimesheets(ts||[]);
    setUsers((us||[]).map((u:any)=>u.users).filter(Boolean));

    const now=new Date();const mesAtual=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    setMetrics({
      clientes:(cl||[]).filter((c:any)=>c.status==="ativo").length,
      jobs_ativos:(jb||[]).filter((j:any)=>!["entregue","cancelado"].includes(j.status)).length,
      horas_mes:(ts||[]).filter((t:any)=>t.data?.startsWith(mesAtual)).reduce((s:number,t:any)=>s+(t.horas||0),0),
      receita_mes:(cl||[]).filter((c:any)=>c.status==="ativo").reduce((s:number,c:any)=>s+(c.fee_mensal||0),0),
    });
  };

  // ═══ CRUD OPERATIONS ═══
  const saveCliente=async()=>{
    const data={...form,company_id:sel};
    if(editId){await supabase.from("agency_clientes").update(data).eq("id",editId);}
    else{await supabase.from("agency_clientes").insert(data);}
    setShowForm(null);setEditId(null);setForm({});loadAll();
  };

  const saveJob=async()=>{
    const data={...form,company_id:sel};
    if(editId){await supabase.from("agency_jobs").update(data).eq("id",editId);}
    else{await supabase.from("agency_jobs").insert(data);}
    setShowForm(null);setEditId(null);setForm({});loadAll();
  };

  const saveTimesheet=async()=>{
    const data={...form,company_id:sel};
    await supabase.from("agency_timesheet").insert(data);
    setShowForm(null);setForm({});loadAll();
  };

  const deleteRecord=async(table:string,id:string)=>{
    if(!confirm("Tem certeza que deseja excluir?"))return;
    await supabase.from(table).delete().eq("id",id);
    loadAll();
  };

  const updateJobStatus=async(jobId:string,newStatus:string)=>{
    await supabase.from("agency_jobs").update({status:newStatus}).eq("id",jobId);
    loadAll();
  };

  const editCliente=(c:Cliente)=>{setForm({nome:c.nome,nome_fantasia:c.nome_fantasia,cnpj_cpf:c.cnpj_cpf,email:c.email,telefone:c.telefone,contato_principal:c.contato_principal,segmento:c.segmento,fee_mensal:c.fee_mensal,tipo_contrato:c.tipo_contrato,status:c.status,observacoes:c.observacoes});setEditId(c.id);setShowForm("cliente");};
  const editJob=(j:Job)=>{setForm({titulo:j.titulo,tipo:j.tipo,status:j.status,prioridade:j.prioridade,cliente_id:j.cliente_id,data_prazo:j.data_prazo,valor_job:j.valor_job,horas_estimadas:j.horas_estimadas});setEditId(j.id);setShowForm("job");};

  // ═══ STYLES ═══
  const card:React.CSSProperties={background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:16,marginBottom:12};
  const btn:React.CSSProperties={background:GO,color:"#fff",border:"none",borderRadius:8,padding:"8px 18px",fontSize:12,fontWeight:600,cursor:"pointer"};
  const btnSm:React.CSSProperties={...btn,padding:"5px 12px",fontSize:11};
  const btnDanger:React.CSSProperties={...btnSm,background:R};
  const btnSec:React.CSSProperties={...btnSm,background:BG3,color:TX,border:`1px solid ${BD}`};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,borderRadius:6,color:TX,padding:"8px 12px",fontSize:12,width:"100%"};
  const selStyle:React.CSSProperties={...inp};
  const badge=(color:string):React.CSSProperties=>({fontSize:9,padding:"2px 8px",borderRadius:6,background:color+"18",color,fontWeight:600,border:`1px solid ${color}30`});

  if(loading)return<div style={{minHeight:"100vh",background:BG,display:"flex",alignItems:"center",justifyContent:"center",color:GOL}}>Carregando...</div>;

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>🎨 Produção Marketing</div>
          <div style={{fontSize:11,color:TXD}}>Gestão de jobs, briefings, propostas e timesheet</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <select value={sel} onChange={e=>{setSel(e.target.value);if(typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",e.target.value);}} style={{background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"6px 14px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {/* METRICS */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
        {[
          {l:"Clientes ativos",v:metrics.clientes,c:G},
          {l:"Jobs em andamento",v:metrics.jobs_ativos,c:B},
          {l:"Horas no mês",v:`${metrics.horas_mes.toFixed(1)}h`,c:P},
          {l:"Receita mensal (fees)",v:fmtR(metrics.receita_mes),c:GOL},
        ].map((m,i)=>(
          <div key={i} style={{background:BG2,borderRadius:10,padding:"10px 14px",borderLeft:`3px solid ${m.c}`}}>
            <div style={{fontSize:8,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>{m.l}</div>
            <div style={{fontSize:18,fontWeight:700,color:m.c,marginTop:2}}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:4,marginBottom:16,borderBottom:`1px solid ${BD}`,paddingBottom:8}}>
        {([
          {id:"clientes" as const,label:"Clientes",icon:"👥"},
          {id:"jobs" as const,label:"Jobs / Kanban",icon:"📋"},
          {id:"timesheet" as const,label:"Timesheet",icon:"⏱️"},
        ]).map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"8px 18px",borderRadius:8,fontSize:12,border:tab===t.id?`1px solid ${GO}50`:`1px solid transparent`,background:tab===t.id?GO+"15":"transparent",color:tab===t.id?GOL:TXM,fontWeight:tab===t.id?600:400,cursor:"pointer"}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: CLIENTES ═══ */}
      {tab==="clientes"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:600,color:TX}}>Clientes da agência ({clientes.length})</div>
            <button style={btn} onClick={()=>{setForm({status:"ativo",tipo_contrato:"fee_mensal"});setEditId(null);setShowForm("cliente");}}>+ Novo cliente</button>
          </div>

          {/* FORM CLIENTE */}
          {showForm==="cliente"&&(
            <div style={{...card,border:`1px solid ${GO}40`}}>
              <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:12}}>{editId?"Editar cliente":"Novo cliente"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={{fontSize:10,color:TXD}}>Razão Social *</label><input style={inp} value={form.nome||""} onChange={e=>setForm({...form,nome:e.target.value})} placeholder="Nome completo"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Nome Fantasia</label><input style={inp} value={form.nome_fantasia||""} onChange={e=>setForm({...form,nome_fantasia:e.target.value})} placeholder="Nome fantasia"/></div>
                <div><label style={{fontSize:10,color:TXD}}>CNPJ/CPF</label><input style={inp} value={form.cnpj_cpf||""} onChange={e=>setForm({...form,cnpj_cpf:e.target.value})} placeholder="00.000.000/0000-00"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Email</label><input style={inp} value={form.email||""} onChange={e=>setForm({...form,email:e.target.value})} placeholder="email@empresa.com"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Telefone</label><input style={inp} value={form.telefone||""} onChange={e=>setForm({...form,telefone:e.target.value})} placeholder="(49) 99999-9999"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Contato principal</label><input style={inp} value={form.contato_principal||""} onChange={e=>setForm({...form,contato_principal:e.target.value})} placeholder="Nome do contato"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Segmento</label><input style={inp} value={form.segmento||""} onChange={e=>setForm({...form,segmento:e.target.value})} placeholder="Ex: varejo, saúde, educação"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Fee mensal (R$)</label><input style={inp} type="number" value={form.fee_mensal||""} onChange={e=>setForm({...form,fee_mensal:parseFloat(e.target.value)||0})} placeholder="0.00"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Tipo de contrato</label>
                  <select style={selStyle} value={form.tipo_contrato||"fee_mensal"} onChange={e=>setForm({...form,tipo_contrato:e.target.value})}>
                    <option value="fee_mensal">Fee mensal</option><option value="projeto">Projeto</option><option value="avulso">Avulso</option>
                  </select>
                </div>
                <div><label style={{fontSize:10,color:TXD}}>Status</label>
                  <select style={selStyle} value={form.status||"ativo"} onChange={e=>setForm({...form,status:e.target.value})}>
                    <option value="ativo">Ativo</option><option value="inativo">Inativo</option><option value="prospect">Prospect</option>
                  </select>
                </div>
              </div>
              <div style={{marginTop:10}}><label style={{fontSize:10,color:TXD}}>Observações</label><textarea style={{...inp,minHeight:60}} value={form.observacoes||""} onChange={e=>setForm({...form,observacoes:e.target.value})}/></div>
              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button style={btn} onClick={saveCliente}>Salvar</button>
                <button style={btnSec} onClick={()=>{setShowForm(null);setEditId(null);setForm({});}}>Cancelar</button>
              </div>
            </div>
          )}

          {/* LISTA CLIENTES */}
          {clientes.length===0&&!showForm?(
            <div style={{...card,textAlign:"center",padding:40}}>
              <div style={{fontSize:14,color:TXM,marginBottom:8}}>Nenhum cliente cadastrado</div>
              <div style={{fontSize:11,color:TXD}}>Cadastre os clientes da agência para começar a gerenciar jobs e propostas.</div>
            </div>
          ):(
            <div style={{...card,padding:0,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{borderBottom:`1px solid ${GO}30`}}>
                  <th style={{padding:"10px 12px",textAlign:"left",color:GOL,fontSize:10}}>Cliente</th>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GOL,fontSize:10}}>Contato</th>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GOL,fontSize:10}}>Segmento</th>
                  <th style={{padding:"10px 8px",textAlign:"right",color:GOL,fontSize:10}}>Fee mensal</th>
                  <th style={{padding:"10px 8px",textAlign:"center",color:GOL,fontSize:10}}>Tipo</th>
                  <th style={{padding:"10px 8px",textAlign:"center",color:GOL,fontSize:10}}>Status</th>
                  <th style={{padding:"10px 8px",textAlign:"center",color:GOL,fontSize:10}}>Ações</th>
                </tr></thead>
                <tbody>
                  {clientes.map((c,i)=>(
                    <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}30`,background:i%2===0?"transparent":BG3+"30"}}>
                      <td style={{padding:"8px 12px"}}>
                        <div style={{color:TX,fontWeight:500}}>{c.nome_fantasia||c.nome}</div>
                        {c.nome_fantasia&&<div style={{fontSize:9,color:TXD}}>{c.nome}</div>}
                      </td>
                      <td style={{padding:"8px",color:TXM}}>
                        <div>{c.contato_principal||"—"}</div>
                        <div style={{fontSize:9,color:TXD}}>{c.email||""}</div>
                      </td>
                      <td style={{padding:"8px",color:TXM}}>{c.segmento||"—"}</td>
                      <td style={{padding:"8px",textAlign:"right",color:c.fee_mensal>0?G:TXD,fontWeight:600}}>{c.fee_mensal>0?fmtR(c.fee_mensal):"—"}</td>
                      <td style={{padding:"8px",textAlign:"center"}}><span style={{fontSize:9,color:TXM}}>{c.tipo_contrato?.replace("_"," ")}</span></td>
                      <td style={{padding:"8px",textAlign:"center"}}><span style={badge(STATUS_COLORS[c.status]||TXD)}>{c.status}</span></td>
                      <td style={{padding:"8px",textAlign:"center"}}>
                        <button style={btnSec} onClick={()=>editCliente(c)}>Editar</button>
                        <button style={{...btnDanger,marginLeft:4}} onClick={()=>deleteRecord("agency_clientes",c.id)}>X</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: JOBS / KANBAN ═══ */}
      {tab==="jobs"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:600,color:TX}}>Jobs ({jobs.length})</div>
            <button style={btn} onClick={()=>{setForm({status:"briefing",prioridade:"normal"});setEditId(null);setShowForm("job");}}>+ Novo job</button>
          </div>

          {/* FORM JOB */}
          {showForm==="job"&&(
            <div style={{...card,border:`1px solid ${GO}40`}}>
              <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:12}}>{editId?"Editar job":"Novo job"}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={{fontSize:10,color:TXD}}>Título *</label><input style={inp} value={form.titulo||""} onChange={e=>setForm({...form,titulo:e.target.value})} placeholder="Ex: Site institucional"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Cliente</label>
                  <select style={selStyle} value={form.cliente_id||""} onChange={e=>setForm({...form,cliente_id:e.target.value})}>
                    <option value="">— selecionar —</option>
                    {clientes.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.nome}</option>)}
                  </select>
                </div>
                <div><label style={{fontSize:10,color:TXD}}>Tipo</label>
                  <select style={selStyle} value={form.tipo||""} onChange={e=>setForm({...form,tipo:e.target.value})}>
                    <option value="">— tipo —</option>
                    <option value="site">Site</option><option value="video">Vídeo</option><option value="arte">Arte/Design</option>
                    <option value="campanha">Campanha</option><option value="social_media">Social Media</option><option value="assessoria">Assessoria</option>
                    <option value="logomarca">Logomarca</option><option value="catalogo">Catálogo</option><option value="lp">Landing Page</option>
                  </select>
                </div>
                <div><label style={{fontSize:10,color:TXD}}>Prioridade</label>
                  <select style={selStyle} value={form.prioridade||"normal"} onChange={e=>setForm({...form,prioridade:e.target.value})}>
                    <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
                  </select>
                </div>
                <div><label style={{fontSize:10,color:TXD}}>Prazo</label><input style={inp} type="date" value={form.data_prazo||""} onChange={e=>setForm({...form,data_prazo:e.target.value})}/></div>
                <div><label style={{fontSize:10,color:TXD}}>Valor (R$)</label><input style={inp} type="number" value={form.valor_job||""} onChange={e=>setForm({...form,valor_job:parseFloat(e.target.value)||0})}/></div>
                <div><label style={{fontSize:10,color:TXD}}>Horas estimadas</label><input style={inp} type="number" value={form.horas_estimadas||""} onChange={e=>setForm({...form,horas_estimadas:parseFloat(e.target.value)||0})}/></div>
                <div><label style={{fontSize:10,color:TXD}}>Status</label>
                  <select style={selStyle} value={form.status||"briefing"} onChange={e=>setForm({...form,status:e.target.value})}>
                    {JOB_COLUMNS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                    <option value="cancelado">Cancelado</option>
                  </select>
                </div>
              </div>
              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button style={btn} onClick={saveJob}>Salvar</button>
                <button style={btnSec} onClick={()=>{setShowForm(null);setEditId(null);setForm({});}}>Cancelar</button>
              </div>
            </div>
          )}

          {/* KANBAN BOARD */}
          <div style={{display:"grid",gridTemplateColumns:`repeat(${JOB_COLUMNS.length},1fr)`,gap:8,overflowX:"auto"}}>
            {JOB_COLUMNS.map(col=>{
              const colJobs=jobs.filter(j=>j.status===col.id);
              return(
                <div key={col.id} style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,minHeight:300,overflow:"hidden"}}>
                  <div style={{padding:"10px 12px",borderBottom:`2px solid ${col.cor}40`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:11,fontWeight:600,color:col.cor}}>{col.label}</span>
                    <span style={{fontSize:10,color:TXD,background:BG3,padding:"2px 8px",borderRadius:10}}>{colJobs.length}</span>
                  </div>
                  <div style={{padding:8}}>
                    {colJobs.map(j=>{
                      const cliente=clientes.find(c=>c.id===j.cliente_id);
                      const diasRestantes=j.data_prazo?Math.ceil((new Date(j.data_prazo).getTime()-Date.now())/(86400000)):null;
                      return(
                        <div key={j.id} style={{background:BG3,borderRadius:8,padding:10,marginBottom:6,borderLeft:`3px solid ${PRIORIDADE_COLORS[j.prioridade]||B}`,cursor:"pointer"}} onClick={()=>editJob(j)}>
                          <div style={{fontSize:11,fontWeight:600,color:TX,marginBottom:4}}>{j.titulo}</div>
                          {cliente&&<div style={{fontSize:9,color:TXM,marginBottom:4}}>{cliente.nome_fantasia||cliente.nome}</div>}
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <span style={badge(PRIORIDADE_COLORS[j.prioridade]||B)}>{j.prioridade}</span>
                            {diasRestantes!==null&&<span style={{fontSize:9,color:diasRestantes<0?R:diasRestantes<3?Y:TXD}}>{diasRestantes<0?`${Math.abs(diasRestantes)}d atrasado`:diasRestantes===0?"Hoje":`${diasRestantes}d`}</span>}
                          </div>
                          {j.valor_job>0&&<div style={{fontSize:10,color:G,fontWeight:600,marginTop:4}}>{fmtR(j.valor_job)}</div>}
                          {/* Move buttons */}
                          <div style={{display:"flex",gap:4,marginTop:6}}>
                            {JOB_COLUMNS.map((c,ci)=>{
                              const curIdx=JOB_COLUMNS.findIndex(x=>x.id===j.status);
                              if(ci===curIdx)return null;
                              if(ci!==curIdx-1&&ci!==curIdx+1)return null;
                              return <button key={c.id} onClick={(e)=>{e.stopPropagation();updateJobStatus(j.id,c.id);}} style={{fontSize:8,padding:"2px 6px",borderRadius:4,border:`1px solid ${c.cor}30`,background:c.cor+"10",color:c.cor,cursor:"pointer"}}>{ci<curIdx?"←":"→"} {c.label}</button>;
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {colJobs.length===0&&<div style={{padding:16,textAlign:"center",fontSize:10,color:TXD}}>Nenhum job</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ TAB: TIMESHEET ═══ */}
      {tab==="timesheet"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:14,fontWeight:600,color:TX}}>Timesheet</div>
            <button style={btn} onClick={()=>{setForm({data:new Date().toISOString().slice(0,10)});setShowForm("timesheet");}}>+ Registrar horas</button>
          </div>

          {/* FORM TIMESHEET */}
          {showForm==="timesheet"&&(
            <div style={{...card,border:`1px solid ${GO}40`}}>
              <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:12}}>Registrar horas</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                <div><label style={{fontSize:10,color:TXD}}>Job *</label>
                  <select style={selStyle} value={form.job_id||""} onChange={e=>setForm({...form,job_id:e.target.value})}>
                    <option value="">— selecionar —</option>
                    {jobs.filter(j=>j.status!=="entregue"&&j.status!=="cancelado").map(j=><option key={j.id} value={j.id}>{j.titulo}</option>)}
                  </select>
                </div>
                <div><label style={{fontSize:10,color:TXD}}>Data *</label><input style={inp} type="date" value={form.data||""} onChange={e=>setForm({...form,data:e.target.value})}/></div>
                <div><label style={{fontSize:10,color:TXD}}>Horas *</label><input style={inp} type="number" step="0.5" value={form.horas||""} onChange={e=>setForm({...form,horas:parseFloat(e.target.value)||0})} placeholder="Ex: 2.5"/></div>
                <div><label style={{fontSize:10,color:TXD}}>Atividade</label>
                  <select style={selStyle} value={form.tipo_atividade||""} onChange={e=>setForm({...form,tipo_atividade:e.target.value})}>
                    <option value="">— tipo —</option>
                    <option value="criacao">Criação</option><option value="atendimento">Atendimento</option><option value="producao">Produção</option>
                    <option value="edicao">Edição</option><option value="revisao">Revisão</option><option value="reuniao">Reunião</option>
                    <option value="planejamento">Planejamento</option>
                  </select>
                </div>
                <div style={{gridColumn:"span 2"}}><label style={{fontSize:10,color:TXD}}>Descrição</label><input style={inp} value={form.descricao||""} onChange={e=>setForm({...form,descricao:e.target.value})} placeholder="O que foi feito"/></div>
              </div>
              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button style={btn} onClick={async()=>{
                  const{data:{user}}=await supabase.auth.getUser();
                  if(user)setForm((f:any)=>({...f,user_id:user.id}));
                  saveTimesheet();
                }}>Salvar</button>
                <button style={btnSec} onClick={()=>{setShowForm(null);setForm({});}}>Cancelar</button>
              </div>
            </div>
          )}

          {/* LISTA TIMESHEET */}
          {timesheets.length===0&&!showForm?(
            <div style={{...card,textAlign:"center",padding:40}}>
              <div style={{fontSize:14,color:TXM}}>Nenhum registro de horas</div>
              <div style={{fontSize:11,color:TXD}}>Registre as horas trabalhadas em cada job para calcular a rentabilidade.</div>
            </div>
          ):(
            <div style={{...card,padding:0,overflow:"hidden"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead><tr style={{borderBottom:`1px solid ${GO}30`}}>
                  <th style={{padding:"10px 12px",textAlign:"left",color:GOL,fontSize:10}}>Data</th>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GOL,fontSize:10}}>Job</th>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GOL,fontSize:10}}>Atividade</th>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GOL,fontSize:10}}>Descrição</th>
                  <th style={{padding:"10px 8px",textAlign:"right",color:GOL,fontSize:10}}>Horas</th>
                  <th style={{padding:"10px 8px",textAlign:"center",color:GOL,fontSize:10}}>Ações</th>
                </tr></thead>
                <tbody>
                  {timesheets.slice(0,50).map((t,i)=>{
                    const job=jobs.find(j=>j.id===t.job_id);
                    return(
                      <tr key={t.id} style={{borderBottom:`0.5px solid ${BD}30`,background:i%2===0?"transparent":BG3+"30"}}>
                        <td style={{padding:"8px 12px",color:TX}}>{t.data}</td>
                        <td style={{padding:"8px",color:TXM}}>{job?.titulo||"—"}</td>
                        <td style={{padding:"8px",color:TXM}}>{t.tipo_atividade||"—"}</td>
                        <td style={{padding:"8px",color:TXD,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.descricao||"—"}</td>
                        <td style={{padding:"8px",textAlign:"right",color:P,fontWeight:600}}>{t.horas}h</td>
                        <td style={{padding:"8px",textAlign:"center"}}><button style={btnDanger} onClick={()=>deleteRecord("agency_timesheet",t.id)}>X</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:16}}>PS Gestão e Capital — Produção Marketing v1.0</div>
    </div>
  );
}

export default function ProducaoPage(){
  return(
    <Suspense fallback={<div style={{padding:40,textAlign:"center",color:"#918C82"}}>Carregando...</div>}>
      <ProducaoPageInner/>
    </Suspense>
  );
}
