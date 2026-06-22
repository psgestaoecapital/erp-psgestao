"use client";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, X, Plus, Check, Clock, Filter, Calendar } from "lucide-react";
import { supabase } from "@/lib/supabase";

const ESP="#3D2314", BG="#FAF7F2", GOLD="#C8941A", LINE="#E7DECF", ESP60="rgba(61,35,20,0.55)";
const H0=8, N=22, SLOT_H=54; // 08:00–19:00, slots de 30min
const pad=(n:number)=>String(n).padStart(2,"0");
const idxToTime=(i:number)=>`${pad(H0+Math.floor(i/2))}:${i%2?"30":"00"}`;
const timeToIdx=(t:string)=>{const[h,m]=t.split(":").map(Number);return (h-H0)*2+(m>=30?1:0);};
const DIAS=["domingo","segunda","terça","quarta","quinta","sexta","sábado"];
const MES=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];

type Cad={id:string;nome:string;cor?:string};
type Prof={id:string;nome:string;cor:string};
type Proc={id:string;nome:string;cor:string;duracao_min:number};
type Ag={id:string;cadeira_id:string;profissional_id?:string;profissional_nome?:string;
  procedimento_id?:string;procedimento_nome?:string;procedimento_cor?:string;
  paciente_nome:string;hora_inicio:string;hora_fim:string;status:string};

// Empresa ativa: padrao do projeto (ps_empresa_sel) — ignora 'consolidado'/'group_*'.
function resolveCompanyId(): string | null {
  if (typeof window === "undefined") return null;
  const sel = localStorage.getItem("ps_empresa_sel");
  if (!sel || sel === "consolidado" || sel.startsWith("group_")) return null;
  return sel;
}

