"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};

const TIPO_INFO:Record<string,{icon:string;nome:string;cor:string;desc:string}>={
  clientes:{icon:"👤",nome:"Clientes",cor:C.b,desc:"Cadastro de clientes (nome, CNPJ, endereço, contato)"},
  fornecedores:{icon:"🏭",nome:"Fornecedores",cor:C.or,desc:"Cadastro de fornecedores (nome, CNPJ, banco, PIX)"},
  receber:{icon:"💰",nome:"Contas a Receber",cor:C.g,desc:"Títulos a receber (valor, vencimento, cliente, NF)"},
  pagar:{icon:"💸",nome:"Contas a Pagar",cor:C.r,desc:"Títulos a pagar (valor, vencimento, fornecedor, NF)"},
  produtos:{icon:"📦",nome:"Produtos / Serviços",cor:C.p,desc:"Catálogo (código, nome, preço, estoque, NCM)"},
  misto:{icon:"🔀",nome:"Misto (SIGA)",cor:C.cy,desc:"Receber + Pagar na mesma planilha (formato SIGA)"},
};

function fmtBRL(n:number){return "R$ "+n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});}

export default function ImportarUniversalPage(){
  const[companies,setCompanies]=useState<any[]>([]);
  const[companyId,setCompanyId]=useState("");
  const[step,setStep]=useState<"upload"|"preview"|"done">("upload");
  const[dragging,setDragging]=useState(false);
  const[loading,setLoading]=useState(false);
  const[analysis,setAnalysis]=useState<any>(null);
  const[tipoOverride,setTipoOverride]=useState("");
  const[result,setResult]=useState<any>(null);
  const[error,setError]=useState("");
  const[currentFile,setCurrentFile]=useState<File|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    (async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user)return;
      const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
      let comps:any[]=[];
      if(up?.role==="adm"||up?.role==="acesso_total"){
        const{data}=await supabase.from("companies").select("*").order("nome_fantasia");comps=data||[];
      }else{
        const{data:uc}=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);
        comps=(uc||[]).map((u:any)=>u.companies).filter(Boolean);
      }
      setCompanies(comps);
      if(comps.length>0){
        const saved=typeof window!=="undefined"?localStorage.getItem("ps_empresa_sel"):null;
        const match=saved && !saved.startsWith("group_") && saved!=="consolidado" ? comps.find((c:any)=>c.id===saved) : null;
        setCompanyId(match?match.id:comps[0].id);
      }
    })();
  },[]);

  const analyzeFile=async(file:File)=>{
    setLoading(true);setError("");setAnalysis(null);
    setCurrentFile(file); // <-- PRESERVA o arquivo no state
    const fd=new FormData();fd.append("file",file);fd.append("action","analyze");
    try{
      const res=await fetch("/api/import/universal",{method:"POST",body:fd});
      const json=await res.json();
      if(json.success){setAnalysis(json);setStep("preview");}
      else setError(json.error||"Erro ao analisar arquivo");
    }catch(e:any){setError(e.message);}
    setLoading(false);
  };

  const doImport=async()=>{
    if(!analysis||!companyId)return;
    setLoading(true);setError("");
    const fd=new FormData();
    // Prefere o state (sempre presente), fallback pro input nativo
    const file = currentFile || fileRef.current?.files?.[0];
    if(!file){setError("Arquivo perdido — arraste de novo ou clique na área pra selecionar");setLoading(false);return;}
    fd.append("file",file);
    fd.append("action","import");
    fd.append("company_id",companyId);
    if(analysis.preset)fd.append("preset",analysis.preset);
    if(tipoOverride)fd.append("tipo",tipoOverride);
    try{
      const res=await fetch("/api/import/universal",{method:"POST",body:fd});
      const json=await res.json();
      if(json.success){setResult(json);setStep("done");}
      else setError(json.error||"Erro ao importar");
    }catch(e:any){setError(e.message);}
    setLoading(false);
  };

  const handleDrop=(e:React.DragEvent)=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)analyzeFile(f);};
  const handleFileChange=(e:React.ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(f)analyzeFile(f);};
  const reset=()=>{setStep("upload");setAnalysis(null);setResult(null);setError("");setTipoOverride("");setCurrentFile(null);if(fileRef.current)fileRef.current.value="";};

  const isSIGA=analysis?.preset==="siga";
  const tipo=tipoOverride||analysis?.tipo||"";
  const tipoInf=TIPO_INFO[tipo];

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:C.esp,padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.gol}}>📤 Importar Dados — Upload Universal</div>
          <div style={{fontSize:10,color:C.txm}}>Aceita Excel, CSV de qualquer sistema · Auto-detecta formato SIGA / ContaAzul / Omie · Gera PSGC automático</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <select value={companyId} onChange={e=>setCompanyId(e.target.value)} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,borderRadius:6,padding:"4px 8px",fontSize:10,maxWidth:280}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome_fantasia||c.nome||c.razao_social}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"4px 10px",border:`1px solid ${C.bd}`,borderRadius:6,color:C.txm,fontSize:10,textDecoration:"none"}}>← Dashboard</a>
        </div>
      </div>

      <div style={{padding:20,maxWidth:1100,margin:"0 auto"}}>

      {/* STEP 1: UPLOAD */}
      {step==="upload"&&(<>
        <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={handleDrop}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragging?C.gol:C.bd}`,borderRadius:16,padding:50,textAlign:"center",cursor:"pointer",background:dragging?C.go+"10":C.bg2,transition:"all 0.2s",marginBottom:20}}>
          <div style={{fontSize:48,marginBottom:12}}>{loading?"⏳":"📁"}</div>
          <div style={{fontSize:16,fontWeight:700,color:C.gol,marginBottom:8}}>{loading?"Analisando arquivo...":"Arraste seu arquivo aqui"}</div>
          <div style={{fontSize:12,color:C.txm,marginBottom:12}}>ou clique para selecionar</div>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            {["XLSX","XLS","CSV"].map(f=><span key={f} style={{padding:"4px 12px",borderRadius:6,background:C.bg3,border:`1px solid ${C.bd}`,fontSize:10,color:C.txm}}>.{f.toLowerCase()}</span>)}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} style={{display:"none"}}/>
        </div>

        <div style={{background:C.bg2,borderRadius:12,padding:16,border:`1px solid ${C.bd}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.gol,marginBottom:12}}>📋 O que posso importar?</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8}}>
            {Object.entries(TIPO_INFO).map(([k,v])=>(
              <div key={k} style={{background:C.bg3,borderRadius:8,padding:10,borderLeft:`3px solid ${v.cor}`}}>
                <div style={{fontSize:20,marginBottom:4}}>{v.icon}</div>
                <div style={{fontSize:11,fontWeight:600,color:v.cor}}>{v.nome}</div>
                <div style={{fontSize:8,color:C.txd,marginTop:2}}>{v.desc}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12,padding:10,background:C.bg3,borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:600,color:C.gol,marginBottom:4}}>💡 Auto-detecção de formato</div>
            <div style={{fontSize:9,color:C.txm,lineHeight:1.5}}>
              • <b style={{color:C.cy}}>SIGA</b>: colunas "Receber", "Pagar", "Quitado em" → importa dois tipos de uma vez<br/>
              • <b style={{color:C.go}}>Genérico</b>: detecta pelo conteúdo das colunas (Nedel, Bling, ContaAzul, etc)<br/>
              • Os lançamentos vão pro <b>PSGC automaticamente</b> (DRE consolidada em tempo real)
            </div>
          </div>
        </div>
      </>)}

      {/* STEP 2: PREVIEW */}
      {step==="preview"&&analysis&&(<>
        {/* Info arquivo + preset */}
        <div style={{background:C.bg2,borderRadius:12,padding:14,border:`1px solid ${C.bd}`,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.gol}}>📄 {analysis.fileName}</div>
              <div style={{fontSize:9,color:C.txd}}>{(analysis.fileSize/1024).toFixed(0)} KB · {analysis.totalRows} linhas · {analysis.headers.length} colunas</div>
            </div>
            <button onClick={reset} style={{padding:"4px 10px",borderRadius:6,background:C.bg3,border:`1px solid ${C.bd}`,color:C.txm,fontSize:10,cursor:"pointer"}}>← Trocar arquivo</button>
          </div>

          {/* Preset detectado */}
          {isSIGA && (
            <div style={{background:C.cy+"15",border:`1px solid ${C.cy}60`,borderRadius:8,padding:12,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:C.cy,marginBottom:4}}>🔀 Formato SIGA detectado</div>
              <div style={{fontSize:10,color:C.tx,lineHeight:1.5}}>
                Planilha com colunas "Receber" E "Pagar" simultâneas. Cada linha vai ser classificada automaticamente e gravada em:<br/>
                • <b>erp_receber</b> (linhas com valor em Receber)<br/>
                • <b>erp_pagar</b> (linhas com valor em Pagar)<br/>
                • <b>erp_lancamentos</b> (todos, pra PSGC ver consolidado)<br/>
                Clientes/fornecedores novos serão criados automaticamente.<br/>
                <span style={{color:C.y,fontWeight:600}}>🛡️ Proteção anti-duplicata inteligente:</span> reimportar a mesma planilha <b>NÃO</b> duplica. Se um lançamento mudou de status (ex: ficou "Quitado"), os campos <b>data_pagamento, valor_pago e status</b> são atualizados automaticamente. Duplicatas intencionais (2 comissões iguais) são preservadas.
              </div>
              {analysis.stats && (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:10}}>
                  <div style={{background:C.g+"15",border:`1px solid ${C.g}40`,borderRadius:6,padding:8}}>
                    <div style={{fontSize:8,color:C.txd}}>A RECEBER</div>
                    <div style={{fontSize:16,fontWeight:700,color:C.g}}>{analysis.stats.cReceber} · {fmtBRL(analysis.stats.totReceber)}</div>
                  </div>
                  <div style={{background:C.r+"15",border:`1px solid ${C.r}40`,borderRadius:6,padding:8}}>
                    <div style={{fontSize:8,color:C.txd}}>A PAGAR</div>
                    <div style={{fontSize:16,fontWeight:700,color:C.r}}>{analysis.stats.cPagar} · {fmtBRL(analysis.stats.totPagar)}</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tipo override (só pra formato genérico) */}
          {!isSIGA && (
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10,flexWrap:"wrap"}}>
              <div style={{fontSize:11,color:C.txm}}>Tipo detectado:</div>
              {Object.entries(TIPO_INFO).filter(([k])=>k!=="misto").map(([k,v])=>(
                <button key={k} onClick={()=>setTipoOverride(k)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${(tipoOverride||analysis.tipo)===k?v.cor:C.bd}`,background:(tipoOverride||analysis.tipo)===k?v.cor+"20":"transparent",color:(tipoOverride||analysis.tipo)===k?v.cor:C.txd,fontSize:10,fontWeight:(tipoOverride||analysis.tipo)===k?700:400,cursor:"pointer"}}>
                  {v.icon} {v.nome}
                </button>
              ))}
            </div>
          )}

          {/* Mapeamento */}
          <div style={{fontSize:11,fontWeight:600,color:C.gol,marginBottom:6}}>🔗 Mapeamento de Colunas</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:8}}>
            {Object.entries(analysis.mapping).map(([field,colIdx])=>(
              <div key={field} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",background:C.bg3,borderRadius:4,borderLeft:`2px solid ${C.g}`}}>
                <span style={{fontSize:9,color:C.g,fontWeight:600}}>{field}</span>
                <span style={{fontSize:9,color:C.txm,overflow:"hidden",textOverflow:"ellipsis",maxWidth:120,whiteSpace:"nowrap"}}>← {analysis.headers[colIdx as number]}</span>
              </div>
            ))}
          </div>
          {analysis.unmappedHeaders?.length>0&&(
            <div style={{fontSize:9,color:C.txd}}>Colunas não usadas: {analysis.unmappedHeaders.join(", ")}</div>
          )}
        </div>

        {/* Preview */}
        <div style={{background:C.bg2,borderRadius:12,padding:14,border:`1px solid ${C.bd}`,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:600,color:C.gol,marginBottom:8}}>👁️ Preview (primeiros {analysis.preview?.length} registros)</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
              <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
                {isSIGA ? (
                  ["tipo","data_vencimento","data_pagamento","nome","valor","categoria","centro_custo","status"].map(f=>
                    <th key={f} style={{padding:"5px 4px",textAlign:"left",color:C.gol,fontSize:8}}>{f}</th>
                  )
                ) : (
                  Object.keys(analysis.mapping).map(f=><th key={f} style={{padding:"5px 4px",textAlign:"left",color:C.gol,fontSize:8}}>{f}</th>)
                )}
              </tr></thead>
              <tbody>
                {(analysis.preview||[]).map((row:any,i:number)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}20`}}>
                    {isSIGA ? (
                      ["tipo","data_vencimento","data_pagamento","nome","valor","categoria","centro_custo","status"].map(f=>{
                        let v=row[f];
                        if(f==="valor" && typeof v==="number") v=fmtBRL(v);
                        if(f==="tipo"){
                          const cor=v==="receber"?C.g:C.r;
                          return <td key={f} style={{padding:"4px",maxWidth:80}}><span style={{background:cor+"20",color:cor,padding:"2px 6px",borderRadius:4,fontSize:8,fontWeight:600}}>{v}</span></td>;
                        }
                        return <td key={f} style={{padding:"4px",color:v?C.tx:C.txd,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{v||"—"}</td>;
                      })
                    ) : (
                      Object.keys(analysis.mapping).map(f=>(
                        <td key={f} style={{padding:"4px",color:row[f]?C.tx:C.txd,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row[f]||"—"}</td>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Botão importar */}
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button onClick={doImport} disabled={loading||!companyId} style={{padding:"12px 32px",borderRadius:10,border:"none",background:isSIGA?C.cy:(tipoInf?.cor||C.go),color:C.bg,fontSize:14,fontWeight:700,cursor:loading?"wait":"pointer",opacity:loading?0.5:1}}>
            {loading?"⏳ Importando...":
              isSIGA?`🔀 Importar ${analysis.stats?.cReceber||0} a receber + ${analysis.stats?.cPagar||0} a pagar (SIGA)`:
              `${tipoInf?.icon||"📤"} Importar ${analysis.totalRows} registros como ${tipoInf?.nome||tipo}`}
          </button>
          <button onClick={reset} style={{padding:"12px 20px",borderRadius:10,border:`1px solid ${C.bd}`,background:"transparent",color:C.txm,fontSize:12,cursor:"pointer"}}>Cancelar</button>
        </div>
      </>)}

      {/* STEP 3: DONE */}
      {step==="done"&&result&&(
        <div style={{background:C.bg2,borderRadius:16,padding:30,border:`1px solid ${C.g}40`,textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontSize:20,fontWeight:700,color:C.g,marginBottom:8}}>Importação Concluída!</div>
          <div style={{fontSize:13,color:C.tx,marginBottom:16,maxWidth:700,margin:"0 auto 16px"}}>{result.message}</div>
          
          {result.preset==="siga" ? (
            <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,maxWidth:720,margin:"0 auto 12px"}}>
              <div style={{background:C.bg3,borderRadius:8,padding:10}}>
                <div style={{fontSize:7,color:C.txd}}>TOTAL LINHAS</div>
                <div style={{fontSize:18,fontWeight:700,color:C.gol}}>{result.totalRows}</div>
              </div>
              <div style={{background:C.g+"15",borderRadius:8,padding:10,borderLeft:`2px solid ${C.g}`}}>
                <div style={{fontSize:7,color:C.txd}}>NOVOS A RECEBER</div>
                <div style={{fontSize:18,fontWeight:700,color:C.g}}>{result.impReceber}</div>
              </div>
              <div style={{background:C.r+"15",borderRadius:8,padding:10,borderLeft:`2px solid ${C.r}`}}>
                <div style={{fontSize:7,color:C.txd}}>NOVOS A PAGAR</div>
                <div style={{fontSize:18,fontWeight:700,color:C.r}}>{result.impPagar}</div>
              </div>
              <div style={{background:C.cy+"15",borderRadius:8,padding:10,borderLeft:`2px solid ${C.cy}`}}>
                <div style={{fontSize:7,color:C.txd}}>PSGC (lanç.)</div>
                <div style={{fontSize:18,fontWeight:700,color:C.cy}}>{result.impLanc}</div>
              </div>
              <div style={{background:C.bg3,borderRadius:8,padding:10}}>
                <div style={{fontSize:7,color:C.txd}}>NOVOS CAD.</div>
                <div style={{fontSize:18,fontWeight:700,color:C.b}}>{(result.clientesNovos||0)+(result.fornecNovos||0)}</div>
                <div style={{fontSize:7,color:C.txd}}>{result.clientesNovos}c · {result.fornecNovos}f</div>
              </div>
            </div>
            
            {/* Idempotência + Updates */}
            {((result.jaExistiamRec||0)+(result.jaExistiamPag||0)+(result.dupDentroImport||0)+(result.updReceber||0)+(result.updPagar||0) > 0) && (
              <div style={{background:C.y+"15",border:`1px solid ${C.y}40`,borderRadius:8,padding:12,maxWidth:720,margin:"0 auto 20px"}}>
                <div style={{fontSize:11,fontWeight:700,color:C.y,marginBottom:6}}>🛡️ Proteção anti-duplicata + sincronização</div>
                <div style={{fontSize:10,color:C.tx,lineHeight:1.5,textAlign:"left"}}>
                  {(result.updReceber||0)+(result.updPagar||0) > 0 && (
                    <div>• <b style={{color:C.cy}}>{(result.updReceber||0)+(result.updPagar||0)} lançamento(s) atualizado(s)</b> (status, data de pagamento ou valor pago sincronizados com a origem).</div>
                  )}
                  {result.dupDentroImport > 0 && (
                    <div>• <b>{result.dupDentroImport} duplicata(s)</b> inline (linhas idênticas) foram ignoradas.</div>
                  )}
                  <div style={{color:C.txm,marginTop:4,fontSize:9}}>Você pode reimportar essa planilha à vontade — novos lançamentos entram, existentes são atualizados (status/pagamento), identidade do registro nunca muda.</div>
                </div>
              </div>
            )}
            </>
          ) : (
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,maxWidth:400,margin:"0 auto 20px"}}>
              <div style={{background:C.bg3,borderRadius:8,padding:10}}>
                <div style={{fontSize:7,color:C.txd}}>TOTAL</div>
                <div style={{fontSize:20,fontWeight:700,color:C.gol}}>{result.totalRows}</div>
              </div>
              <div style={{background:C.bg3,borderRadius:8,padding:10}}>
                <div style={{fontSize:7,color:C.txd}}>IMPORTADOS</div>
                <div style={{fontSize:20,fontWeight:700,color:C.g}}>{result.imported}</div>
              </div>
              <div style={{background:C.bg3,borderRadius:8,padding:10}}>
                <div style={{fontSize:7,color:C.txd}}>ERROS</div>
                <div style={{fontSize:20,fontWeight:700,color:result.errors>0?C.r:C.g}}>{result.errors}</div>
              </div>
            </div>
          )}
          
          <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={reset} style={{padding:"10px 24px",borderRadius:8,border:"none",background:C.go,color:C.bg,fontSize:12,fontWeight:700,cursor:"pointer"}}>📤 Importar outro</button>
            <a href="/dashboard/home" style={{padding:"10px 24px",borderRadius:8,border:`1px solid ${C.bd}`,color:C.gol,fontSize:12,fontWeight:600,textDecoration:"none"}}>📊 Ver Dashboard</a>
            <a href="/dashboard/contas" style={{padding:"10px 24px",borderRadius:8,border:`1px solid ${C.bd}`,color:C.gol,fontSize:12,fontWeight:600,textDecoration:"none"}}>📋 Contas</a>
            <a href="/dashboard" style={{padding:"10px 24px",borderRadius:8,border:`1px solid ${C.bd}`,color:C.txm,fontSize:12,textDecoration:"none"}}>← Sair</a>
          </div>
        </div>
      )}

      {error&&<div style={{marginTop:12,padding:12,background:C.r+"15",borderRadius:8,color:C.r,fontSize:11,borderLeft:`3px solid ${C.r}`}}>❌ {error}</div>}

      </div>
    </div>
  );
}
