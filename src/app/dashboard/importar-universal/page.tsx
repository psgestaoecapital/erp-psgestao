"use client";
import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
const C={bg:"#0C0C0A",bg2:"#161614",bg3:"#1E1E1B",esp:"#3D2314",go:"#C8941A",gol:"#E8C872",g:"#22C55E",r:"#EF4444",y:"#FBBF24",b:"#60A5FA",p:"#A78BFA",cy:"#2DD4BF",or:"#F97316",bd:"#2A2822",tx:"#E8E5DC",txm:"#A8A498",txd:"#918C82"};

const TIPO_INFO:Record<string,{icon:string;nome:string;cor:string;desc:string}>={
  clientes:{icon:"ð¤",nome:"Clientes",cor:C.b,desc:"Cadastro de clientes (nome, CNPJ, endereÃ§o, contato)"},
  fornecedores:{icon:"ð­",nome:"Fornecedores",cor:C.or,desc:"Cadastro de fornecedores (nome, CNPJ, banco, PIX)"},
  receber:{icon:"ð°",nome:"Contas a Receber",cor:C.g,desc:"TÃ­tulos a receber (valor, vencimento, cliente, NF)"},
  pagar:{icon:"ð¸",nome:"Contas a Pagar",cor:C.r,desc:"TÃ­tulos a pagar (valor, vencimento, fornecedor, NF)"},
  produtos:{icon:"ð¦",nome:"Produtos / ServiÃ§os",cor:C.p,desc:"CatÃ¡logo (cÃ³digo, nome, preÃ§o, estoque, NCM)"},
};

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
  const fileRef=useRef<HTMLInputElement>(null);

  useEffect(()=>{
    (async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user)return;
      const{data:up}=await supabase.from("users").select("role").eq("id",user.id).single();
      let comps:any[]=[];
      if(up?.role==="adm"||up?.role==="acesso_total"){
        const{data}=await supabase.from("companies").select("*").order("nome");comps=data||[];
      }else{
        const{data:uc}=await supabase.from("user_companies").select("companies(*)").eq("user_id",user.id);
        comps=(uc||[]).map((u:any)=>u.companies).filter(Boolean);
      }
      setCompanies(comps);if(comps.length>0)setCompanyId(comps[0].id);
    })();
  },[]);

  // ANALYZE
  const analyzeFile=async(file:File)=>{
    setLoading(true);setError("");setAnalysis(null);
    const fd=new FormData();fd.append("file",file);fd.append("action","analyze");
    try{
      const res=await fetch("/api/import/universal",{method:"POST",body:fd});
      const json=await res.json();
      if(json.success){setAnalysis(json);setStep("preview");}
      else setError(json.error||"Erro ao analisar arquivo");
    }catch(e:any){setError(e.message);}
    setLoading(false);
  };

  // IMPORT
  const doImport=async()=>{
    if(!analysis||!companyId)return;
    setLoading(true);setError("");
    const fd=new FormData();
    const fileInput=fileRef.current;
    if(!fileInput?.files?.[0]){setError("Selecione o arquivo novamente");setLoading(false);return;}
    fd.append("file",fileInput.files[0]);
    fd.append("action","import");
    fd.append("company_id",companyId);
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
  const reset=()=>{setStep("upload");setAnalysis(null);setResult(null);setError("");setTipoOverride("");};

  const tipo=tipoOverride||analysis?.tipo||"";
  const tipoInf=TIPO_INFO[tipo];

  return(
    <div style={{minHeight:"100vh",background:C.bg,color:C.tx,fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{background:C.esp,padding:"12px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`2px solid ${C.go}`}}>
        <div>
          <div style={{fontSize:18,fontWeight:700,color:C.gol}}>ð¤ Importar Dados â Upload Universal</div>
          <div style={{fontSize:10,color:C.txm}}>Aceita Excel, CSV de qualquer sistema Â· DetecÃ§Ã£o automÃ¡tica de tipo e colunas</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <select value={companyId} onChange={e=>setCompanyId(e.target.value)} style={{background:C.bg3,border:`1px solid ${C.bd}`,color:C.gol,borderRadius:6,padding:"4px 8px",fontSize:10}}>
            {companies.map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          <a href="/dashboard" style={{padding:"4px 10px",border:`1px solid ${C.bd}`,borderRadius:6,color:C.txm,fontSize:10,textDecoration:"none"}}>â Dashboard</a>
        </div>
      </div>

      <div style={{padding:20,maxWidth:1000,margin:"0 auto"}}>

      {/* âââ STEP 1: UPLOAD âââ */}
      {step==="upload"&&(<>
        <div onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={handleDrop}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragging?C.gol:C.bd}`,borderRadius:16,padding:50,textAlign:"center",cursor:"pointer",background:dragging?C.go+"10":C.bg2,transition:"all 0.2s",marginBottom:20}}>
          <div style={{fontSize:48,marginBottom:12}}>{loading?"â³":"ð"}</div>
          <div style={{fontSize:16,fontWeight:700,color:C.gol,marginBottom:8}}>{loading?"Analisando arquivo...":"Arraste seu arquivo aqui"}</div>
          <div style={{fontSize:12,color:C.txm,marginBottom:12}}>ou clique para selecionar</div>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            {["XLSX","XLS","CSV"].map(f=><span key={f} style={{padding:"4px 12px",borderRadius:6,background:C.bg3,border:`1px solid ${C.bd}`,fontSize:10,color:C.txm}}>.{f.toLowerCase()}</span>)}
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv" onChange={handleFileChange} style={{display:"none"}}/>
        </div>

        <div style={{background:C.bg2,borderRadius:12,padding:16,border:`1px solid ${C.bd}`}}>
          <div style={{fontSize:13,fontWeight:700,color:C.gol,marginBottom:12}}>ð O que posso importar?</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8}}>
            {Object.entries(TIPO_INFO).map(([k,v])=>(
              <div key={k} style={{background:C.bg3,borderRadius:8,padding:10,borderLeft:`3px solid ${v.cor}`}}>
                <div style={{fontSize:20,marginBottom:4}}>{v.icon}</div>
                <div style={{fontSize:11,fontWeight:600,color:v.cor}}>{v.nome}</div>
                <div style={{fontSize:8,color:C.txd,marginTop:2}}>{v.desc}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:12,padding:10,background:C.bg3,borderRadius:8}}>
            <div style={{fontSize:10,fontWeight:600,color:C.gol,marginBottom:4}}>ð¡ Dica: O sistema detecta automaticamente!</div>
            <div style={{fontSize:9,color:C.txm}}>Exporte do seu sistema atual (Nedel, Bling, ContaAzul, planilha manual, etc.) em Excel ou CSV. Nosso motor de IA identifica as colunas automaticamente. NÃ£o precisa ajustar nada â Ã© sÃ³ arrastar e importar.</div>
          </div>
        </div>
      </>)}

      {/* âââ STEP 2: PREVIEW âââ */}
      {step==="preview"&&analysis&&(<>
        {/* Info do arquivo */}
        <div style={{background:C.bg2,borderRadius:12,padding:14,border:`1px solid ${C.bd}`,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:C.gol}}>ð {analysis.fileName}</div>
              <div style={{fontSize:9,color:C.txd}}>{(analysis.fileSize/1024).toFixed(0)} KB Â· {analysis.totalRows} linhas detectadas Â· {analysis.headers.length} colunas</div>
            </div>
            <button onClick={reset} style={{padding:"4px 10px",borderRadius:6,background:C.bg3,border:`1px solid ${C.bd}`,color:C.txm,fontSize:10,cursor:"pointer"}}>â Trocar arquivo</button>
          </div>

          {/* Tipo detectado */}
          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:11,color:C.txm}}>Tipo detectado:</div>
            {Object.entries(TIPO_INFO).map(([k,v])=>(
              <button key={k} onClick={()=>setTipoOverride(k)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${(tipoOverride||analysis.tipo)===k?v.cor:C.bd}`,background:(tipoOverride||analysis.tipo)===k?v.cor+"20":"transparent",color:(tipoOverride||analysis.tipo)===k?v.cor:C.txd,fontSize:10,fontWeight:(tipoOverride||analysis.tipo)===k?700:400,cursor:"pointer"}}>
                {v.icon} {v.nome}
              </button>
            ))}
          </div>

          {/* Mapeamento de colunas */}
          <div style={{fontSize:11,fontWeight:600,color:C.gol,marginBottom:6}}>ð Mapeamento de Colunas (automÃ¡tico)</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4,marginBottom:8}}>
            {Object.entries(analysis.mapping).map(([field,colIdx])=>(
              <div key={field} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",background:C.bg3,borderRadius:4,borderLeft:`2px solid ${C.g}`}}>
                <span style={{fontSize:9,color:C.g,fontWeight:600}}>{field}</span>
                <span style={{fontSize:9,color:C.txm}}>â {analysis.headers[colIdx as number]}</span>
              </div>
            ))}
          </div>
          {analysis.unmappedHeaders?.length>0&&(
            <div style={{fontSize:9,color:C.txd}}>Colunas nÃ£o mapeadas: {analysis.unmappedHeaders.join(", ")}</div>
          )}
        </div>

        {/* Preview dos dados */}
        <div style={{background:C.bg2,borderRadius:12,padding:14,border:`1px solid ${C.bd}`,marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:600,color:C.gol,marginBottom:8}}>ðï¸ Preview (primeiros {analysis.preview?.length} registros)</div>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
              <thead><tr style={{borderBottom:`1px solid ${C.bd}`}}>
                {Object.keys(analysis.mapping).map(f=><th key={f} style={{padding:"5px 4px",textAlign:"left",color:C.gol,fontSize:8}}>{f}</th>)}
              </tr></thead>
              <tbody>
                {(analysis.preview||[]).map((row:any,i:number)=>(
                  <tr key={i} style={{borderBottom:`0.5px solid ${C.bd}20`}}>
                    {Object.keys(analysis.mapping).map(f=>(
                      <td key={f} style={{padding:"4px",color:row[f]?C.tx:C.txd,maxWidth:150,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row[f]||"â"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* BotÃ£o importar */}
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button onClick={doImport} disabled={loading} style={{padding:"12px 32px",borderRadius:10,border:"none",background:tipoInf?.cor||C.go,color:C.bg,fontSize:14,fontWeight:700,cursor:loading?"wait":"pointer",opacity:loading?0.5:1}}>
            {loading?"â³ Importando...":`${tipoInf?.icon||"ð¤"} Importar ${analysis.totalRows} registros como ${tipoInf?.nome||tipo}`}
          </button>
          <button onClick={reset} style={{padding:"12px 20px",borderRadius:10,border:`1px solid ${C.bd}`,background:"transparent",color:C.txm,fontSize:12,cursor:"pointer"}}>Cancelar</button>
        </div>
      </>)}

      {/* âââ STEP 3: DONE âââ */}
      {step==="done"&&result&&(
        <div style={{background:C.bg2,borderRadius:16,padding:30,border:`1px solid ${C.g}40`,textAlign:"center"}}>
          <div style={{fontSize:48,marginBottom:12}}>â</div>
          <div style={{fontSize:20,fontWeight:700,color:C.g,marginBottom:8}}>ImportaÃ§Ã£o ConcluÃ­da!</div>
          <div style={{fontSize:14,color:C.tx,marginBottom:16}}>{result.message}</div>
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
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <button onClick={reset} style={{padding:"10px 24px",borderRadius:8,border:"none",background:C.go,color:C.bg,fontSize:12,fontWeight:700,cursor:"pointer"}}>ð¤ Importar outro arquivo</button>
            <a href="/dashboard/operacional" style={{padding:"10px 24px",borderRadius:8,border:`1px solid ${C.bd}`,color:C.gol,fontSize:12,fontWeight:600,textDecoration:"none"}}>ð Ver no Operacional</a>
            <a href="/dashboard" style={{padding:"10px 24px",borderRadius:8,border:`1px solid ${C.bd}`,color:C.txm,fontSize:12,textDecoration:"none"}}>â Dashboard</a>
          </div>
        </div>
      )}

      {error&&<div style={{marginTop:12,padding:12,background:C.r+"15",borderRadius:8,color:C.r,fontSize:11,borderLeft:`3px solid ${C.r}`}}>â {error}</div>}

      </div>
    </div>
  );
}