export default function AgendaPorCadeiraPage(){
  const [companyId,setCompanyId]=useState<string|null>(null);
  useEffect(()=>{
    setCompanyId(resolveCompanyId());
    const i=setInterval(()=>{const a=resolveCompanyId();setCompanyId(p=>p===a?p:a);},800);
    return ()=>clearInterval(i);
  },[]);

  const [dayOffset,setDayOffset]=useState(0);
  const dateObj=useMemo(()=>{const d=new Date();d.setDate(d.getDate()+dayOffset);return d;},[dayOffset]);
  const isoDate=useMemo(()=>dateObj.toISOString().slice(0,10),[dateObj]);

  const [cadeiras,setCadeiras]=useState<Cad[]>([]);
  const [profs,setProfs]=useState<Prof[]>([]);
  const [procs,setProcs]=useState<Proc[]>([]);
  const [appts,setAppts]=useState<Ag[]>([]);
  const [loading,setLoading]=useState(true);
  const [fProf,setFProf]=useState("Todos");
  const [fProc,setFProc]=useState("Todos");
  const [sel,setSel]=useState<Ag|null>(null);
  const [novo,setNovo]=useState<{ch:string;idx:number}|null>(null);

  const load=useCallback(async()=>{
    if(!companyId){setLoading(false);return;}
    setLoading(true);
    const {data,error}=await supabase.rpc("fn_odonto_agenda_dia",{p_company_id:companyId,p_data:isoDate});
    if(!error&&data){ setCadeiras(data.cadeiras||[]);setProfs(data.profissionais||[]);setProcs(data.procedimentos||[]);setAppts(data.agendamentos||[]); }
    setLoading(false);
  },[companyId,isoDate]);
  useEffect(()=>{load();},[load]);

  const match=(a:Ag)=>(fProf==="Todos"||a.profissional_nome===fProf)&&(fProc==="Todos"||a.procedimento_nome===fProc);
  const corProc=(nome?:string)=>procs.find(p=>p.nome===nome)?.cor||GOLD;

  const concluir=async(a:Ag)=>{
    const novoStatus=a.status==="concluido"?"agendado":"concluido";
    await supabase.rpc("fn_odonto_agendamento_status",{p_id:a.id,p_status:novoStatus});
    setSel(null); load();
  };
  const addNovo=async(f:{pac:string;prof:string;proc:string;dur:number})=>{
    if(!novo||!companyId) return;
    const proc=procs.find(p=>p.id===f.proc);
    const start=idxToTime(novo.idx);
    const endIdx=Math.min(N, novo.idx + (f.dur||((proc?.duracao_min||60)/30)));
    const {error}=await supabase.rpc("fn_odonto_agendar",{
      p_company_id:companyId,p_cadeira_id:novo.ch,p_procedimento_id:f.proc||null,
      p_profissional_id:f.prof||null,p_paciente_nome:f.pac,p_data:isoDate,
      p_hora_inicio:start+":00",p_hora_fim:idxToTime(endIdx)+":00"});
    if(error) alert(error.message);
    setNovo(null); load();
  };

  if(!companyId) return (
    <div style={{background:BG,color:ESP60,minHeight:"100%"}} className="p-6 text-sm">
      Selecione uma empresa especifica no topo do menu para abrir a agenda.
    </div>
  );

  return (
    <div style={{background:BG,color:ESP,minHeight:"100%",fontFamily:"ui-sans-serif,system-ui,sans-serif"}} className="p-4 sm:p-6">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2" style={{color:GOLD}}><Calendar size={18}/>
            <span className="text-xs font-semibold tracking-widest uppercase">Agenda</span></div>
          <h1 className="text-2xl sm:text-3xl mt-1" style={{fontFamily:"ui-serif,Georgia,serif",fontWeight:600}}>Agenda por cadeira</h1>
        </div>
        <div className="flex items-center gap-1 rounded-full px-1 py-1" style={{background:"#fff",border:`1px solid ${LINE}`}}>
          <button onClick={()=>setDayOffset(d=>d-1)} className="p-2 rounded-full"><ChevronLeft size={18}/></button>
          <button onClick={()=>setDayOffset(0)} className="px-3 py-1 rounded-full text-sm font-medium"
            style={{background:dayOffset===0?GOLD:"transparent",color:dayOffset===0?"#fff":ESP}}>
            {DIAS[dateObj.getDay()]}, {dateObj.getDate()} {MES[dateObj.getMonth()]}
          </button>
          <button onClick={()=>setDayOffset(d=>d+1)} className="p-2 rounded-full"><ChevronRight size={18}/></button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className="flex items-center gap-1 text-sm" style={{color:ESP60}}><Filter size={15}/> Filtrar:</span>
        <Sel value={fProf} onChange={setFProf} options={["Todos",...profs.map(p=>p.nome)]}/>
        <Sel value={fProc} onChange={setFProc} options={["Todos",...procs.map(p=>p.nome)]}/>
        <div className="flex-1"/>
        <div className="flex items-center gap-2 flex-wrap">
          {procs.map(p=>(<span key={p.id} className="inline-flex items-center gap-1 text-xs" style={{color:ESP60}}>
            <span className="w-2.5 h-2.5 rounded-full" style={{background:p.cor}}/>{p.nome}</span>))}
        </div>
      </div>

      {loading ? <div className="py-20 text-center" style={{color:ESP60}}>Carregando agenda…</div> :
       cadeiras.length===0 ? <EmptyState/> :
      <div className="rounded-2xl overflow-auto" style={{border:`1px solid ${LINE}`,background:"#fff",maxHeight:560}}>
        <div style={{display:"grid",gridTemplateColumns:`60px repeat(${cadeiras.length},minmax(150px,1fr))`,
          gridTemplateRows:`40px repeat(${N},${SLOT_H}px)`,minWidth:60+cadeiras.length*150,position:"relative"}}>
          <div style={{gridColumn:1,gridRow:1,position:"sticky",top:0,left:0,zIndex:30,background:"#fff",borderBottom:`1px solid ${LINE}`,borderRight:`1px solid ${LINE}`}}/>
          {cadeiras.map((c,ci)=>(
            <div key={c.id} style={{gridColumn:ci+2,gridRow:1,position:"sticky",top:0,zIndex:20,background:"#fff",borderBottom:`1px solid ${LINE}`,borderRight:ci<cadeiras.length-1?`1px solid ${LINE}`:"none"}}
              className="flex items-center justify-center gap-2 text-sm font-semibold">
              <span className="w-2 h-2 rounded-full" style={{background:GOLD}}/>{c.nome}</div>))}
          {Array.from({length:N}).map((_,i)=>(
            <div key={i} style={{gridColumn:1,gridRow:i+2,position:"sticky",left:0,zIndex:10,background:"#fff",borderRight:`1px solid ${LINE}`,borderBottom:`1px solid ${LINE}`}}
              className="flex items-start justify-end pr-2 pt-1">
              <span className="text-xs" style={{color:i%2?"rgba(61,35,20,0.30)":ESP60}}>{idxToTime(i)}</span></div>))}
          {cadeiras.map((c,ci)=>Array.from({length:N}).map((_,ri)=>(
            <button key={`${c.id}-${ri}`} onClick={()=>setNovo({ch:c.id,idx:ri})}
              style={{gridColumn:ci+2,gridRow:ri+2,borderRight:ci<cadeiras.length-1?`1px solid ${LINE}`:"none",borderBottom:`1px solid ${LINE}`,background:"transparent"}}
              className="group flex items-center justify-center">
              <Plus size={16} style={{color:GOLD}} className="opacity-0 group-hover:opacity-60 transition-opacity"/></button>)))}
          {appts.map(a=>{const ci=cadeiras.findIndex(c=>c.id===a.cadeira_id); if(ci<0) return null;
            const s=timeToIdx(a.hora_inicio), span=Math.max(1,timeToIdx(a.hora_fim)-s), on=match(a), done=a.status==="concluido";
            return (<button key={a.id} onClick={()=>setSel(a)}
              style={{gridColumn:ci+2,gridRow:`${s+2} / span ${span}`,background:a.procedimento_cor||GOLD,
                opacity:on?(done?0.6:1):0.18,zIndex:15,margin:3,borderRadius:10,color:BG,boxShadow:"0 1px 3px rgba(61,35,20,0.2)"}}
              className="text-left p-2 overflow-hidden flex flex-col">
              <span className="flex items-center gap-1 text-[11px] font-medium opacity-90"><Clock size={11}/>{a.hora_inicio}–{a.hora_fim}{done&&<Check size={12} className="ml-auto"/>}</span>
              <span className="text-sm font-semibold leading-tight mt-0.5 truncate" style={{textDecoration:done?"line-through":"none"}}>{a.paciente_nome}</span>
              <span className="text-[11px] opacity-90 truncate">{a.procedimento_nome}</span>
              <span className="text-[11px] opacity-80 mt-auto truncate">{a.profissional_nome}</span>
            </button>);})}
        </div>
      </div>}

      <p className="text-xs mt-3" style={{color:ESP60}}>Toque num horário vazio para agendar · toque num agendamento para ver detalhes.</p>

      {sel && <Overlay onClose={()=>setSel(null)}>
        <div className="h-1.5 rounded-t-2xl" style={{background:corProc(sel.procedimento_nome),margin:"-1px -1px 0"}}/>
        <div className="p-5">
          <div className="flex items-start justify-between">
            <div><div className="text-xs font-semibold uppercase tracking-wider" style={{color:corProc(sel.procedimento_nome)}}>{sel.procedimento_nome}</div>
              <h3 className="text-xl font-semibold mt-1" style={{fontFamily:"ui-serif,Georgia,serif"}}>{sel.paciente_nome}</h3></div>
            <button onClick={()=>setSel(null)} style={{color:ESP60}}><X size={20}/></button>
          </div>
          <div className="mt-4 space-y-2 text-sm">
            <Row l="Horário" v={`${sel.hora_inicio} – ${sel.hora_fim}`}/>
            <Row l="Cadeira" v={cadeiras.find(c=>c.id===sel.cadeira_id)?.nome||"-"}/>
            <Row l="Profissional" v={sel.profissional_nome||"-"}/>
            <Row l="Procedimento" v={sel.procedimento_nome||"-"}/>
            <Row l="Status" v={sel.status==="concluido"?"Concluído":"Agendado"}/>
          </div>
          <div className="flex gap-2 mt-5">
            <button onClick={()=>concluir(sel)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
              style={{background:sel.status==="concluido"?"#fff":GOLD,color:sel.status==="concluido"?ESP:"#fff",border:sel.status==="concluido"?`1px solid ${LINE}`:"none"}}>
              <Check size={16}/>{sel.status==="concluido"?"Reabrir":"Marcar concluído"}</button>
            <button onClick={()=>setSel(null)} className="px-4 py-2.5 rounded-xl text-sm font-medium" style={{background:"#fff",border:`1px solid ${LINE}`}}>Fechar</button>
          </div>
        </div>
      </Overlay>}

      {novo && <Overlay onClose={()=>setNovo(null)}>
        <FormNovo cadeira={cadeiras.find(c=>c.id===novo.ch)?.nome||""} start={idxToTime(novo.idx)} profs={profs} procs={procs}
          onCancel={()=>setNovo(null)} onAdd={addNovo}/>
      </Overlay>}
    </div>
  );
}

function Sel({value,onChange,options}:{value:string;onChange:(v:string)=>void;options:string[]}){
  return (<span className="inline-flex items-center gap-1 rounded-full px-2 py-1" style={{background:"#fff",border:`1px solid ${LINE}`}}>
    <select value={value} onChange={e=>onChange(e.target.value)} className="text-sm bg-transparent outline-none" style={{color:ESP}}>
      {options.map(o=><option key={o} value={o}>{o}</option>)}</select></span>);
}
function Row({l,v}:{l:string;v:string}){return(<div className="flex justify-between border-b pb-2" style={{borderColor:LINE}}>
  <span style={{color:ESP60}}>{l}</span><span className="font-medium">{v}</span></div>);}
function Overlay({children,onClose}:{children:React.ReactNode;onClose:()=>void}){
  return(<div onClick={onClose} className="fixed inset-0 flex items-center justify-center p-4" style={{background:"rgba(61,35,20,0.45)",zIndex:50}}>
    <div onClick={e=>e.stopPropagation()} className="w-full max-w-sm rounded-2xl" style={{background:"#fff",boxShadow:"0 20px 50px rgba(61,35,20,0.3)"}}>{children}</div></div>);}
function EmptyState(){return(<div className="rounded-2xl p-10 text-center" style={{border:`1px dashed ${LINE}`,background:"#fff",color:ESP60}}>
  Nenhuma cadeira cadastrada ainda. Cadastre as cadeiras da clínica para começar a agendar.</div>);}
function FormNovo({cadeira,start,profs,procs,onCancel,onAdd}:{cadeira:string;start:string;profs:Prof[];procs:Proc[];onCancel:()=>void;onAdd:(f:{pac:string;prof:string;proc:string;dur:number})=>void}){
  const [pac,setPac]=useState(""),[prof,setProf]=useState(profs[0]?.id||""),[proc,setProc]=useState(procs[0]?.id||""),[dur,setDur]=useState("2");
  return(<div className="p-5">
    <div className="flex items-center justify-between mb-1"><h3 className="text-lg font-semibold" style={{fontFamily:"ui-serif,Georgia,serif",color:ESP}}>Novo agendamento</h3>
      <button onClick={onCancel} style={{color:ESP60}}><X size={20}/></button></div>
    <div className="text-xs mb-4" style={{color:ESP60}}>{cadeira} · início {start}</div>
    <L t="Paciente"/><input value={pac} onChange={e=>setPac(e.target.value)} placeholder="Nome do paciente" className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none" style={{border:`1px solid ${LINE}`,color:ESP}}/>
    <L t="Profissional"/><select value={prof} onChange={e=>setProf(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none bg-white" style={{border:`1px solid ${LINE}`,color:ESP}}>{profs.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}</select>
    <L t="Procedimento"/><select value={proc} onChange={e=>setProc(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none bg-white" style={{border:`1px solid ${LINE}`,color:ESP}}>{procs.map(p=><option key={p.id} value={p.id}>{p.nome}</option>)}</select>
    <L t="Duração"/><select value={dur} onChange={e=>setDur(e.target.value)} className="w-full rounded-xl px-3 py-2 text-sm mb-4 outline-none bg-white" style={{border:`1px solid ${LINE}`,color:ESP}}>
      <option value="1">30 min</option><option value="2">1 hora</option><option value="3">1h30</option><option value="4">2 horas</option></select>
    <button onClick={()=>onAdd({pac:pac||"Paciente",prof,proc,dur:Number(dur)})} className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{background:GOLD,color:"#fff"}}>
      <Plus size={16}/> Adicionar à agenda</button>
  </div>);
}
function L({t}:{t:string}){return <label className="block text-xs font-medium mb-1" style={{color:ESP}}>{t}</label>;}
