"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const CATEGORIAS=["parede","forro","revestimento","divisoria","shaft","outro"];
const UNIDADES=["un","m","m²","kg","L","rolo","saco","caixa","par","pç"];

const TEMPLATES:Record<string,{nome:string;cat:string;mo:number;itens:{nome:string;un:string;qtd:number;preco:number}[]}> = {
  parede_simples:{nome:"Parede Drywall Simples 73mm (ST)",cat:"parede",mo:35,itens:[
    {nome:"Placa ST 1200x2400x12,5mm",un:"un",qtd:2.10,preco:28.50},
    {nome:"Montante 48x3000mm #0.50",un:"m",qtd:2.80,preco:4.20},
    {nome:"Guia 48x3000mm #0.50",un:"m",qtd:0.80,preco:3.90},
    {nome:"Parafuso TA 3,5x25mm (placa-perfil)",un:"un",qtd:24,preco:0.04},
    {nome:"Parafuso PA 4,2x13mm (perfil-perfil)",un:"un",qtd:4,preco:0.05},
    {nome:"Fita de papel microperfurada 50mm",un:"m",qtd:2.50,preco:0.28},
    {nome:"Massa para juntas (pó) 1kg",un:"kg",qtd:0.50,preco:4.80},
    {nome:"Fita Drywall adesiva 48mm",un:"m",qtd:0.30,preco:0.35},
    {nome:"Banda acústica 50mm",un:"m",qtd:0.80,preco:1.20},
    {nome:"Bucha + fixador para guia (piso/teto)",un:"un",qtd:1.60,preco:0.45},
  ]},
  parede_dupla:{nome:"Parede Drywall Dupla 98mm (ST+ST)",cat:"parede",mo:48,itens:[
    {nome:"Placa ST 1200x2400x12,5mm",un:"un",qtd:4.20,preco:28.50},
    {nome:"Montante 70x3000mm #0.50",un:"m",qtd:2.80,preco:5.10},
    {nome:"Guia 70x3000mm #0.50",un:"m",qtd:0.80,preco:4.50},
    {nome:"Parafuso TA 3,5x25mm",un:"un",qtd:48,preco:0.04},
    {nome:"Parafuso TA 3,5x35mm (2ª placa)",un:"un",qtd:24,preco:0.05},
    {nome:"Parafuso PA 4,2x13mm",un:"un",qtd:4,preco:0.05},
    {nome:"Fita de papel microperfurada 50mm",un:"m",qtd:5.00,preco:0.28},
    {nome:"Massa para juntas (pó) 1kg",un:"kg",qtd:0.80,preco:4.80},
    {nome:"Lã de vidro/rocha 50mm",un:"m²",qtd:1.05,preco:12.50},
    {nome:"Banda acústica 70mm",un:"m",qtd:0.80,preco:1.40},
    {nome:"Bucha + fixador",un:"un",qtd:1.60,preco:0.45},
  ]},
  parede_umida:{nome:"Parede Drywall Área Úmida 73mm (RU)",cat:"parede",mo:38,itens:[
    {nome:"Placa RU (verde) 1200x2400x12,5mm",un:"un",qtd:2.10,preco:38.90},
    {nome:"Montante 48x3000mm #0.50",un:"m",qtd:2.80,preco:4.20},
    {nome:"Guia 48x3000mm #0.50",un:"m",qtd:0.80,preco:3.90},
    {nome:"Parafuso TA 3,5x25mm",un:"un",qtd:24,preco:0.04},
    {nome:"Parafuso PA 4,2x13mm",un:"un",qtd:4,preco:0.05},
    {nome:"Fita de papel microperfurada 50mm",un:"m",qtd:2.50,preco:0.28},
    {nome:"Massa para juntas (pó) 1kg",un:"kg",qtd:0.50,preco:4.80},
    {nome:"Banda acústica 50mm",un:"m",qtd:0.80,preco:1.20},
    {nome:"Bucha + fixador",un:"un",qtd:1.60,preco:0.45},
    {nome:"Silicone acético (junção piso/box)",un:"m",qtd:0.50,preco:2.80},
  ]},
  forro_tabicado:{nome:"Forro Drywall Tabicado (ST)",cat:"forro",mo:30,itens:[
    {nome:"Placa ST 1200x2400x12,5mm",un:"un",qtd:1.05,preco:28.50},
    {nome:"Canaleta F530 (perfil primário)",un:"m",qtd:1.00,preco:6.20},
    {nome:"Canaleta F530 (perfil secundário)",un:"m",qtd:3.33,preco:6.20},
    {nome:"Pendural regulável c/ tirante",un:"un",qtd:1.00,preco:3.50},
    {nome:"Arame galvanizado #18",un:"m",qtd:1.50,preco:0.30},
    {nome:"Parafuso TA 3,5x25mm",un:"un",qtd:12,preco:0.04},
    {nome:"Fita de papel microperfurada 50mm",un:"m",qtd:2.00,preco:0.28},
    {nome:"Massa para juntas (pó) 1kg",un:"kg",qtd:0.40,preco:4.80},
    {nome:"Bucha + prego de aço (fixação teto)",un:"un",qtd:1.00,preco:0.60},
  ]},
  forro_modular:{nome:"Forro Modular Mineral 625x625mm",cat:"forro",mo:22,itens:[
    {nome:"Placa mineral 625x625x14mm",un:"un",qtd:2.56,preco:14.80},
    {nome:"Perfil T principal 24mm (3660mm)",un:"m",qtd:0.84,preco:7.50},
    {nome:"Perfil T secundário 24mm (1250mm)",un:"m",qtd:1.68,preco:4.20},
    {nome:"Perfil T terciário 24mm (625mm)",un:"m",qtd:1.68,preco:2.80},
    {nome:"Cantoneira de parede 24x19mm",un:"m",qtd:0.40,preco:3.20},
    {nome:"Pendural regulável c/ tirante",un:"m",qtd:1.00,preco:3.50},
    {nome:"Arame galvanizado #18",un:"m",qtd:1.50,preco:0.30},
    {nome:"Bucha + prego de aço",un:"un",qtd:1.00,preco:0.60},
    {nome:"Rebite 4,0x12mm",un:"un",qtd:2,preco:0.08},
  ]},
};

