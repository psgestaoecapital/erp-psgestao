"use client";
import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
    G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",
    BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";

const fmtR=(v:number)=>`R$ ${v.toLocaleString("pt-BR",{minimumFractionDigits:2})}`;

type OrcItem = { categoria:string; tipo:string; valor_orcado:number; valor_real:number; };

export default function OrcamentoPage(){
  const [companies,setCompanies]=useState<any[]>([]);
  const [selectedComp,setSelectedComp]=useState("");
  const [periodo,setPeriodo]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;});
  const [items,setItems]=useState<OrcItem[]>([]);
  const [orcDB,setOrcDB]=useState<any[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [msg,setMsg]=useState("");
  const [editValues,setEditValues]=useState<Record<string,string>>({});
  const [filtro,setFiltro]=useState<"todos"|"receita"|"despesa">("todos");
  const [showImport,setShowImport]=useState(false);
  const [ajustePct,setAjustePct]=useState(0);

  useEffect(()=>{loadCompanies();},[]);
  useEffect(()=>{if(selectedComp&&typeof window!=="undefined")localStorage.setItem("ps_empresa_sel",selectedComp);},[selectedComp]);
  useEffect(()=>{if(selectedComp)loadData();},[selectedComp,periodo]);

  const loadCompanies=async()=>{
    const{data}=await supabase.from("companies").select("*").order("nome_fantasia");
    if(data&&data.length>0){setCompanies(data);const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):"";const match=saved?data.find((c:any)=>c.id===saved):null;setSelectedComp(match?match.id:data[0].id);}
    setLoading(false);
  };

  const loadData=async()=>{
    setLoading(true);
    // Load categories from Omie imports (real data)
    const{data:imports}=await supabase.from("omie_imports").select("import_type,import_data").eq("company_id",selectedComp);
    const catMap:Record<string,{tipo:string;valor:number}>={};

    if(imports){
      for(const imp of imports){
        if(imp.import_type==="contas_receber"){
          const regs=imp.import_data?.conta_receber_cadastro||[];
          if(Array.isArray(regs)){
            for(const r of regs){
              const cat=r.codigo_categoria||"sem_cat";
              const desc=r.descricao_categoria||cat;
              const dt=r.data_vencimento||r.data_emissao||"";
              const parts=dt.split("/");
              if(parts.length===3){
                let ano=parseInt(parts[2]);if(parts[2].length===2)ano=2000+ano;
                const mesKey=`${ano}-${String(parseInt(parts[1])).padStart(2,"0")}`;
                if(mesKey===periodo){
                  if(!catMap[desc])catMap[desc]={tipo:"receita",valor:0};
                  catMap[desc].valor+=Number(r.valor_documento)||0;
                }
              }
            }
          }
        }
        if(imp.import_type==="contas_pagar"){
          const regs=imp.import_data?.conta_pagar_cadastro||[];
          if(Array.isArray(regs)){
            for(const r of regs){
              const cat=r.codigo_categoria||"sem_cat";
              const desc=r.descricao_categoria||cat;
              const dt=r.data_vencimento||r.data_emissao||"";
              const parts=dt.split("/");
              if(parts.length===3){
                let ano=parseInt(parts[2]);if(parts[2].length===2)ano=2000+ano;
                const mesKey=`${ano}-${String(parseInt(parts[1])).padStart(2,"0")}`;
                if(mesKey===periodo){
                  if(!catMap[desc])catMap[desc]={tipo:"despesa",valor:0};
                  catMap[desc].valor+=Number(r.valor_documento)||0;
                }
              }
            }
          }
        }
      }
    }

    // Load existing budget
    const{data:orc}=await supabase.from("orcamento").select("*").eq("company_id",selectedComp).eq("periodo",periodo);
    setOrcDB(orc||[]);

    // Merge: all categories from real data + any budget-only categories
    const allCats=new Set([...Object.keys(catMap),...(orc||[]).map((o:any)=>o.categoria)]);
    const merged:OrcItem[]=[];
    for(const cat of allCats){
      const real=catMap[cat];
      const budget=(orc||[]).find((o:any)=>o.categoria===cat);
      merged.push({
        categoria:cat,
        tipo:budget?.tipo||real?.tipo||"despesa",
        valor_orcado:budget?.valor_orcado||0,
        valor_real:real?.valor||0,
      });
    }

    // Sort: receitas first, then despesas, each by value desc
    merged.sort((a,b)=>{
      if(a.tipo!==b.tipo) return a.tipo==="receita"?-1:1;
      return b.valor_real-a.valor_real;
    });

    setItems(merged);
    // Init edit values
    const ev:Record<string,string>={};
    for(const m of merged){
      ev[m.categoria]=m.valor_orcado>0?m.valor_orcado.toString():"";
    }
    setEditValues(ev);
    setLoading(false);
  };

  const salvar=async()=>{
    setSaving(true);
    let count=0;
    for(const item of items){
      const val=parseFloat(editValues[item.categoria]?.replace(/\./g,"").replace(",","."))||0;
      if(val>0||item.valor_orcado>0){
        await supabase.from("orcamento").upsert({
          company_id:selectedComp,periodo,categoria:item.categoria,tipo:item.tipo,valor_orcado:val,
          updated_at:new Date().toISOString()
        },{onConflict:"company_id,periodo,categoria"});
        count++;
      }
    }
    setMsg(`${count} categorias salvas para ${periodo}!`);setSaving(false);loadData();
    setTimeout(()=>setMsg(""),3000);
  };

  const copiarMesAnterior=async()=>{
    const[ano,mes]=periodo.split("-").map(Number);
    const prev=mes===1?`${ano-1}-12`:`${ano}-${String(mes-1).padStart(2,"0")}`;
    const{data:prevOrc}=await supabase.from("orcamento").select("*").eq("company_id",selectedComp).eq("periodo",prev);
    if(!prevOrc||prevOrc.length===0){setMsg(`Sem orçamento em ${prev} para copiar.`);setTimeout(()=>setMsg(""),3000);return;}
    const ev={...editValues};
    for(const p of prevOrc){
      ev[p.categoria]=p.valor_orcado.toString();
    }
    setEditValues(ev);
    setMsg(`${prevOrc.length} categorias copiadas de ${prev}. Clique "Salvar" para confirmar.`);
    setTimeout(()=>setMsg(""),4000);
  };

  const importarRealizado=()=>{
    const fator=1+(ajustePct/100);
    const ev={...editValues};
    for(const item of items){
      if(item.valor_real>0){
        ev[item.categoria]=Math.round(item.valor_real*fator).toString();
      }
    }
    setEditValues(ev);setShowImport(false);
    setMsg(`Orçamento preenchido com realizado ${ajustePct>=0?"+":""}${ajustePct}%. Clique "Salvar".`);
    setTimeout(()=>setMsg(""),4000);
  };

  const totalOrcRec=items.filter(i=>i.tipo==="receita").reduce((s,i)=>s+(parseFloat(editValues[i.categoria])||0),0);
  const totalOrcDesp=items.filter(i=>i.tipo==="despesa").reduce((s,i)=>s+(parseFloat(editValues[i.categoria])||0),0);
  const totalRealRec=items.filter(i=>i.tipo==="receita").reduce((s,i)=>s+i.valor_real,0);
  const totalRealDesp=items.filter(i=>i.tipo==="despesa").reduce((s,i)=>s+i.valor_real,0);

  const filtered=filtro==="todos"?items:items.filter(i=>i.tipo===filtro);

  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"8px 12px",fontSize:12,outline:"none",width:"100%",fontFamily:"inherit"};

  return(
    <div style={{padding:20,maxWidth:1100,margin:"0 auto",background:BG,minHeight:"100vh"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:GOL}}>📋 Orçamento por Categoria</div>
          <div style={{fontSize:11,color:TXM}}>Defina o orçado mensal para cada categoria. O DRE mostrará Real vs. Orçado automaticamente.</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <a href="/dashboard" style={{padding:"8px 16px",border:`1px solid ${BD}`,borderRadius:8,color:TX,fontSize:11,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      {msg&&<div onClick={()=>setMsg("")} style={{background:G+"15",border:`1px solid ${G}30`,borderRadius:10,padding:"10px 16px",marginBottom:12,fontSize:12,color:G,cursor:"pointer"}}>{msg}</div>}

      {/* Controls */}
      <div style={{background:BG2,borderRadius:12,padding:14,border:`1px solid ${BD}`,marginBottom:14,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <div>
          <div style={{fontSize:10,color:TXM,marginBottom:3}}>Empresa</div>
          <select value={selectedComp} onChange={e=>setSelectedComp(e.target.value)} style={{...inp,width:200}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.razao_social}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:10,color:TXM,marginBottom:3}}>Mês</div>
          <input type="month" value={periodo} onChange={e=>setPeriodo(e.target.value)} style={{...inp,width:160}}/>
        </div>
        <div style={{display:"flex",gap:4,alignSelf:"flex-end"}}>
          <button onClick={copiarMesAnterior} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${B}30`,background:B+"10",color:B,fontSize:11,fontWeight:500,cursor:"pointer"}}>📋 Copiar Mês Anterior</button>
          <button onClick={()=>setShowImport(true)} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${P}30`,background:P+"10",color:P,fontSize:11,fontWeight:500,cursor:"pointer"}}>📊 Importar do Realizado</button>
        </div>
      </div>

      {/* Import modal */}
      {showImport&&(
        <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${P}30`,marginBottom:12}}>
          <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:10}}>Importar Realizado como Base do Orçamento</div>
          <div style={{fontSize:11,color:TXM,marginBottom:10}}>Os valores realizados deste mês serão copiados para o orçado com o ajuste % que você definir.</div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <span style={{fontSize:12,color:TX}}>Ajuste:</span>
            {[-10,-5,0,5,10,15,20].map(p=>(
              <button key={p} onClick={()=>setAjustePct(p)} style={{
                padding:"6px 12px",borderRadius:6,fontSize:11,cursor:"pointer",
                border:ajustePct===p?`1px solid ${GO}`:`1px solid ${BD}`,
                background:ajustePct===p?GO+"15":"transparent",
                color:ajustePct===p?GOL:TXM,fontWeight:ajustePct===p?600:400,
              }}>{p>=0?"+":""}{p}%</button>
            ))}
            <button onClick={importarRealizado} style={{padding:"8px 16px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer",marginLeft:8}}>Aplicar</button>
            <button onClick={()=>setShowImport(false)} style={{padding:"8px 12px",borderRadius:8,border:`1px solid ${BD}`,background:"transparent",color:TXM,fontSize:11,cursor:"pointer"}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(160px, 1fr))",gap:8,marginBottom:14}}>
        {[
          {label:"Receita Real",value:fmtR(totalRealRec),cor:G},
          {label:"Receita Orçada",value:fmtR(totalOrcRec),cor:B},
          {label:"Despesa Real",value:fmtR(totalRealDesp),cor:R},
          {label:"Despesa Orçada",value:fmtR(totalOrcDesp),cor:Y},
          {label:"Resultado Orçado",value:fmtR(totalOrcRec-totalOrcDesp),cor:totalOrcRec-totalOrcDesp>0?G:R},
        ].map((k,i)=>(
          <div key={i} style={{background:BG2,borderRadius:12,padding:"12px 14px",border:`1px solid ${BD}`,textAlign:"center"}}>
            <div style={{fontSize:9,color:TXM,textTransform:"uppercase",letterSpacing:1,marginBottom:4}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.cor}}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",gap:4}}>
          {([["todos","Todas"],["receita","Receitas"],["despesa","Despesas"]] as const).map(([k,l])=>(
            <button key={k} onClick={()=>setFiltro(k)} style={{
              padding:"6px 14px",borderRadius:8,fontSize:11,cursor:"pointer",
              border:filtro===k?`1px solid ${GO}50`:`1px solid ${BD}`,
              background:filtro===k?GO+"10":"transparent",color:filtro===k?GOL:TXM,fontWeight:filtro===k?600:400,
            }}>{l} ({items.filter(i=>k==="todos"||i.tipo===k).length})</button>
          ))}
        </div>
        <button onClick={salvar} disabled={saving} style={{
          padding:"10px 24px",borderRadius:10,border:"none",
          background:saving?BD:`linear-gradient(135deg,${GO},${GOL})`,
          color:saving?TXM:BG,fontSize:13,fontWeight:700,cursor:saving?"wait":"pointer",
          boxShadow:`0 4px 12px rgba(198,151,63,0.3)`,
        }}>{saving?"Salvando...":"💾 Salvar Orçamento"}</button>
      </div>

      {/* Table */}
      <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"hidden"}}>
        {loading?(
          <div style={{padding:24,textAlign:"center",color:TXM}}>Carregando categorias...</div>
        ):(
          <div style={{overflowX:"auto",maxHeight:600,overflowY:"auto"}}>
            <table style={{width:"100%",fontSize:11,minWidth:700}}>
              <thead style={{position:"sticky",top:0,background:BG2,zIndex:1}}>
                <tr style={{borderBottom:`1px solid ${BD}`}}>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>CATEGORIA</th>
                  <th style={{padding:"10px 8px",textAlign:"left",color:GO,fontSize:10,fontWeight:600}}>TIPO</th>
                  <th style={{padding:"10px 8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>REALIZADO</th>
                  <th style={{padding:"10px 8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600,minWidth:140}}>ORÇADO</th>
                  <th style={{padding:"10px 8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>DESVIO R$</th>
                  <th style={{padding:"10px 8px",textAlign:"right",color:GO,fontSize:10,fontWeight:600}}>DESVIO %</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item,i)=>{
                  const orcVal=parseFloat(editValues[item.categoria])||0;
                  const desvio=item.valor_real-orcVal;
                  const desvioPct=orcVal>0?(desvio/orcVal*100):0;
                  // For revenue: positive deviation = good. For expense: positive deviation = bad
                  const desvioColor=item.tipo==="receita"?(desvio>=0?G:R):(desvio<=0?G:R);
                  const isNewSection=i>0&&items[i-1]?.tipo!==item.tipo;

                  return(
                    <React.Fragment key={item.categoria}>
                      {isNewSection&&(
                        <tr><td colSpan={6} style={{padding:"8px",background:"#0C0C0A"}}>
                          <div style={{fontSize:11,fontWeight:700,color:item.tipo==="receita"?G:R,textTransform:"uppercase",letterSpacing:1}}>{item.tipo==="receita"?"📥 Receitas":"📤 Despesas"}</div>
                        </td></tr>
                      )}
                      {i===0&&item.tipo==="receita"&&(
                        <tr><td colSpan={6} style={{padding:"8px",background:"#0C0C0A"}}>
                          <div style={{fontSize:11,fontWeight:700,color:G,textTransform:"uppercase",letterSpacing:1}}>📥 Receitas</div>
                        </td></tr>
                      )}
                      <tr style={{borderBottom:`0.5px solid ${BD}30`,background:i%2===0?"rgba(255,255,255,0.01)":"transparent"}}>
                        <td style={{padding:"8px",color:TX,fontWeight:500,fontSize:12,maxWidth:250,overflow:"hidden",textOverflow:"ellipsis"}}>{item.categoria.replace(/&lt;/g,"<").replace(/&gt;/g,">")}</td>
                        <td style={{padding:"8px"}}>
                          <span style={{fontSize:9,padding:"2px 8px",borderRadius:6,
                            background:item.tipo==="receita"?G+"12":R+"12",
                            color:item.tipo==="receita"?G:R,fontWeight:500,
                          }}>{item.tipo==="receita"?"Receita":"Despesa"}</span>
                        </td>
                        <td style={{padding:"8px",textAlign:"right",color:item.valor_real>0?TX:TXD,fontWeight:item.valor_real>0?500:400}}>{item.valor_real>0?fmtR(item.valor_real):"—"}</td>
                        <td style={{padding:"8px",textAlign:"right"}}>
                          <input value={editValues[item.categoria]||""} onChange={e=>{
                            setEditValues({...editValues,[item.categoria]:e.target.value});
                          }} placeholder="0" type="number" style={{
                            background:BG3,border:`1px solid ${BD}`,color:GOL,borderRadius:6,
                            padding:"5px 8px",fontSize:12,outline:"none",width:120,textAlign:"right",fontWeight:600,fontFamily:"inherit",
                          }}/>
                        </td>
                        <td style={{padding:"8px",textAlign:"right",fontWeight:600,color:orcVal>0?desvioColor:TXD}}>
                          {orcVal>0?fmtR(desvio):"—"}
                        </td>
                        <td style={{padding:"8px",textAlign:"right"}}>
                          {orcVal>0?(
                            <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,fontWeight:600,
                              background:`${desvioColor}12`,color:desvioColor,border:`1px solid ${desvioColor}25`,
                            }}>{desvioPct>=0?"+":""}{desvioPct.toFixed(1)}%</span>
                          ):"—"}
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}
                {/* Totals */}
                <tr style={{borderTop:`2px solid ${BD}`,background:BG3}}>
                  <td style={{padding:"10px 8px",fontWeight:700,color:GOL}}>TOTAL RECEITAS</td>
                  <td/>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:G}}>{fmtR(totalRealRec)}</td>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:B}}>{fmtR(totalOrcRec)}</td>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:totalRealRec>=totalOrcRec?G:R}}>{fmtR(totalRealRec-totalOrcRec)}</td>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:totalRealRec>=totalOrcRec?G:R}}>{totalOrcRec>0?`${((totalRealRec-totalOrcRec)/totalOrcRec*100).toFixed(1)}%`:"—"}</td>
                </tr>
                <tr style={{background:BG3}}>
                  <td style={{padding:"10px 8px",fontWeight:700,color:GOL}}>TOTAL DESPESAS</td>
                  <td/>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:R}}>{fmtR(totalRealDesp)}</td>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:Y}}>{fmtR(totalOrcDesp)}</td>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:totalRealDesp<=totalOrcDesp?G:R}}>{fmtR(totalRealDesp-totalOrcDesp)}</td>
                  <td style={{padding:"10px 8px",textAlign:"right",fontWeight:700,color:totalRealDesp<=totalOrcDesp?G:R}}>{totalOrcDesp>0?`${((totalRealDesp-totalOrcDesp)/totalOrcDesp*100).toFixed(1)}%`:"—"}</td>
                </tr>
                <tr style={{background:"#1a1510"}}>
                  <td style={{padding:"12px 8px",fontWeight:700,fontSize:13,color:GOL}}>RESULTADO</td>
                  <td/>
                  <td style={{padding:"12px 8px",textAlign:"right",fontWeight:700,fontSize:13,color:totalRealRec-totalRealDesp>0?G:R}}>{fmtR(totalRealRec-totalRealDesp)}</td>
                  <td style={{padding:"12px 8px",textAlign:"right",fontWeight:700,fontSize:13,color:totalOrcRec-totalOrcDesp>0?G:R}}>{fmtR(totalOrcRec-totalOrcDesp)}</td>
                  <td colSpan={2}/>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {items.length===0&&!loading&&(
        <div style={{background:BG2,borderRadius:12,padding:24,border:`1px solid ${BD}`,textAlign:"center",marginTop:12}}>
          <div style={{fontSize:14,color:TX}}>Nenhuma categoria encontrada para este mês.</div>
          <div style={{fontSize:11,color:TXM,marginTop:4}}>Importe dados do Omie/ContaAzul primeiro, ou selecione um mês com dados.</div>
        </div>
      )}
    </div>
  );
}
