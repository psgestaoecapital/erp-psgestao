"use client";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

// ═══ PS GESTÃO DESIGN SYSTEM ═══
const ESP="#3D2314",GO="#C8941A",GOL="#E8C872",OW="#FAF7F2",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",
  BD="#2A2822",TX="#E8E5DC",TXM="#A8A498",TXD="#918C82",GRN="#22C55E",YEL="#FACC15",RED="#EF4444",
  GRNBG="#22C55E12",YLBG="#FACC1512",RDBG="#EF444412";

// ═══ SLIDE ICONS ═══
const SLIDE_ICONS:Record<number,string>={1:"📊",2:"📈",3:"🏢",4:"💰",5:"🏦",6:"💵",7:"📐",8:"🏛️",9:"👥",10:"🏷️",11:"🎯",12:"⚠️",13:"🌱",14:"💎",15:"📋",16:"🚀",17:"🎖️",18:"✉️"};

// ═══ PARSE MARKDOWN TABLE → HTML ═══
function parseTable(text:string):{html:string;isKpi:boolean}{
  const lines=text.trim().split("\n").filter(l=>l.includes("|"));
  if(lines.length<2) return {html:"",isKpi:false};
  const headers=lines[0].split("|").map(h=>h.trim()).filter(Boolean);
  const dataRows=lines.filter((_,i)=>i>0&&!lines[i].match(/^[\s|:-]+$/)).map(l=>l.split("|").map(c=>c.trim()).filter(Boolean));
  const isKpi=headers.length<=4&&dataRows.some(r=>r.some(c=>/🟢|🟡|🔴/.test(c)));
  
  if(isKpi&&dataRows.length<=12){
    // KPI GRID
    return{html:`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:12px 0">${dataRows.map(r=>{
      const status=r.join(" ").includes("🟢")?"border-left:4px solid #22C55E;background:#22C55E08":r.join(" ").includes("🔴")?"border-left:4px solid #EF4444;background:#EF444408":"border-left:4px solid #FACC15;background:#FACC1508";
      return`<div style="padding:12px 14px;border-radius:10px;${status}"><div style="font-size:11px;font-weight:600;color:#E8E5DC;margin-bottom:4px">${r[0]||""}</div><div style="font-size:18px;font-weight:800;color:#E8C872">${r[1]||""}</div>${r[2]?`<div style="font-size:10px;color:#918C82;margin-top:2px">${r.slice(2).join(" | ")}</div>`:""}</div>`;
    }).join("")}</div>`,isKpi:true};
  }
  
  // STYLED TABLE
  return{html:`<div style="overflow-x:auto;margin:14px 0;border-radius:10px;border:1px solid #2A2822"><table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="background:#3D2314">${headers.map(h=>`<th style="padding:10px 12px;text-align:left;font-weight:600;color:#FAF7F2;font-size:10px;letter-spacing:0.5px;text-transform:uppercase;white-space:nowrap">${h}</th>`).join("")}</tr></thead>
    <tbody>${dataRows.map((r,i)=>`<tr style="background:${i%2===0?"#161614":"#1E1E1B"};border-bottom:0.5px solid #2A282240">${r.map((c,j)=>{
      const isNum=/^[\-]?R?\$?\s?[\d.,]+[%KMx]?$/.test(c.replace(/🟢|🟡|🔴/g,"").trim());
      const color=c.includes("🟢")?"#22C55E":c.includes("🔴")?"#EF4444":c.includes("🟡")?"#FACC15":j===0?"#E8E5DC":"#A8A498";
      const weight=j===0||isNum?"600":"400";
      return`<td style="padding:8px 12px;color:${color};font-weight:${weight};white-space:nowrap">${c}</td>`;
    }).join("")}</tr>`).join("")}</tbody></table></div>`,isKpi:false};
}

