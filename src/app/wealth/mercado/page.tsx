"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authFetch";

const GO="#C6973F",GOL="#E8C872",G="#22C55E",Y="#FACC15",R="#EF4444",
  BG2="#161614",BG3="#1E1E1B",BD="#2A2822",TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",ESP="#3D2314",OW="#FAF7F2";

const CLASSES:{[k:string]:{l:string;c:string}}={
  acao:{l:"Ações",c:"#3B82F6"},fii:{l:"FIIs",c:"#22C55E"},fiagro:{l:"Fiagros",c:"#84CC16"},
  fi_infra:{l:"FI-Infras",c:"#06B6D4"},tesouro:{l:"Tesouro",c:"#F59E0B"},cdb:{l:"CDB",c:"#D97706"},
  lci:{l:"LCI",c:"#B45309"},lca:{l:"LCA",c:"#92400E"},debenture:{l:"Debêntures",c:"#8B5CF6"},
  fundo:{l:"Fundos",c:"#A78BFA"},etf:{l:"ETFs",c:"#EC4899"},bdr:{l:"BDRs",c:"#F43F5E"},
  cripto:{l:"Cripto",c:"#FB923C"},outro:{l:"Outros",c:"#6B7280"},
};

const fmtR=(v:number|null)=>v?`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"—";
const fmtP=(v:number|null)=>v!==null&&v!==undefined?`${v>=0?"+":""}${v.toFixed(2)}%`:"—";

interface Asset{
  id:string;ticker:string;nome:string;classe:string;setor:string;
  cotacao_atual:number;cotacao_anterior:number;variacao_dia:number;
  volume_dia:number;dy_12m:number;cotacao_atualizada_em:string;
}

export default function MercadoPage(){
  const [assets,setAssets]=useState<Asset[]>([]);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [search,setSearch]=useState("");
  const [filterClasse,setFilterClasse]=useState("todos");
  const [lastUpdate,setLastUpdate]=useState<string|null>(null);
  const [msg,setMsg]=useState<{t:string;ok:boolean}|null>(null);

  // Lookup ticker
  const [lookupTicker,setLookupTicker]=useState("");
  const [lookupResult,setLookupResult]=useState<any>(null);
  const [lookupLoading,setLookupLoading]=useState(false);

  const load=useCallback(async()=>{
    setLoading(true);
    const{data}=await supabase.from("wealth_assets").select("*").eq("ativo",true).order("ticker");
    setAssets(data||[]);
    if(data&&data.length>0){
      const latest=data.filter((a:any)=>a.cotacao_atualizada_em).sort((a:any,b:any)=>new Date(b.cotacao_atualizada_em).getTime()-new Date(a.cotacao_atualizada_em).getTime())[0];
      if(latest) setLastUpdate(latest.cotacao_atualizada_em);
    }
    setLoading(false);
  },[]);

  useEffect(()=>{load();},[load]);

  const refreshQuotes=async()=>{
    if(assets.length===0){setMsg({t:"Nenhum ativo cadastrado para atualizar",ok:false});return;}
    setRefreshing(true);setMsg(null);
    try{
      const res=await authFetch("/api/wealth/quotes",{
        method:"POST",
        body:JSON.stringify({update_db:true}),
      });
      const data=await res.json();
      if(data.success){
        setMsg({t:`Cotações atualizadas: ${data.summary.success} de ${data.summary.total} ativos`,ok:true});
        await load();
      }else{
        setMsg({t:data.error||"Erro ao atualizar cotações",ok:false});
      }
    }catch(e:any){
      setMsg({t:e.message||"Erro de conexão",ok:false});
    }
    setRefreshing(false);
  };

  const lookupQuote=async()=>{
    if(!lookupTicker.trim()) return;
    setLookupLoading(true);setLookupResult(null);
    try{
      const res=await authFetch(`/api/wealth/quotes?tickers=${lookupTicker.trim().toUpperCase()}`);
      const data=await res.json();
      if(data.success&&data.data?.length>0) setLookupResult(data.data[0]);
      else setLookupResult({error:"Ticker não encontrado"});
    }catch(e:any){
      setLookupResult({error:e.message});
    }
    setLookupLoading(false);
  };

  const filtered=assets.filter(a=>{
    if(filterClasse!=="todos"&&a.classe!==filterClasse) return false;
    if(search){
      const s=search.toLowerCase();
      return a.ticker.toLowerCase().includes(s)||(a.nome||"").toLowerCase().includes(s);
    }
    return true;
  });

  // Stats
  const withPrice=assets.filter(a=>a.cotacao_atual>0);
  const avgVar=withPrice.length>0?withPrice.reduce((s,a)=>s+(a.variacao_dia||0),0)/withPrice.length:0;
  const gainers=withPrice.filter(a=>(a.variacao_dia||0)>0).length;
  const losers=withPrice.filter(a=>(a.variacao_dia||0)<0).length;

  const inputStyle:React.CSSProperties={width:"100%",padding:"8px 10px",borderRadius:6,border:`1px solid ${BD}`,background:BG3,color:TX,fontSize:12,outline:"none",boxSizing:"border-box"};

  if(loading) return <div style={{display:"flex",justifyContent:"center",alignItems:"center",minHeight:"60vh",color:TXM}}><div style={{fontSize:12}}>Carregando mercado...</div></div>;

  return(
    <div>
      {/* HEADER */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:TX}}>Mercado</div>
          <div style={{fontSize:11,color:TXD,marginTop:2}}>
            {assets.length} ativos monitorados
            {lastUpdate&&` · Última atualização: ${new Date(lastUpdate).toLocaleString("pt-BR")}`}
          </div>
        </div>
        <button onClick={refreshQuotes} disabled={refreshing} style={{
          padding:"10px 20px",borderRadius:8,
          background:refreshing?"#333":`linear-gradient(135deg,${ESP},${GO})`,
          color:OW,fontSize:12,fontWeight:600,border:"none",cursor:refreshing?"not-allowed":"pointer",
          opacity:refreshing?.7:1,
        }}>{refreshing?"⏳ Atualizando...":"🔄 Atualizar Cotações"}</button>
      </div>

      {/* MSG */}
      {msg&&(
        <div style={{marginBottom:12,padding:"8px 14px",borderRadius:8,background:msg.ok?`${G}15`:`${R}15`,border:`1px solid ${msg.ok?G:R}30`,fontSize:12,color:msg.ok?G:R}}>
          {msg.t}
        </div>
      )}

      {/* KPIs */}
      {withPrice.length>0&&(
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <div style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`,flex:1,minWidth:120}}>
            <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Ativos com cotação</div>
            <div style={{fontSize:18,fontWeight:700,color:GOL,marginTop:2}}>{withPrice.length}</div>
          </div>
          <div style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`,flex:1,minWidth:120}}>
            <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Variação média</div>
            <div style={{fontSize:18,fontWeight:700,color:avgVar>=0?G:R,marginTop:2}}>{fmtP(avgVar)}</div>
          </div>
          <div style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`,flex:1,minWidth:120}}>
            <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Em alta</div>
            <div style={{fontSize:18,fontWeight:700,color:G,marginTop:2}}>{gainers}</div>
          </div>
          <div style={{background:BG2,borderRadius:10,padding:"10px 14px",border:`1px solid ${BD}`,flex:1,minWidth:120}}>
            <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:.5}}>Em queda</div>
            <div style={{fontSize:18,fontWeight:700,color:R,marginTop:2}}>{losers}</div>
          </div>
        </div>
      )}

      {/* LOOKUP */}
      <div style={{background:BG2,borderRadius:10,padding:14,border:`1px solid ${BD}`,marginBottom:16}}>
        <div style={{fontSize:12,fontWeight:600,color:GOL,marginBottom:8}}>Consultar cotação</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <input value={lookupTicker} onChange={e=>setLookupTicker(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter"&&lookupQuote()}
            placeholder="Digite um ticker (ex: PETR4, VALE3, HGLG11)"
            style={{...inputStyle,maxWidth:300}}/>
          <button onClick={lookupQuote} disabled={lookupLoading} style={{
            padding:"8px 16px",borderRadius:6,background:`${GO}20`,border:`1px solid ${GO}40`,
            color:GOL,fontSize:11,fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"
          }}>{lookupLoading?"...":"Consultar"}</button>
          {lookupResult&&!lookupResult.error&&(
            <div style={{display:"flex",gap:12,alignItems:"center",fontSize:12}}>
              <span style={{fontWeight:700,color:TX}}>{lookupResult.ticker}</span>
              <span style={{color:GOL,fontWeight:600}}>{fmtR(lookupResult.price)}</span>
              <span style={{color:(lookupResult.changePercent||0)>=0?G:R,fontWeight:600}}>{fmtP(lookupResult.changePercent)}</span>
              {lookupResult.name&&<span style={{color:TXD,fontSize:10}}>{lookupResult.name}</span>}
            </div>
          )}
          {lookupResult?.error&&<span style={{color:R,fontSize:11}}>{lookupResult.error}</span>}
        </div>
      </div>

      {/* FILTERS */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar ticker ou nome..."
          style={{...inputStyle,maxWidth:260,background:BG2}}/>
        <select value={filterClasse} onChange={e=>setFilterClasse(e.target.value)}
          style={{...inputStyle,maxWidth:160,background:BG2,appearance:"none" as any,cursor:"pointer"}}>
          <option value="todos">Todas classes</option>
          {Object.entries(CLASSES).map(([k,v])=><option key={k} value={k}>{v.l}</option>)}
        </select>
        <div style={{flex:1}}/>
        <span style={{fontSize:11,color:TXD}}>{filtered.length} ativo{filtered.length!==1?"s":""}</span>
      </div>

      {/* TABLE */}
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${BD}`}}>
              {["Ticker","Nome","Classe","Cotação","Anterior","Variação","Volume","DY 12m","Atualizado"].map(h=>(
                <th key={h} style={{padding:"8px 10px",textAlign:["Cotação","Anterior","Variação","Volume","DY 12m"].includes(h)?"right":"left",fontSize:9,color:TXD,fontWeight:500,letterSpacing:.5,textTransform:"uppercase"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(a=>{
              const cls=CLASSES[a.classe]||CLASSES.outro;
              const var_dia=a.variacao_dia||0;
              return(
                <tr key={a.id} style={{borderBottom:`0.5px solid ${BD}40`}}>
                  <td style={{padding:"8px 10px",fontSize:13,fontWeight:700,color:TX}}>{a.ticker}</td>
                  <td style={{padding:"8px 10px",fontSize:11,color:TXM,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.nome||"—"}</td>
                  <td style={{padding:"8px 10px"}}><span style={{fontSize:9,padding:"2px 6px",borderRadius:3,background:`${cls.c}15`,color:cls.c}}>{cls.l}</span></td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontSize:13,fontWeight:600,color:a.cotacao_atual?GOL:TXD}}>{fmtR(a.cotacao_atual)}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontSize:11,color:TXM}}>{fmtR(a.cotacao_anterior)}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontSize:12,fontWeight:600,color:var_dia>0?G:var_dia<0?R:TXM}}>{fmtP(a.variacao_dia)}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontSize:10,color:TXM}}>{a.volume_dia?a.volume_dia.toLocaleString("pt-BR"):"—"}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontSize:11,color:a.dy_12m?G:TXD}}>{a.dy_12m?`${a.dy_12m.toFixed(2)}%`:"—"}</td>
                  <td style={{padding:"8px 10px",fontSize:9,color:TXD}}>{a.cotacao_atualizada_em?new Date(a.cotacao_atualizada_em).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—"}</td>
                </tr>
              );
            })}
            {filtered.length===0&&(
              <tr><td colSpan={9} style={{padding:32,textAlign:"center",color:TXD,fontSize:12}}>
                {assets.length===0?"Nenhum ativo cadastrado. Adicione posições na carteira de um cliente.":"Nenhum resultado para os filtros aplicados."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
