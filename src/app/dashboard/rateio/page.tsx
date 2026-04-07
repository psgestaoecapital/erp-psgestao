"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const cores=["#C6973F","#34D399","#60A5FA","#F87171","#A78BFA","#FBBF24","#2DD4BF","#FF5722","#8BC34A","#E91E63"];

export default function RateioPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [groups,setGroups]=useState<any[]>([]);
  const [selectedGroup,setSelectedGroup]=useState("");
  const [linhas,setLinhas]=useState<any[]>([]);
  const [custosSede,setCustosSede]=useState<any[]>([]);
  const [custosDirectos,setCustosDirectos]=useState<any[]>([]);
  const [receitas,setReceitas]=useState<any[]>([]);
  const [tab,setTab]=useState<"linhas"|"sede"|"dre">("linhas");
  const [msg,setMsg]=useState("");
  const [showAddLinha,setShowAddLinha]=useState(false);
  const [showAddSede,setShowAddSede]=useState(false);
  const [showAddCusto,setShowAddCusto]=useState(false);
  const [showAddReceita,setShowAddReceita]=useState(false);
  const [selectedLinha,setSelectedLinha]=useState<string|null>(null);
  const [expandedLinha,setExpandedLinha]=useState<Record<string,boolean>>({});
  // Forms
  const [newLinha,setNewLinha]=useState({nome:"",descricao:"",cnpj_origem:"",responsavel:"",headcount:0,cor:cores[0]});
  const [newSede,setNewSede]=useState({nome:"",valor:0,criterio:"receita"});
  const [newCusto,setNewCusto]=useState({nome:"",valor:0,obs:""});
  const [newReceita,setNewReceita]=useState({nome:"",valor:0,obs:""});

  useEffect(()=>{loadAll();},[]);
  useEffect(()=>{if(selectedGroup&&typeof window!=="undefined")localStorage.setItem("ps_empresa_sel","group_"+selectedGroup);},[selectedGroup]);
  useEffect(()=>{if(selectedGroup)loadLinhas();},[selectedGroup]);

  const loadAll=async()=>{
    const{data:comps}=await supabase.from("companies").select("*").order("nome_fantasia");
    if(comps)setCompanies(comps);
    const{data:grps}=await supabase.from("company_groups").select("*").order("nome");
    if(grps){setGroups(grps);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";if(saved&&saved.startsWith("group_")){setSelectedGroup(saved.replace("group_",""));}else if(grps.length>0&&!selectedGroup){setSelectedGroup(grps[0].id);}}
  };

  const loadLinhas=async()=>{
    if(!selectedGroup)return;
    const compIds=companies.filter(c=>c.group_id===selectedGroup).map(c=>c.id);
    if(compIds.length===0)return;
    const{data:lns}=await supabase.from("business_line_config").select("*").in("company_id",compIds).eq("ativo",true).order("nome");
    if(lns)setLinhas(lns);
    const{data:cs}=await supabase.from("custos_sede").select("*").eq("group_id",selectedGroup).order("nome");
    if(cs)setCustosSede(cs);
    // Load custos and receitas for all lines
    if(lns&&lns.length>0){
      const lnIds=lns.map((l:any)=>l.id);
      const{data:cd}=await supabase.from("business_line_custos").select("*").in("business_line_id",lnIds).order("nome");
      if(cd)setCustosDirectos(cd);
      const{data:rc}=await supabase.from("business_line_receitas").select("*").in("business_line_id",lnIds).order("nome");
      if(rc)setReceitas(rc);
    }
  };

  const addLinha=async()=>{
    if(!newLinha.nome.trim()||!selectedGroup)return;
    const compId=companies.find(c=>c.group_id===selectedGroup)?.id;
    if(!compId){setMsg("Nenhuma empresa no grupo.");return;}
    await supabase.from("business_line_config").insert({...newLinha,company_id:compId,group_id:selectedGroup,rateio_modo:"receita",rateio_pct:0});
    setShowAddLinha(false);setNewLinha({nome:"",descricao:"",cnpj_origem:"",responsavel:"",headcount:0,cor:cores[linhas.length%cores.length]});
    setMsg("Linha de negócio criada!");loadLinhas();setTimeout(()=>setMsg(""),3000);
  };

  const addCustoSede=async()=>{
    if(!newSede.nome.trim()||!selectedGroup)return;
    await supabase.from("custos_sede").insert({...newSede,group_id:selectedGroup,periodo:new Date().toISOString().slice(0,7)});
    setShowAddSede(false);setNewSede({nome:"",valor:0,criterio:"receita"});
    setMsg("Custo da sede adicionado!");loadLinhas();setTimeout(()=>setMsg(""),3000);
  };

  const addCustoDirecto=async()=>{
    if(!newCusto.nome.trim()||!selectedLinha)return;
    await supabase.from("business_line_custos").insert({...newCusto,business_line_id:selectedLinha,tipo:"direto",periodo:new Date().toISOString().slice(0,7)});
    setShowAddCusto(false);setNewCusto({nome:"",valor:0,obs:""});
    setMsg("Custo direto adicionado!");loadLinhas();setTimeout(()=>setMsg(""),3000);
  };

  const addReceitaLinha=async()=>{
    if(!newReceita.nome.trim()||!selectedLinha)return;
    await supabase.from("business_line_receitas").insert({...newReceita,business_line_id:selectedLinha,periodo:new Date().toISOString().slice(0,7)});
    setShowAddReceita(false);setNewReceita({nome:"",valor:0,obs:""});
    setMsg("Receita adicionada!");loadLinhas();setTimeout(()=>setMsg(""),3000);
  };

  const excluirItem=async(tabela:string,id:string)=>{
    await supabase.from(tabela).delete().eq("id",id);
    setMsg("Excluído.");loadLinhas();setTimeout(()=>setMsg(""),2000);
  };

  // Cálculos do rateio
  const totalReceitaGeral=useMemo(()=>linhas.reduce((s,l)=>{
    const rec=receitas.filter(r=>r.business_line_id===l.id).reduce((s2:number,r:any)=>s2+Number(r.valor),0);
    return s+rec;
  },0),[linhas,receitas]);

  const totalSede=useMemo(()=>custosSede.reduce((s,c)=>s+Number(c.valor),0),[custosSede]);

  const dreLinhas=useMemo(()=>linhas.map(l=>{
    const rec=receitas.filter(r=>r.business_line_id===l.id).reduce((s:number,r:any)=>s+Number(r.valor),0);
    const custDir=custosDirectos.filter(c=>c.business_line_id===l.id).reduce((s:number,c:any)=>s+Number(c.valor),0);
    const pctReceita=totalReceitaGeral>0?(rec/totalReceitaGeral):0;
    const sedeAlocada=totalSede*pctReceita;
    const margemDireta=rec-custDir;
    const margemDiretaPct=rec>0?(margemDireta/rec*100):0;
    const lucroReal=margemDireta-sedeAlocada;
    const lucroRealPct=rec>0?(lucroReal/rec*100):0;
    return{...l,receita:rec,custoDirecto:custDir,margemDireta,margemDiretaPct,pctReceita:pctReceita*100,sedeAlocada,lucroReal,lucroRealPct};
  }),[linhas,receitas,custosDirectos,totalReceitaGeral,totalSede]);

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",width:"100%",fontFamily:"inherit"};

  return(
    <div style={{padding:20,maxWidth:1100,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>📊 Linhas de Negócio & Rateio de Custos</div>
          <div style={{fontSize:11,color:TXD}}>Custos diretos + rateio da sede = margem real de cada negócio</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
          <a href="/dashboard/dados" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TXM,fontSize:11,textDecoration:"none"}}>📊 Dados</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:G+"15",border:`1px solid ${G}30`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:G,cursor:"pointer"}}>{msg}</div>}

      {/* Group selector */}
      <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`,marginBottom:14}}>
        <div style={{fontSize:10,color:TXD,textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Grupo de Empresas</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {groups.map(g=>(
            <button key={g.id} onClick={()=>setSelectedGroup(g.id)} style={{
              padding:"8px 16px",borderRadius:8,fontSize:12,border:selectedGroup===g.id?`1px solid ${g.cor||GO}`:`1px solid ${BD}`,
              background:selectedGroup===g.id?`${g.cor||GO}10`:"transparent",color:selectedGroup===g.id?g.cor||GOL:TXM,fontWeight:selectedGroup===g.id?600:400,cursor:"pointer",
            }}>{g.nome} ({companies.filter(c=>c.group_id===g.id).length} CNPJs)</button>
          ))}
          {groups.length===0&&<div style={{fontSize:12,color:TXD}}>Nenhum grupo. Crie um grupo no Admin → Empresas.</div>}
        </div>
      </div>

      {/* Tabs */}
      {selectedGroup&&(
        <div style={{display:"flex",gap:4,marginBottom:14}}>
          {([["linhas","📋 Negócios & Custos"],["sede","🏢 Custos da Sede"],["dre","📊 DRE por Negócio"]] as const).map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} style={{
              padding:"8px 18px",borderRadius:10,fontSize:11,border:tab===id?`1px solid ${GO}50`:"1px solid transparent",
              background:tab===id?`${GO}10`:"transparent",color:tab===id?GOL:TXM,fontWeight:tab===id?600:400,
            }}>{label}</button>
          ))}
        </div>
      )}

      {/* TAB: LINHAS DE NEGÓCIO */}
      {tab==="linhas"&&selectedGroup&&(<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <span style={{fontSize:14,fontWeight:600,color:TX}}>{linhas.length} linhas de negócio</span>
          <button onClick={()=>setShowAddLinha(true)} style={{padding:"6px 14px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Linha de Negócio</button>
        </div>

        {showAddLinha&&(
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${GO}30`,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:10}}>Nova Linha de Negócio</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome *</div><input value={newLinha.nome} onChange={e=>setNewLinha({...newLinha,nome:e.target.value})} placeholder="Ex: Gesso Oeste, Litoral, Tintas, Pintura" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Descrição</div><input value={newLinha.descricao} onChange={e=>setNewLinha({...newLinha,descricao:e.target.value})} placeholder="Ex: Produção e venda de gesso no Oeste SC" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>CNPJ de Origem</div><input value={newLinha.cnpj_origem} onChange={e=>setNewLinha({...newLinha,cnpj_origem:e.target.value})} placeholder="Qual CNPJ opera este negócio" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Responsável</div><input value={newLinha.responsavel} onChange={e=>setNewLinha({...newLinha,responsavel:e.target.value})} placeholder="Nome do gestor" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Headcount</div><input type="number" value={newLinha.headcount||""} onChange={e=>setNewLinha({...newLinha,headcount:parseInt(e.target.value)||0})} placeholder="Qtd funcionários" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Cor</div>
                <div style={{display:"flex",gap:4}}>{cores.map(c=>(<div key={c} onClick={()=>setNewLinha({...newLinha,cor:c})} style={{width:24,height:24,borderRadius:6,background:c,cursor:"pointer",border:newLinha.cor===c?"2px solid white":"2px solid transparent"}}/>))}</div>
              </div>
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button onClick={addLinha} style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Criar</button>
              <button onClick={()=>setShowAddLinha(false)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Lines list */}
        {linhas.map((l,li)=>{
          const isOpen=!!expandedLinha[l.id];
          const recLinha=receitas.filter(r=>r.business_line_id===l.id);
          const custLinha=custosDirectos.filter(c=>c.business_line_id===l.id);
          const totalRec=recLinha.reduce((s:number,r:any)=>s+Number(r.valor),0);
          const totalCust=custLinha.reduce((s:number,c:any)=>s+Number(c.valor),0);
          return(
            <div key={l.id} style={{background:BG2,borderRadius:12,marginBottom:8,border:`1px solid ${BD}`,borderLeft:`4px solid ${l.cor||GO}`,overflow:"hidden"}}>
              <div onClick={()=>setExpandedLinha({...expandedLinha,[l.id]:!isOpen})} style={{padding:"12px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:14,color:l.cor||GO,transition:"transform 0.2s",transform:isOpen?"rotate(90deg)":"rotate(0)"}}> ▶</span>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:TX}}>{l.nome}</div>
                    <div style={{fontSize:10,color:TXD}}>{l.descricao||""}{l.cnpj_origem?` · CNPJ: ${l.cnpj_origem}`:""}{l.headcount?` · ${l.headcount} pessoas`:""}</div>
                  </div>
                </div>
                <div style={{display:"flex",gap:16,alignItems:"center"}}>
                  <div style={{textAlign:"right"}}><div style={{fontSize:9,color:TXD}}>Receita</div><div style={{fontSize:13,fontWeight:600,color:G}}>{fmtR(totalRec)}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:9,color:TXD}}>Custos Dir.</div><div style={{fontSize:13,fontWeight:600,color:R}}>{fmtR(totalCust)}</div></div>
                  <div style={{textAlign:"right"}}><div style={{fontSize:9,color:TXD}}>Margem</div><div style={{fontSize:13,fontWeight:600,color:totalRec-totalCust>0?G:R}}>{totalRec>0?((totalRec-totalCust)/totalRec*100).toFixed(1):"0"}%</div></div>
                </div>
              </div>
              {isOpen&&(
                <div style={{borderTop:`1px solid ${BD}`,padding:16}}>
                  {/* Receitas */}
                  <div style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <span style={{fontSize:12,fontWeight:600,color:G}}>Receitas</span>
                      <button onClick={()=>{setSelectedLinha(l.id);setShowAddReceita(true);}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${G}30`,background:"transparent",color:G,fontSize:10,cursor:"pointer"}}>+ Receita</button>
                    </div>
                    {recLinha.length===0&&<div style={{fontSize:11,color:TXD,padding:"8px 0"}}>Nenhuma receita. Clique + Receita.</div>}
                    {recLinha.map((r:any)=>(
                      <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${BD}15`}}>
                        <span style={{fontSize:11,color:TXM}}>{r.nome}{r.obs?` (${r.obs})`:""}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:12,fontWeight:600,color:G}}>{fmtR(Number(r.valor))}</span>
                          <button onClick={()=>excluirItem("business_line_receitas",r.id)} style={{padding:"2px 6px",borderRadius:4,border:`1px solid ${R}20`,background:"transparent",color:R,fontSize:9,cursor:"pointer"}}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Custos diretos */}
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <span style={{fontSize:12,fontWeight:600,color:R}}>Custos Diretos</span>
                      <button onClick={()=>{setSelectedLinha(l.id);setShowAddCusto(true);}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${R}30`,background:"transparent",color:R,fontSize:10,cursor:"pointer"}}>+ Custo</button>
                    </div>
                    {custLinha.length===0&&<div style={{fontSize:11,color:TXD,padding:"8px 0"}}>Nenhum custo direto. Clique + Custo.</div>}
                    {custLinha.map((c:any)=>(
                      <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:`1px solid ${BD}15`}}>
                        <span style={{fontSize:11,color:TXM}}>{c.nome}{c.obs?` (${c.obs})`:""}</span>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:12,fontWeight:600,color:R}}>{fmtR(Number(c.valor))}</span>
                          <button onClick={()=>excluirItem("business_line_custos",c.id)} style={{padding:"2px 6px",borderRadius:4,border:`1px solid ${R}20`,background:"transparent",color:R,fontSize:9,cursor:"pointer"}}>✕</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {linhas.length===0&&<div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center",color:TXD,fontSize:12}}>Nenhuma linha de negócio. Clique "+ Linha de Negócio" para começar.</div>}
      </div>)}

      {/* TAB: CUSTOS DA SEDE */}
      {tab==="sede"&&selectedGroup&&(<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:TX}}>Custos Compartilhados da Sede</div>
            <div style={{fontSize:10,color:TXD}}>Estes custos serão rateados entre as linhas de negócio proporcionalmente à receita</div>
          </div>
          <button onClick={()=>setShowAddSede(true)} style={{padding:"6px 14px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>+ Custo da Sede</button>
        </div>

        {showAddSede&&(
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${GO}30`,marginBottom:12}}>
            <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:10}}>Novo Custo da Sede</div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:8}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Descrição *</div><input value={newSede.nome} onChange={e=>setNewSede({...newSede,nome:e.target.value})} placeholder="Ex: Aluguel, Veículos, Telefone, Contabilidade" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Valor Mensal (R$) *</div><input type="number" value={newSede.valor||""} onChange={e=>setNewSede({...newSede,valor:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/></div>
            </div>
            <div style={{marginTop:10,display:"flex",gap:8}}>
              <button onClick={addCustoSede} style={{padding:"8px 16px",borderRadius:8,background:GO,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
              <button onClick={()=>setShowAddSede(false)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
            </div>
          </div>
        )}

        {custosSede.length===0&&<div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center",color:TXD,fontSize:12}}>Nenhum custo da sede. Adicione: aluguel, veículos, telefone, contabilidade, etc.</div>}

        {custosSede.map((c:any)=>(
          <div key={c.id} style={{background:BG2,borderRadius:10,padding:"10px 16px",marginBottom:6,border:`1px solid ${BD}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:13,color:TX}}>{c.nome}</span>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:14,fontWeight:600,color:Y}}>{fmtR(Number(c.valor))}/mês</span>
              <button onClick={()=>excluirItem("custos_sede",c.id)} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${R}30`,background:"transparent",color:R,fontSize:10,cursor:"pointer"}}>🗑</button>
            </div>
          </div>
        ))}

        {custosSede.length>0&&(
          <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${GO}30`,marginTop:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:14,fontWeight:700,color:TX}}>TOTAL SEDE</span>
              <span style={{fontSize:18,fontWeight:700,color:Y}}>{fmtR(totalSede)}/mês</span>
            </div>
            <div style={{fontSize:10,color:TXD,marginTop:6}}>Este valor será distribuído entre as {linhas.length} linhas de negócio proporcionalmente à receita de cada uma.</div>
          </div>
        )}
      </div>)}

      {/* TAB: DRE POR NEGÓCIO */}
      {tab==="dre"&&selectedGroup&&(<div>
        <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>DRE por Linha de Negócio — com Rateio da Sede</div>
        <div style={{fontSize:10,color:TXD,marginBottom:14}}>Receita - Custos Diretos = Margem Direta. Margem Direta - Parcela da Sede = Lucro Real.</div>

        {/* Summary KPIs */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:8,marginBottom:14}}>
          {[
            {label:"Receita Total",value:fmtR(totalReceitaGeral),cor:G},
            {label:"Custos Diretos",value:fmtR(dreLinhas.reduce((s,d)=>s+d.custoDirecto,0)),cor:R},
            {label:"Custo Sede",value:fmtR(totalSede),cor:Y},
            {label:"Lucro Real Total",value:fmtR(dreLinhas.reduce((s,d)=>s+d.lucroReal,0)),cor:dreLinhas.reduce((s,d)=>s+d.lucroReal,0)>0?G:R},
          ].map((k,i)=>(
            <div key={i} style={{background:BG2,borderRadius:12,padding:"12px 14px",border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.label}</div>
              <div style={{fontSize:16,fontWeight:700,color:k.cor}}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* DRE Table */}
        {dreLinhas.length>0?(
          <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",fontSize:11,minWidth:700}}>
                <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                  {["Linha de Negócio","Receita","Custos Diretos","Margem Direta","% Receita","Sede Alocada","Lucro Real","Margem Real"].map(h=>(
                    <th key={h} style={{padding:"10px 8px",textAlign:h==="Linha de Negócio"?"left":"right",color:GO,fontSize:9,textTransform:"uppercase",letterSpacing:0.5,fontWeight:600}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {dreLinhas.map((d,i)=>(
                    <tr key={d.id} style={{borderBottom:`1px solid ${BD}20`}}>
                      <td style={{padding:"10px 8px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <div style={{width:10,height:10,borderRadius:3,background:d.cor||GO}}/>
                          <span style={{fontWeight:600,color:TX}}>{d.nome}</span>
                        </div>
                      </td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontWeight:600,color:G}}>{fmtR(d.receita)}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",color:R}}>{fmtR(d.custoDirecto)}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontWeight:600,color:d.margemDireta>0?TX:R}}>{fmtR(d.margemDireta)} <span style={{fontSize:9,color:TXD}}>({d.margemDiretaPct.toFixed(1)}%)</span></td>
                      <td style={{padding:"10px 8px",textAlign:"right",color:B,fontWeight:500}}>{d.pctReceita.toFixed(1)}%</td>
                      <td style={{padding:"10px 8px",textAlign:"right",color:Y}}>{fmtR(d.sedeAlocada)}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:d.lucroReal>0?G:R}}>{fmtR(d.lucroReal)}</td>
                      <td style={{padding:"10px 8px",textAlign:"right"}}>
                        <span style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:600,
                          background:d.lucroRealPct>10?G+"15":d.lucroRealPct>0?Y+"15":R+"15",
                          color:d.lucroRealPct>10?G:d.lucroRealPct>0?Y:R,
                        }}>{d.lucroRealPct.toFixed(1)}%</span>
                      </td>
                    </tr>
                  ))}
                  {/* Totals */}
                  <tr style={{borderTop:`2px solid ${BD}`,background:BG3}}>
                    <td style={{padding:"10px 8px",fontWeight:700,color:GOL}}>TOTAL</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:G}}>{fmtR(totalReceitaGeral)}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:R}}>{fmtR(dreLinhas.reduce((s,d)=>s+d.custoDirecto,0))}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:TX}}>{fmtR(dreLinhas.reduce((s,d)=>s+d.margemDireta,0))}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",color:B,fontWeight:700}}>100%</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:Y}}>{fmtR(totalSede)}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:dreLinhas.reduce((s,d)=>s+d.lucroReal,0)>0?G:R}}>{fmtR(dreLinhas.reduce((s,d)=>s+d.lucroReal,0))}</td>
                    <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:GOL}}>{totalReceitaGeral>0?(dreLinhas.reduce((s,d)=>s+d.lucroReal,0)/totalReceitaGeral*100).toFixed(1):"0"}%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        ):(
          <div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center",color:TXD,fontSize:12}}>
            Cadastre linhas de negócio com receitas e custos na aba anterior para ver o DRE.
          </div>
        )}

        {/* AI Analysis */}
        {dreLinhas.length>0&&dreLinhas.some(d=>d.receita>0)&&(
          <div style={{marginTop:12,background:BG2,borderRadius:12,padding:16,border:`1px solid ${GO}30`}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <div style={{width:24,height:24,borderRadius:6,background:`linear-gradient(135deg,${GO},${GOL})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:BG}}>PS</div>
              <span style={{fontSize:12,fontWeight:600,color:GOL}}>Análise IA — Linhas de Negócio</span>
            </div>
            {dreLinhas.filter(d=>d.lucroReal<0).map(d=>(
              <div key={d.id} style={{padding:"8px 12px",borderRadius:8,background:R+"10",border:`1px solid ${R}30`,marginBottom:6,fontSize:11,color:TXM,display:"flex",gap:8}}>
                <span>🔴</span><span><strong style={{color:R}}>{d.nome}</strong> está dando prejuízo de {fmtR(Math.abs(d.lucroReal))} após rateio. A margem direta de {d.margemDiretaPct.toFixed(1)}% não cobre a parcela da sede ({fmtR(d.sedeAlocada)}). Ação: aumentar preço ou reduzir custos diretos em {fmtR(Math.abs(d.lucroReal))}.</span>
              </div>
            ))}
            {dreLinhas.filter(d=>d.lucroRealPct>0&&d.lucroRealPct<5).map(d=>(
              <div key={d.id} style={{padding:"8px 12px",borderRadius:8,background:Y+"10",border:`1px solid ${Y}30`,marginBottom:6,fontSize:11,color:TXM,display:"flex",gap:8}}>
                <span>🟡</span><span><strong style={{color:Y}}>{d.nome}</strong> margem real de apenas {d.lucroRealPct.toFixed(1)}% ({fmtR(d.lucroReal)}). Qualquer aumento de custo pode virar prejuízo. Revisar precificação.</span>
              </div>
            ))}
            {dreLinhas.filter(d=>d.lucroRealPct>15).map(d=>(
              <div key={d.id} style={{padding:"8px 12px",borderRadius:8,background:G+"10",border:`1px solid ${G}30`,marginBottom:6,fontSize:11,color:TXM,display:"flex",gap:8}}>
                <span>🟢</span><span><strong style={{color:G}}>{d.nome}</strong> é o negócio mais rentável ({d.lucroRealPct.toFixed(1)}% de margem real). Representa {d.pctReceita.toFixed(0)}% da receita total. Investir em crescimento desta linha.</span>
              </div>
            ))}
          </div>
        )}
      </div>)}

      {/* Modal: Add Custo Direto */}
      {showAddCusto&&(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowAddCusto(false)}>
        <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:400,width:"100%",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:16,fontWeight:600,color:GOL,marginBottom:16}}>Adicionar Custo Direto</div>
          <div style={{marginBottom:12}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Descrição *</div><input value={newCusto.nome} onChange={e=>setNewCusto({...newCusto,nome:e.target.value})} placeholder="Ex: Matéria-prima, Mão de obra, Frete" style={inp}/></div>
          <div style={{marginBottom:12}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Valor Mensal (R$) *</div><input type="number" value={newCusto.valor||""} onChange={e=>setNewCusto({...newCusto,valor:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/></div>
          <div style={{marginBottom:16}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Observação</div><input value={newCusto.obs} onChange={e=>setNewCusto({...newCusto,obs:e.target.value})} placeholder="Opcional" style={inp}/></div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={addCustoDirecto} style={{padding:"10px 20px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
            <button onClick={()=>setShowAddCusto(false)} style={{padding:"10px 20px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      </div>)}

      {/* Modal: Add Receita */}
      {showAddReceita&&(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowAddReceita(false)}>
        <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:400,width:"100%",border:`1px solid ${BD}`}} onClick={e=>e.stopPropagation()}>
          <div style={{fontSize:16,fontWeight:600,color:GOL,marginBottom:16}}>Adicionar Receita</div>
          <div style={{marginBottom:12}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Descrição *</div><input value={newReceita.nome} onChange={e=>setNewReceita({...newReceita,nome:e.target.value})} placeholder="Ex: Venda de gesso, Serviço de pintura" style={inp}/></div>
          <div style={{marginBottom:12}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Valor Mensal (R$) *</div><input type="number" value={newReceita.valor||""} onChange={e=>setNewReceita({...newReceita,valor:parseFloat(e.target.value)||0})} placeholder="0,00" style={inp}/></div>
          <div style={{marginBottom:16}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Observação</div><input value={newReceita.obs} onChange={e=>setNewReceita({...newReceita,obs:e.target.value})} placeholder="Opcional" style={inp}/></div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={addReceitaLinha} style={{padding:"10px 20px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>Salvar</button>
            <button onClick={()=>setShowAddReceita(false)} style={{padding:"10px 20px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      </div>)}
    </div>
  );
}