// ═══ PARSE FULL REPORT ═══
function parseReport(text:string){
  // Split into slides
  const slideRegex=/---?\s*\[SLIDE\s*(\d+)\s*[—–-]\s*([^\]]+)\]\s*---?/gi;
  const slides:{num:number;title:string;content:string}[]=[];
  let match;
  const positions:{index:number;num:number;title:string}[]=[];
  
  while((match=slideRegex.exec(text))!==null){
    positions.push({index:match.index,num:parseInt(match[1]),title:match[2].trim()});
  }
  
  // Pre-slide content (intro)
  const intro=positions.length>0?text.substring(0,positions[0].index).trim():"";
  
  for(let i=0;i<positions.length;i++){
    const start=positions[i].index+text.substring(positions[i].index).indexOf("\n")+1;
    const end=i<positions.length-1?positions[i+1].index:text.length;
    slides.push({num:positions[i].num,title:positions[i].title,content:text.substring(start,end).trim()});
  }
  
  return{intro,slides};
}

// ═══ RENDER SLIDE CONTENT ═══
function renderContent(content:string):string{
  let html=content;
  
  // Extract and render tables separately
  const tableBlocks:string[]=[];
  const tableRegex=/((?:\|[^\n]+\|\n?){3,})/g;
  let tMatch;
  while((tMatch=tableRegex.exec(html))!==null){
    const{html:tableHtml}=parseTable(tMatch[1]);
    tableBlocks.push(tableHtml);
    html=html.replace(tMatch[1],`%%TABLE_${tableBlocks.length-1}%%`);
  }
  
  // Markdown transforms
  html=html
    // VEREDICTO - premium callout
    .replace(/\*?\*?VEREDICTO:?\*?\*?\s*(.+)/gi,'<div style="margin:16px 0;padding:12px 16px;border-radius:10px;background:linear-gradient(135deg,#C8941A10,#3D231408);border:1px solid #C8941A30;border-left:4px solid #C8941A"><span style="font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:#C8941A;font-weight:700">VEREDICTO</span><div style="font-size:12px;color:#E8E5DC;font-weight:600;margin-top:4px;line-height:1.6">$1</div></div>')
    // STATUS / ALERT boxes
    .replace(/\*?\*?(STATUS|SEMÁFORO GERAL|STATUS CRÍTICO|Análise Crítica|Projeção Crítica|Problema Crítico):?\*?\*?\s*(.+)/gi,'<div style="margin:10px 0;padding:10px 14px;border-radius:8px;background:#EF444410;border:1px solid #EF444425"><span style="font-size:9px;letter-spacing:1px;text-transform:uppercase;color:#EF4444;font-weight:700">$1</span><div style="font-size:12px;color:#E8E5DC;margin-top:3px">$2</div></div>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g,'<strong style="color:#F0ECE3;font-weight:700">$1</strong>')
    // Headers inside slides
    .replace(/^#{1,3}\s+(.+)/gm,'<div style="font-size:13px;font-weight:700;color:#E8C872;margin:14px 0 6px;letter-spacing:0.3px">$1</div>')
    // Bullet points
    .replace(/^[\-▸►•]\s+(.+)/gm,'<div style="display:flex;gap:8px;margin:3px 0;align-items:flex-start"><span style="color:#C8941A;font-size:10px;margin-top:2px;flex-shrink:0">◆</span><span style="font-size:12px;color:#A8A498;line-height:1.6">$1</span></div>')
    // Numbered items
    .replace(/^(\d+)\.\s+(.+)/gm,'<div style="display:flex;gap:8px;margin:3px 0;align-items:flex-start"><span style="background:#C8941A20;color:#E8C872;font-size:9px;font-weight:800;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0">$1</span><span style="font-size:12px;color:#A8A498;line-height:1.6">$2</span></div>')
    // Semaphores
    .replace(/🟢/g,'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#22C55E;margin:0 3px;vertical-align:middle"></span>')
    .replace(/🟡/g,'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#FACC15;margin:0 3px;vertical-align:middle"></span>')
    .replace(/🔴/g,'<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#EF4444;margin:0 3px;vertical-align:middle"></span>')
    // Horizontal rules
    .replace(/^---+$/gm,'')
    // Empty lines → spacing
    .replace(/\n\n+/g,'<div style="height:8px"></div>')
    .replace(/\n/g,'<br/>');
  
  // Re-insert tables
  tableBlocks.forEach((tb,i)=>{html=html.replace(`%%TABLE_${i}%%`,tb);});
  
  return html;
}

export default function RelatorioPage(){
  const [report,setReport]=useState<string|null>(null);
  const [empresa,setEmpresa]=useState("");
  const [periodo,setPeriodo]=useState("");
  const [loading,setLoading]=useState(true);
  const printRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    async function load(){
      // Try localStorage first (from dashboard), then Supabase
      const stored=localStorage.getItem("ps_report_v19");
      const meta=localStorage.getItem("ps_report_meta");
      if(stored){
        setReport(stored);
        if(meta){try{const m=JSON.parse(meta);setEmpresa(m.empresa||"");setPeriodo(m.periodo||"");}catch{}}
        setLoading(false);
        return;
      }
      // Fallback: read latest from Supabase
      try{
        const{data}=await supabase.from("ai_reports").select("*").eq("report_type","v19_ceo").order("created_at",{ascending:false}).limit(1);
        if(data&&data.length>0){
          const r=data[0];
          const content=typeof r.report_content==="string"?r.report_content:JSON.stringify(r.report_content);
          setReport(content);
          const m=r.metadata||{};
          setEmpresa(m.empresa||"");
          setPeriodo(m.periodo||"");
        }
      }catch{}
      setLoading(false);
    }
    load();
  },[]);

  if(loading) return <div style={{display:"flex",justifyContent:"center",alignItems:"center",minHeight:"100vh",background:BG,color:TXM,fontFamily:"'Georgia','Times New Roman',serif"}}>Carregando relatório...</div>;
  if(!report) return <div style={{display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",minHeight:"100vh",background:BG,color:TXM,fontFamily:"'Georgia','Times New Roman',serif",gap:16}}><div style={{fontSize:40}}>📊</div><div>Nenhum relatório gerado.</div><a href="/dashboard" style={{color:GOL,textDecoration:"underline",fontSize:14}}>← Voltar ao Dashboard</a></div>;

  const{intro,slides}=parseReport(report);

  return(
    <div style={{background:BG,minHeight:"100vh",fontFamily:"'Georgia','Times New Roman',serif"}}>
      {/* ═══ FLOATING NAV ═══ */}
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:`${BG}E8`,backdropFilter:"blur(12px)",borderBottom:`1px solid ${BD}`,padding:"10px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <a href="/dashboard" style={{color:GOL,fontSize:12,textDecoration:"none"}}>← Dashboard</a>
          <div style={{width:1,height:16,background:BD}}/>
          <span style={{fontSize:11,color:TXD}}>Relatório V19 CEO Edition</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>{navigator.clipboard.writeText(report);}} style={{padding:"6px 14px",borderRadius:6,border:`1px solid ${GO}40`,background:"transparent",color:GOL,fontSize:10,cursor:"pointer",fontWeight:600}}>📋 Copiar</button>
          <button onClick={()=>window.print()} style={{padding:"6px 14px",borderRadius:6,background:`linear-gradient(135deg,${ESP},${GO})`,color:OW,fontSize:10,cursor:"pointer",fontWeight:600,border:"none"}}>🖨️ Imprimir / PDF</button>
        </div>
      </div>

      <div ref={printRef} style={{maxWidth:900,margin:"0 auto",padding:"80px 32px 60px"}}>
        
        {/* ═══ COVER ═══ */}
        <div style={{textAlign:"center",padding:"60px 0 50px",borderBottom:`2px solid ${GO}`,marginBottom:40}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:10,marginBottom:20}}>
            <div style={{width:48,height:48,borderRadius:12,background:`linear-gradient(135deg,${ESP},${GO})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,fontWeight:800,color:OW}}>PS</div>
          </div>
          <div style={{fontSize:11,letterSpacing:4,textTransform:"uppercase",color:GO,fontWeight:600,marginBottom:8}}>PS Gestão e Capital</div>
          <h1 style={{fontSize:32,fontWeight:300,color:TX,margin:"0 0 8px",letterSpacing:1,lineHeight:1.3}}>Relatório de Inteligência<br/><span style={{fontWeight:700,color:GOL}}>Empresarial</span></h1>
          <div style={{fontSize:13,color:TXM,marginTop:16,fontStyle:"italic"}}>{empresa}</div>
          <div style={{fontSize:12,color:TXD,marginTop:4}}>{periodo}</div>
          <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:24}}>
            <div style={{textAlign:"center"}}><div style={{fontSize:28,fontWeight:800,color:GOL}}>{slides.length}</div><div style={{fontSize:9,color:TXD,letterSpacing:1,textTransform:"uppercase"}}>Slides</div></div>
            <div style={{width:1,background:BD}}/>
            <div style={{textAlign:"center"}}><div style={{fontSize:28,fontWeight:800,color:GOL}}>V19</div><div style={{fontSize:9,color:TXD,letterSpacing:1,textTransform:"uppercase"}}>CEO Edition</div></div>
            <div style={{width:1,background:BD}}/>
            <div style={{textAlign:"center"}}><div style={{fontSize:28,fontWeight:800,color:GOL}}>IA</div><div style={{fontSize:9,color:TXD,letterSpacing:1,textTransform:"uppercase"}}>Powered</div></div>
          </div>
        </div>

        {/* ═══ INTRO ═══ */}
        {intro&&<div style={{fontSize:13,color:TXM,lineHeight:1.8,marginBottom:32,padding:"16px 20px",background:BG2,borderRadius:12,border:`1px solid ${BD}`}} dangerouslySetInnerHTML={{__html:renderContent(intro)}}/>}

        {/* ═══ TABLE OF CONTENTS ═══ */}
        <div style={{marginBottom:40,padding:"20px 24px",background:BG2,borderRadius:14,border:`1px solid ${BD}`}}>
          <div style={{fontSize:10,letterSpacing:2,textTransform:"uppercase",color:GO,fontWeight:600,marginBottom:14}}>Índice</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"6px 24px"}}>
            {slides.map(s=>(
              <a key={s.num} href={`#slide-${s.num}`} style={{display:"flex",alignItems:"center",gap:8,textDecoration:"none",padding:"4px 0",borderBottom:`0.5px solid ${BD}40`}}>
                <span style={{fontSize:10,color:GO,fontWeight:800,width:20}}>{String(s.num).padStart(2,"0")}</span>
                <span style={{fontSize:11,color:TXM,flex:1}}>{s.title}</span>
              </a>
            ))}
          </div>
        </div>

        {/* ═══ SLIDES ═══ */}
        {slides.map(s=>(
          <div key={s.num} id={`slide-${s.num}`} style={{marginBottom:32,background:BG2,borderRadius:16,border:`1px solid ${BD}`,overflow:"hidden",breakInside:"avoid"}}>
            {/* Slide Header */}
            <div style={{padding:"16px 24px",background:`linear-gradient(135deg,${ESP}40,${BG3})`,borderBottom:`1px solid ${BD}`,display:"flex",alignItems:"center",gap:14}}>
              <div style={{width:42,height:42,borderRadius:10,background:`linear-gradient(135deg,${ESP},${GO})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{SLIDE_ICONS[s.num]||"📄"}</div>
              <div style={{flex:1}}>
                <div style={{fontSize:9,letterSpacing:2,textTransform:"uppercase",color:GO,fontWeight:600}}>Slide {String(s.num).padStart(2,"0")} de {slides.length}</div>
                <div style={{fontSize:17,fontWeight:700,color:TX,marginTop:2,letterSpacing:0.3}}>{s.title}</div>
              </div>
            </div>
            {/* Slide Content */}
            <div style={{padding:"20px 24px",fontSize:12,color:TX,lineHeight:1.7}} dangerouslySetInnerHTML={{__html:renderContent(s.content)}}/>
          </div>
        ))}

        {/* ═══ FOOTER ═══ */}
        <div style={{textAlign:"center",padding:"40px 0 20px",borderTop:`2px solid ${GO}`,marginTop:20}}>
          <div style={{fontSize:14,fontWeight:700,color:GOL}}>PS Gestão e Capital</div>
          <div style={{fontSize:10,color:TXD,marginTop:4}}>Assessoria Empresarial · BPO Financeiro · Consultoria de Investimentos</div>
          <div style={{fontSize:9,color:TXD,marginTop:8}}>Relatório gerado por inteligência artificial · {new Date().toLocaleDateString("pt-BR")}</div>
        </div>
      </div>

      {/* ═══ PRINT STYLES ═══ */}
      <style>{`
        @media print {
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          div[style*="position:fixed"] { display: none !important; }
          * { color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );
}