type FichaTec = { id:string; nome:string; categoria:string; descricao:string; unidade:string; mao_obra_direta:number; custos_indiretos_pct:number; impostos_pct:number; markup_pct:number; ativo:boolean; };
type FichaItem = { id:string; ficha_id:string; ordem:number; nome:string; unidade:string; quantidade:number; preco_unitario:number; fornecedor:string; obs:string; };

export default function FichaTecnicaPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [selComp,setSelComp]=useState("");
  const [fichas,setFichas]=useState<FichaTec[]>([]);
  const [selFicha,setSelFicha]=useState<string|null>(null);
  const [itens,setItens]=useState<FichaItem[]>([]);
  const [loading,setLoading]=useState(true);
  const [msg,setMsg]=useState("");
  const [showNew,setShowNew]=useState(false);
  const [showTemplate,setShowTemplate]=useState(false);
  const [seeding,setSeeding]=useState(false);
  const [newNome,setNewNome]=useState("");
  const [newCat,setNewCat]=useState("parede");
  const [newMO,setNewMO]=useState("35");
  const [newInd,setNewInd]=useState("15");
  const [newImp,setNewImp]=useState("8.65");
  const [newMarkup,setNewMarkup]=useState("30");
  // Item editing
  const [editItem,setEditItem]=useState<Partial<FichaItem>|null>(null);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selComp)loadFichas();},[selComp]);
  useEffect(()=>{if(selFicha)loadItens();},[selFicha]);

  const loadCompanies=async()=>{
    const{data}=await supabase.from("companies").select("*").order("nome_fantasia");
    if(data&&data.length>0){setCompanies(data);setSelComp(data[0].id);}
    setLoading(false);
  };

  const loadFichas=async()=>{
    setLoading(true);
    const{data}=await supabase.from("fichas_tecnicas").select("*").eq("company_id",selComp).order("categoria,nome");
    setFichas((data as FichaTec[])||[]);
    setLoading(false);
  };

  const loadItens=async()=>{
    const{data}=await supabase.from("ficha_itens").select("*").eq("ficha_id",selFicha).order("ordem");
    setItens((data as FichaItem[])||[]);
  };

  const criarFicha=async()=>{
    if(!newNome.trim())return;
    const{data}=await supabase.from("fichas_tecnicas").insert({
      company_id:selComp,nome:newNome,categoria:newCat,unidade:"m²",
      mao_obra_direta:parseFloat(newMO)||0,custos_indiretos_pct:parseFloat(newInd)||0,
      impostos_pct:parseFloat(newImp)||0,markup_pct:parseFloat(newMarkup)||0,
    }).select().single();
    if(data){setSelFicha(data.id);setShowNew(false);setNewNome("");loadFichas();}
    setMsg("Ficha criada! Adicione os itens.");setTimeout(()=>setMsg(""),3000);
  };

  const criarDeTemplate=async(tplKey:string)=>{
    const tpl=TEMPLATES[tplKey];
    if(!tpl)return;
    const{data:ficha}=await supabase.from("fichas_tecnicas").insert({
      company_id:selComp,nome:tpl.nome,categoria:tpl.cat,unidade:"m²",
      mao_obra_direta:tpl.mo,custos_indiretos_pct:15,impostos_pct:8.65,markup_pct:30,
    }).select().single();
    if(ficha){
      for(let i=0;i<tpl.itens.length;i++){
        const it=tpl.itens[i];
        await supabase.from("ficha_itens").insert({ficha_id:ficha.id,ordem:i+1,nome:it.nome,unidade:it.un,quantidade:it.qtd,preco_unitario:it.preco});
      }
      setSelFicha(ficha.id);setShowTemplate(false);loadFichas();
      setMsg(`Ficha "${tpl.nome}" criada com ${tpl.itens.length} itens!`);setTimeout(()=>setMsg(""),3000);
    }
  };

  const addItem=async()=>{
    if(!selFicha||!editItem?.nome)return;
    await supabase.from("ficha_itens").insert({
      ficha_id:selFicha,ordem:itens.length+1,nome:editItem.nome,
      unidade:editItem.unidade||"un",quantidade:editItem.quantidade||0,
      preco_unitario:editItem.preco_unitario||0,fornecedor:editItem.fornecedor||"",
    });
    setEditItem(null);loadItens();
  };

  const updateItem=async(id:string,field:string,value:any)=>{
    await supabase.from("ficha_itens").update({[field]:value}).eq("id",id);
    loadItens();
  };

  const deleteItem=async(id:string)=>{
    await supabase.from("ficha_itens").delete().eq("id",id);loadItens();
  };

  const updateFicha=async(field:string,value:any)=>{
    if(!selFicha)return;
    await supabase.from("fichas_tecnicas").update({[field]:value,updated_at:new Date().toISOString()}).eq("id",selFicha);
    loadFichas();
  };

  const seedDatabase=async()=>{
    setSeeding(true);
    try{
      const res=await fetch("/api/ficha-tecnica/seed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company_id:selComp})});
      const d=await res.json();
      if(d.success){setMsg(`✅ ${d.fichas_criadas} fichas + ${d.itens_criados} itens criados! (${d.total_materiais} materiais base)`);loadFichas();}
      else setMsg(`❌ ${d.error}`);
    }catch(e:any){setMsg(`❌ ${e.message}`);}
    setSeeding(false);setTimeout(()=>setMsg(""),5000);
  };

  const deleteFicha=async()=>{
    if(!selFicha||!confirm("Excluir esta ficha e todos os itens?"))return;
    await supabase.from("fichas_tecnicas").delete().eq("id",selFicha);
    setSelFicha(null);setItens([]);loadFichas();
    setMsg("Ficha excluída.");setTimeout(()=>setMsg(""),3000);
  };

  // Calculations
  const fichaAtual=fichas.find(f=>f.id===selFicha);
  const subtotalMat=itens.reduce((s,i)=>s+i.quantidade*i.preco_unitario,0);
  const mo=fichaAtual?.mao_obra_direta||0;
  const custoBase=subtotalMat+mo;
  const indiretoR=custoBase*(fichaAtual?.custos_indiretos_pct||0)/100;
  const custoTotal=custoBase+indiretoR;
  const impostoR=custoTotal*(fichaAtual?.impostos_pct||0)/100;
  const custoFinal=custoTotal+impostoR;
  const precoVenda=custoFinal*(1+(fichaAtual?.markup_pct||0)/100);
  const lucroUnit=precoVenda-custoFinal;

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",width:"100%",fontFamily:"inherit"};
  const inpSm:React.CSSProperties={...inp,width:90,textAlign:"right" as const,padding:"6px 8px"};

  return(
    <div style={{padding:20,maxWidth:1200,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>🔧 Ficha Técnica de Produção</div>
          <div style={{fontSize:11,color:TXM}}>Composição de custo por m² — base para análise de projetos e formação de preço</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <select value={selComp} onChange={e=>setSelComp(e.target.value)} style={{...inp,width:200}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:G+"15",border:`1px solid ${G}30`,borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:12,color:G,cursor:"pointer"}}>{msg}</div>}

      <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:14}}>
        {/* Left: fichas list */}
        <div>
          <div style={{display:"flex",gap:4,marginBottom:8,flexWrap:"wrap"}}>
            <button onClick={()=>setShowTemplate(true)} style={{flex:1,padding:"8px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:10,fontWeight:700,border:"none",cursor:"pointer"}}>📋 Template</button>
            <button onClick={()=>setShowNew(true)} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TX,fontSize:10,cursor:"pointer"}}>+ Nova</button>
            <button onClick={seedDatabase} disabled={seeding} style={{width:"100%",padding:"8px",borderRadius:8,background:seeding?BD:G+"15",border:`1px solid ${G}30`,color:seeding?TXD:G,fontSize:10,fontWeight:600,cursor:seeding?"wait":"pointer",marginTop:2}}>
              {seeding?"⏳ Criando 50 fichas...":"🚀 Carregar 50 Fichas + 35 Materiais"}
            </button>
          </div>

          {/* Template modal */}
          {showTemplate&&(
            <div style={{background:BG2,borderRadius:12,padding:12,border:`1px solid ${GO}30`,marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:8}}>Templates Prontos</div>
              {Object.entries(TEMPLATES).map(([k,v])=>(
                <div key={k} onClick={()=>criarDeTemplate(k)} style={{padding:"8px 10px",borderRadius:8,border:`1px solid ${BD}`,marginBottom:4,cursor:"pointer",background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background=BG3} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{fontSize:11,color:TX,fontWeight:500}}>{v.nome}</div>
                  <div style={{fontSize:9,color:TXD}}>{v.itens.length} itens | MO: R$ {v.mo}/m²</div>
                </div>
              ))}
              <button onClick={()=>setShowTemplate(false)} style={{width:"100%",padding:"6px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer",marginTop:4}}>Cancelar</button>
            </div>
          )}

          {/* New ficha form */}
          {showNew&&(
            <div style={{background:BG2,borderRadius:12,padding:12,border:`1px solid ${GO}30`,marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:8}}>Nova Ficha</div>
              <input value={newNome} onChange={e=>setNewNome(e.target.value)} placeholder="Nome da tipologia" style={{...inp,marginBottom:6}}/>
              <select value={newCat} onChange={e=>setNewCat(e.target.value)} style={{...inp,marginBottom:6}}>
                {CATEGORIAS.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}
              </select>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:6}}>
                <input value={newMO} onChange={e=>setNewMO(e.target.value)} placeholder="MO R$/m²" type="number" style={inp}/>
                <input value={newInd} onChange={e=>setNewInd(e.target.value)} placeholder="Indir. %" type="number" style={inp}/>
              </div>
              <div style={{display:"flex",gap:4}}>
                <button onClick={criarFicha} style={{flex:1,padding:"8px",borderRadius:6,background:GO,color:BG,fontSize:11,fontWeight:600,border:"none",cursor:"pointer"}}>Criar</button>
                <button onClick={()=>setShowNew(false)} style={{padding:"8px",borderRadius:6,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:10,cursor:"pointer"}}>X</button>
              </div>
            </div>
          )}

          {/* Fichas list */}
          {fichas.map(f=>{
            const isSel=f.id===selFicha;
            return(
              <div key={f.id} onClick={()=>setSelFicha(f.id)} style={{
                padding:"10px 12px",borderRadius:10,marginBottom:4,cursor:"pointer",
                background:isSel?`${GO}10`:BG2,border:`1px solid ${isSel?GO+"50":BD}`,
                borderLeft:`4px solid ${f.categoria==="parede"?GO:f.categoria==="forro"?B:f.categoria==="revestimento"?G:P}`,
              }}>
                <div style={{fontSize:12,fontWeight:isSel?600:400,color:isSel?GOL:TX}}>{f.nome}</div>
                <div style={{fontSize:9,color:TXD,marginTop:2}}><span style={{color:isSel?GO:TXM,fontFamily:"monospace"}}>{(f as any).codigo||""}</span> | {f.categoria}</div>
              </div>
            );
          })}
          {fichas.length===0&&!loading&&(
            <div style={{padding:16,textAlign:"center",color:TXD,fontSize:11}}>Nenhuma ficha criada. Use um template ou crie do zero.</div>
          )}
        </div>

        {/* Right: ficha detail */}
        <div>
          {!selFicha?(
            <div style={{background:BG2,borderRadius:14,padding:40,border:`1px solid ${BD}`,textAlign:"center"}}>
              <div style={{fontSize:32,marginBottom:8}}>🔧</div>
              <div style={{fontSize:14,color:TX}}>Selecione ou crie uma Ficha Técnica</div>
              <div style={{fontSize:11,color:TXM,marginTop:4}}>Use os templates para começar rápido com fichas prontas para drywall e forro.</div>
            </div>
          ):fichaAtual&&(
            <div>
              {/* Header with params */}
              <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{fontSize:16,fontWeight:700,color:GOL}}>{fichaAtual.nome}</div>
                  <button onClick={deleteFicha} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${R}30`,background:"transparent",color:R,fontSize:10,cursor:"pointer"}}>🗑 Excluir</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                  <div>
                    <div style={{fontSize:9,color:TXM,marginBottom:2}}>MO Direta (R$/m²)</div>
                    <input value={fichaAtual.mao_obra_direta} onChange={e=>updateFicha("mao_obra_direta",parseFloat(e.target.value)||0)} type="number" style={inpSm}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:TXM,marginBottom:2}}>Custos Indiretos (%)</div>
                    <input value={fichaAtual.custos_indiretos_pct} onChange={e=>updateFicha("custos_indiretos_pct",parseFloat(e.target.value)||0)} type="number" style={inpSm}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:TXM,marginBottom:2}}>Impostos (%)</div>
                    <input value={fichaAtual.impostos_pct} onChange={e=>updateFicha("impostos_pct",parseFloat(e.target.value)||0)} type="number" style={inpSm}/>
                  </div>
                  <div>
                    <div style={{fontSize:9,color:TXM,marginBottom:2}}>Markup (%)</div>
                    <input value={fichaAtual.markup_pct} onChange={e=>updateFicha("markup_pct",parseFloat(e.target.value)||0)} type="number" style={inpSm}/>
                  </div>
                </div>
              </div>

              {/* KPI cards */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(120px, 1fr))",gap:8,marginBottom:10}}>
                {[
                  {l:"Material",v:`R$ ${fmtR(subtotalMat)}`,c:TX},
                  {l:"Mão de Obra",v:`R$ ${fmtR(mo)}`,c:B},
                  {l:"Indiretos",v:`R$ ${fmtR(indiretoR)}`,c:Y},
                  {l:"Impostos",v:`R$ ${fmtR(impostoR)}`,c:R},
                  {l:"CUSTO TOTAL",v:`R$ ${fmtR(custoFinal)}`,c:GOL},
                  {l:"PREÇO VENDA",v:`R$ ${fmtR(precoVenda)}`,c:G},
                  {l:"Lucro/m²",v:`R$ ${fmtR(lucroUnit)}`,c:lucroUnit>0?G:R},
                ].map((k,i)=>(
                  <div key={i} style={{background:i>=4?"linear-gradient(135deg,#1a1510,#161614)":BG2,borderRadius:10,padding:"10px",border:`1px solid ${i>=4?GO+"30":BD}`,textAlign:"center"}}>
                    <div style={{fontSize:8,color:TXM,textTransform:"uppercase",letterSpacing:0.5}}>{k.l}</div>
                    <div style={{fontSize:i>=4?15:13,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
                  </div>
                ))}
              </div>

              {/* Items table */}
              <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
                <div style={{overflowX:"auto",maxHeight:400,overflowY:"auto"}}>
                  <table style={{width:"100%",fontSize:11,minWidth:700}}>
                    <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}>
                      <tr style={{borderBottom:`1px solid ${BD}`}}>
                        <th style={{padding:"8px",textAlign:"left",color:GO,fontSize:10,fontWeight:600,width:30}}>#</th>
                        <th style={{padding:"8px",textAlign:"left",color:GO,fontSize:10,fontWeight:600,width:90}}>CÓDIGO</th>
                        <th style={{padding:"8px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>MATERIAL / INSUMO</th>
                        <th style={{padding:"8px",textAlign:"center",color:GO,fontSize:10,fontWeight:600}}>UN</th>
                        <th style={{padding:"8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>QTD/m²</th>
                        <th style={{padding:"8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>PREÇO UN.</th>
                        <th style={{padding:"8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>CUSTO/m²</th>
                        <th style={{padding:"8px",textAlign:"center",color:GO,fontSize:10,fontWeight:600,width:50}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {itens.map((item,i)=>(
                        <tr key={item.id} style={{borderBottom:`0.5px solid ${BD}30`}}>
                          <td style={{padding:"6px 8px",color:TXD,fontSize:10}}>{i+1}</td>
                          <td style={{padding:"6px 8px",color:B,fontSize:10,fontFamily:"monospace"}}>{(item as any).codigo||"—"}</td>
                          <td style={{padding:"6px 8px",color:TX,fontSize:12,fontWeight:500}}>{item.nome}</td>
                          <td style={{padding:"6px 8px",textAlign:"center",color:TXM}}>{item.unidade}</td>
                          <td style={{padding:"6px 8px",textAlign:"right"}}>
                            <input value={item.quantidade} onChange={e=>updateItem(item.id,"quantidade",parseFloat(e.target.value)||0)} type="number" step="0.01" style={{...inpSm,width:70}}/>
                          </td>
                          <td style={{padding:"6px 8px",textAlign:"right"}}>
                            <input value={item.preco_unitario} onChange={e=>updateItem(item.id,"preco_unitario",parseFloat(e.target.value)||0)} type="number" step="0.01" style={{...inpSm,width:80}}/>
                          </td>
                          <td style={{padding:"6px 8px",textAlign:"right",fontWeight:600,color:GOL}}>R$ {fmtR(item.quantidade*item.preco_unitario)}</td>
                          <td style={{padding:"6px 8px",textAlign:"center"}}>
                            <button onClick={()=>deleteItem(item.id)} style={{background:"transparent",border:"none",color:R,cursor:"pointer",fontSize:12}}>×</button>
                          </td>
                        </tr>
                      ))}
                      {/* Add new item row */}
                      <tr style={{background:BG3}}>
                        <td style={{padding:"6px 8px",color:G}}>+</td>
                        <td style={{padding:"6px 8px"}}><input value={editItem?.obs||""} onChange={e=>setEditItem({...editItem,obs:e.target.value})} placeholder="Código" style={{...inp,fontSize:10,width:80}}/></td>
                        <td style={{padding:"6px 8px"}}><input value={editItem?.nome||""} onChange={e=>setEditItem({...editItem,nome:e.target.value})} placeholder="Nome do material" style={{...inp,fontSize:11}}/></td>
                        <td style={{padding:"6px 8px"}}><select value={editItem?.unidade||"un"} onChange={e=>setEditItem({...editItem,unidade:e.target.value})} style={{...inp,width:60,fontSize:10}}>{UNIDADES.map(u=><option key={u}>{u}</option>)}</select></td>
                        <td style={{padding:"6px 8px"}}><input value={editItem?.quantidade||""} onChange={e=>setEditItem({...editItem,quantidade:parseFloat(e.target.value)||0})} type="number" step="0.01" placeholder="0" style={{...inpSm,width:70}}/></td>
                        <td style={{padding:"6px 8px"}}><input value={editItem?.preco_unitario||""} onChange={e=>setEditItem({...editItem,preco_unitario:parseFloat(e.target.value)||0})} type="number" step="0.01" placeholder="0.00" style={{...inpSm,width:80}}/></td>
                        <td colSpan={2} style={{padding:"6px 8px"}}><button onClick={addItem} disabled={!editItem?.nome} style={{padding:"4px 12px",borderRadius:6,background:editItem?.nome?GO:BD,color:editItem?.nome?BG:TXD,fontSize:10,fontWeight:600,border:"none",cursor:editItem?.nome?"pointer":"default"}}>Adicionar</button></td>
                      </tr>
                      {/* Total row */}
                      <tr style={{borderTop:`2px solid ${BD}`,background:"#1a1510"}}>
                        <td colSpan={6} style={{padding:"10px 8px",fontWeight:700,color:GOL,fontSize:12}}>SUBTOTAL MATERIAIS</td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:GOL,fontSize:14}}>R$ {fmtR(subtotalMat)}</td>
                        <td/>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
