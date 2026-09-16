'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

const C={p:'#3D2314',s:'#C8941A',f:'#FAF7F2',bg:'#1A1208',card:'#2A1A0E',g:'#2D8B4E',r:'#C0392B'};
const GO="#C6973F",GOL="#E8C872",BG="#0C0C0A",BG2="#161614",BG3="#1E1E1B",G="#34D399",R="#F87171",Y="#FBBF24",B="#60A5FA",P="#A78BFA",BD="#2A2822",TX="#F0ECE3",TXM="#B0AB9F",TXD="#918C82";
const STAGING_URL="https://erp-psgestao-git-staging-psgestaoecapitals-projects.vercel.app";
const PROD_URL="https://erp-psgestao.vercel.app";

export default function DevPage() {
  // Duas telas irmãs (Leitura · Desenvolvimento) para os quatro usuários. As "Ferramentas do dev"
  // (SQL/deploy/segurança) são utilitário técnico — ficam FORA do seletor, atrás de porta ?dev=ferramentas.
  const [view, setView] = useState<'leitura'|'desenvolvimento'|'ferramentas'>(()=>{
    if (typeof window!=='undefined' && new URLSearchParams(window.location.search).get('dev')==='ferramentas') return 'ferramentas';
    return 'leitura';
  });
  const [tab, setTab] = useState('ambientes');
  const [isAdmin,setIsAdmin]=useState(false);
  const [secResults,setSecResults]=useState<any[]>([]);
  const [secLoading,setSecLoading]=useState(false);

  useEffect(()=>{
    (async()=>{
      const{data:{user}}=await supabase.auth.getUser();
      if(!user)return;
      // SEGURANÇA: Central é da PS — system_role (não role, que qualquer 'adm' de cliente tem), nunca o robô.
      const{data}=await supabase.from("users").select("system_role,is_robo").eq("id",user.id).single();
      if((data?.system_role==="PS_ADMIN"||data?.system_role==="PS_ADMIN_CVM")&&data?.is_robo!==true)setIsAdmin(true);
    })();
  },[]);

  const testarSeguranca=async()=>{
    setSecLoading(true);
    try{
      const{data:users}=await supabase.from("users").select("id,email,full_name,role");
      const{data:uc}=await supabase.from("user_companies").select("user_id,company_id,role,companies(nome_fantasia,razao_social)");
      const results=(users||[]).map((u:any)=>{
        const empresas=(uc||[]).filter((c:any)=>c.user_id===u.id);
        const isAdm=u.role==="adm"||u.role==="adm_investimentos"||u.role==="acesso_total";
        return{
          user:u.full_name||u.email||u.id,
          role:u.role||"sem_role",
          status:isAdm?"ok":empresas.length===0?"alerta":"ok",
          cor:isAdm?G:empresas.length===0?Y:G,
          detail:isAdm?"Acesso total":empresas.length===0?"Sem empresa vinculada":empresas.map((e:any)=>e.companies?.nome_fantasia||e.companies?.razao_social).join(", "),
        };
      });
      setSecResults(results);
    }catch{}
    setSecLoading(false);
  };

  const TABS=[
    {id:'ambientes',label:'🌐 Ambientes',icon:'🌐'},
    {id:'chat',label:'💬 Chat Dev',icon:'💬'},
    {id:'deploy',label:'🚀 Deploy',icon:'🚀'},
    {id:'sql',label:'🗄 SQL',icon:'🗄'},
    {id:'seguranca',label:'🔒 Segurança',icon:'🔒'},
    {id:'changelog',label:'📋 Changelog',icon:'📋'},
    {id:'files',label:'📁 Arquivos',icon:'📁'},
  ];

  return (
    <div style={{ fontFamily:"'Courier New',monospace", background:C.bg, color:C.f, minHeight:'100vh' }}>
      <div style={{ background:C.card, padding:'12px 20px', borderBottom:'2px solid '+C.s, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <span style={{ color:C.s, fontWeight:700, fontSize:16 }}>{'</>'} DEV MODULE</span>
          <span style={{ color:'#666', fontSize:11, marginLeft:12 }}>PS Gestao ERP — v8.7.5</span>
        </div>
        <a href="/dashboard" style={{ color:C.s, fontSize:12, textDecoration:'none' }}>← Dashboard</a>
      </div>

      {/* Seletor das duas telas irmãs (Central de Desenvolvimento) + Ferramentas do dev */}
      <div style={{ display:'flex', gap:8, background:C.card, borderBottom:'1px solid #333', padding:'8px 12px', flexWrap:'wrap' }}>
        {([
          {id:'leitura',label:'📊 Leitura e diagnóstico'},
          {id:'desenvolvimento',label:'📄 Desenvolvimento'},
          // 'Ferramentas do dev' fica fora do seletor (porta ?dev=ferramentas) — utilitário técnico.
          ...(view==='ferramentas' ? [{id:'ferramentas' as const,label:'🛠 Ferramentas do dev'}] : []),
        ] as const).map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)}
            style={{ background:view===v.id?`linear-gradient(135deg,${GO},${GOL})`:'transparent', color:view===v.id?BG:C.f, border:`1px solid ${view===v.id?'transparent':BD}`, padding:'8px 16px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            {v.label}
          </button>
        ))}
      </div>

      {view==='leitura' && <div style={{ padding:16 }}><LeituraDiagnostico/></div>}
      {view==='desenvolvimento' && <div style={{ padding:16 }}><DesenvolvimentoDoc isAdmin={isAdmin}/></div>}

      {view==='ferramentas' && <>
        <div style={{ display:'flex', borderBottom:'1px solid #333', background:C.card, flexWrap:'wrap' }}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{ background:tab===t.id?C.p:'transparent', color:tab===t.id?C.s:C.f, border:'none', padding:'8px 14px', fontSize:11, cursor:'pointer', fontFamily:'inherit', borderBottom:tab===t.id?'2px solid '+C.s:'2px solid transparent' }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ padding:16 }}>
          {tab==='ambientes'&&<Ambientes/>}
          {tab==='chat'&&<ChatDev/>}
          {tab==='deploy'&&<DeployManager/>}
          {tab==='sql'&&<SQLEditor/>}
          {tab==='seguranca'&&<Seguranca secResults={secResults} secLoading={secLoading} testar={testarSeguranca}/>}
          {tab==='changelog'&&<Changelog/>}
          {tab==='files'&&<FileExplorer/>}
        </div>
      </>}
    </div>
  );
}

// ════════════════════════════════════════
// CENTRAL DE DESENVOLVIMENTO — ① Leitura e diagnóstico (as três barras por vertical)
// ════════════════════════════════════════
type BarraRow = {
  area_slug:string; status_comercial:string; telas:number;
  construido_pct:number|null; construido_sem_dado:boolean;
  telas_auditadas:number; auditado_pct:number|null; auditado_sem_dado:boolean;
  tem_tabelas_proprias:boolean; em_uso_empresas:number|null; em_uso_nomes:string[]|null;
  em_uso_ultima_escrita:string|null; em_uso_sem_dado:boolean;
  automacao_rotulo:string|null; automacao_empresas:number|null;
};
const NOME_VERTICAL:Record<string,string>={
  agro:'Agro / Pecuária', bpo:'BPO', compliance:'Compliance', custeio_a:'Custeio A', custeio_b:'Custeio B',
  gestao_empresarial:'Gestão Empresarial', hub:'Hub (Construção)', industrial:'Industrial', medica:'Médica',
  odonto:'Odonto', oficina:'Oficina', pm:'P&M (Agência)', revenda_veiculos:'Revenda de Veículos', wealth:'Wealth',
};
function fmtDia(iso:string|null):string{ if(!iso) return 'nunca'; const p=iso.split('-'); return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:iso; }
function Barra({label,pct,semDado,cor}:{label:string;pct:number|null;semDado:boolean;cor:string}){
  const val = semDado ? null : Math.max(0, Math.min(100, Number(pct ?? 0)));
  return(
    <div style={{marginBottom:8}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:TXM,marginBottom:3}}>
        <span>{label}</span>
        <span style={{color:semDado?TXD:TX,fontWeight:600}}>{semDado?'sem dado':`${val}%`}{label==='Construído'&&!semDado?' (estim.)':''}</span>
      </div>
      <div style={{height:8,borderRadius:6,background:BG3,overflow:'hidden'}}>
        {!semDado && <div style={{height:'100%',width:`${val}%`,background:cor,borderRadius:6}}/>}
      </div>
    </div>
  );
}
function LeituraDiagnostico(){
  const [rows,setRows]=useState<BarraRow[]|null>(null);
  const [erro,setErro]=useState<string|null>(null);
  useEffect(()=>{(async()=>{
    const{data,error}=await supabase.rpc('fn_dev_central_barras');
    if(error){setErro(error.message);return;}
    setRows((data||[]) as BarraRow[]);
  })();},[]);
  if(erro) return <div style={{color:R,fontSize:12}}>Erro ao carregar: {erro}</div>;
  if(!rows) return <div style={{color:TXM,fontSize:12}}>Carregando as três barras…</div>;
  return(
    <div>
      <div style={{fontSize:13,color:GOL,marginBottom:4,fontWeight:600}}>As três barras por vertical</div>
      <div style={{fontSize:11,color:TXM,marginBottom:14}}>
        <b>Construído</b> = estimado por tela · <b>Auditado</b> = telas que o robô exercita (gold buttons) · <b>Em uso</b> = empresas reais que escreveram em tabela da vertical (30d). "sem dado" ≠ 0%.
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
        {rows.map(r=>(
          <div key={r.area_slug} style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:14}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:10}}>
              <span style={{fontSize:13,fontWeight:700,color:TX}}>{NOME_VERTICAL[r.area_slug]||r.area_slug}</span>
              <span style={{fontSize:9,color:TXD,textTransform:'uppercase'}}>{r.status_comercial}{r.telas>0?` · ${r.telas} telas`:''}</span>
            </div>
            <Barra label="Construído" pct={r.construido_pct} semDado={r.construido_sem_dado} cor={G}/>
            <Barra label={`Auditado${r.auditado_sem_dado?'':` (${r.telas_auditadas}/${r.telas})`}`} pct={r.auditado_pct} semDado={r.auditado_sem_dado} cor={B}/>
            {/* Em uso — contagem, não %: chip com nomes. Automação é SEMPRE linha separada, nunca somada. */}
            <div style={{marginTop:6,fontSize:10,color:TXM}}>
              <div style={{marginBottom:3}}>Em uso</div>
              {r.em_uso_sem_dado ? (
                <span style={{color:TXD}}>sem dado · núcleo compartilhado</span>
              ) : (r.em_uso_empresas??0)===0 ? (
                <span style={{color:Y}}>0 empresas · última escrita {fmtDia(r.em_uso_ultima_escrita)}</span>
              ) : (
                <span style={{color:G}}>{r.em_uso_empresas} {r.em_uso_empresas===1?'empresa':'empresas'} · <span style={{color:TX}}>{(r.em_uso_nomes||[]).join(', ')}</span></span>
              )}
              {r.automacao_empresas!=null && (
                <div style={{marginTop:5,paddingTop:5,borderTop:`1px dashed ${BD}`,color:P}}>
                  automação · {r.automacao_rotulo}, {r.automacao_empresas} {r.automacao_empresas===1?'empresa':'empresas'}
                  <span style={{color:TXD}}> (não conta como uso)</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// CENTRAL DE DESENVOLVIMENTO — ② Desenvolvimento (o documento vivo da vertical)
// ════════════════════════════════════════
type Orc={vertical:string;telas:number;custo_estimado:number;tempo_min:number;gasto_dia:number;gasto_mes:number;cap_dia:number;cap_mes:number;pode:boolean;motivo:string|null};
function DesenvolvimentoDoc({isAdmin}:{isAdmin:boolean}){
  const [vertical,setVertical]=useState('oficina');
  const [doc,setDoc]=useState<{titulo:string;versao:number;status:string;conteudo_md:string;criado_em:string}|null>(null);
  const [carregando,setCarregando]=useState(false);
  const [semDoc,setSemDoc]=useState(false);
  const [orc,setOrc]=useState<Orc|null>(null);
  const [disparando,setDisparando]=useState(false);
  const [disparo,setDisparo]=useState<{ok:boolean;msg:string}|null>(null);
  useEffect(()=>{(async()=>{
    setCarregando(true);setSemDoc(false);setDoc(null);setDisparo(null);setOrc(null);
    const{data}=await supabase.from('erp_documento_vertical')
      .select('titulo,versao,status,conteudo_md,criado_em')
      .eq('vertical',vertical).eq('vigente',true).maybeSingle();
    if(data)setDoc(data as any); else setSemDoc(true);
    setCarregando(false);
    const{data:o}=await supabase.rpc('fn_dev_vertical_orcamento',{p_vertical:vertical});
    if(o)setOrc(o as Orc);
  })();},[vertical]);

  async function atualizarVertical(){
    if(!orc?.pode||disparando)return;
    if(!confirm(`Atualizar "${NOME_VERTICAL[vertical]||vertical}"?\n\n${orc.telas} telas · ~US$ ${orc.custo_estimado.toFixed(2)} · ~${orc.tempo_min} min\n\nO robô audita as telas (diagnóstico em minutos). A análise cruzada com o blueprint sai na próxima conversa com a Claude.`))return;
    setDisparando(true);setDisparo(null);
    try{
      const{data:{session}}=await supabase.auth.getSession();
      const res=await fetch('/api/dev/atualizar-vertical',{method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${session?.access_token||''}`},
        body:JSON.stringify({vertical})});
      const d=await res.json();
      if(!res.ok){setDisparo({ok:false,msg:d.error||'Falha ao disparar.'});}
      else{setDisparo({ok:true,msg:`Auditoria disparada em ${d.rotas_disparadas}/${d.rotas_auditaveis} telas. ${d.aviso}`});
        const{data:o}=await supabase.rpc('fn_dev_vertical_orcamento',{p_vertical:vertical}); if(o)setOrc(o as Orc);}
    }catch(e:any){setDisparo({ok:false,msg:e.message||'Erro de rede.'});}
    setDisparando(false);
  }
  return(
    <div>
      <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontSize:13,color:GOL,fontWeight:600}}>📄 Documento vivo da vertical</span>
        <select value={vertical} onChange={e=>setVertical(e.target.value)}
          style={{background:BG3,color:TX,border:`1px solid ${BD}`,borderRadius:8,padding:'6px 10px',fontSize:12,fontFamily:'inherit'}}>
          {Object.entries(NOME_VERTICAL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {carregando && <div style={{color:TXM,fontSize:12}}>Carregando…</div>}
      {!carregando && semDoc && (
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:24,textAlign:'center'}}>
          <div style={{fontSize:24,marginBottom:8}}>📄</div>
          <div style={{fontSize:12,color:TXM}}>Ainda não há documento vivo para esta vertical.</div>
          {!isAdmin && <div style={{fontSize:11,color:TXD,marginTop:6}}>O documento é visível apenas para administradores (CEO).</div>}
        </div>
      )}
      {!carregando && doc && (
        <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:'hidden'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',borderBottom:`1px solid ${BD}`,flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:TX}}>{doc.titulo}</div>
              <div style={{fontSize:10,color:TXD}}>versão {doc.versao} · {doc.conteudo_md.length.toLocaleString('pt-BR')} caracteres</div>
            </div>
            <span style={{fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:6,
              background:(doc.status==='aprovado'?G:Y)+'20',color:doc.status==='aprovado'?G:Y,border:`1px solid ${(doc.status==='aprovado'?G:Y)}40`}}>
              {doc.status==='aprovado'?'✅ aprovado':'📝 rascunho'}
            </span>
          </div>
          <pre style={{margin:0,padding:16,fontSize:12,lineHeight:1.6,color:TX,whiteSpace:'pre-wrap',wordBreak:'break-word',fontFamily:"'Courier New',monospace",maxHeight:640,overflow:'auto'}}>{doc.conteudo_md}</pre>
        </div>
      )}
      {/* ④ botão atualizar a vertical — só o CEO; custo antes do clique; teto diário/mensal; dois tempos */}
      {isAdmin && orc && (
        <div style={{marginTop:14,background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:14}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <div style={{fontSize:11,color:TXM}}>
              {orc.telas>0
                ? <>Atualizar auditoria: <b style={{color:TX}}>{orc.telas} telas · ~US$ {orc.custo_estimado.toFixed(2)} · ~{orc.tempo_min} min</b></>
                : <>Esta vertical não tem telas catalogadas para auditar.</>}
              <div style={{fontSize:9.5,color:TXD,marginTop:2}}>Gasto: US$ {orc.gasto_dia.toFixed(2)}/{orc.cap_dia.toFixed(2)} hoje · US$ {orc.gasto_mes.toFixed(2)}/{orc.cap_mes.toFixed(2)} no mês</div>
            </div>
            <button onClick={atualizarVertical} disabled={!orc.pode||disparando}
              title={orc.pode?'':(orc.motivo||'')}
              style={{padding:'8px 16px',borderRadius:8,border:'none',fontSize:12,fontWeight:600,
                cursor:orc.pode&&!disparando?'pointer':'not-allowed',
                background:orc.pode&&!disparando?`linear-gradient(135deg,${GO},${GOL})`:BG3,
                color:orc.pode&&!disparando?BG:TXD}}>
              {disparando?'Disparando…':'🔄 Atualizar a vertical'}
            </button>
          </div>
          {!orc.pode&&orc.motivo&&<div style={{fontSize:10.5,color:Y,marginTop:8}}>{orc.motivo}</div>}
          {disparo&&<div style={{fontSize:11,color:disparo.ok?G:R,marginTop:8,lineHeight:1.5}}>{disparo.ok?'✅ ':'❌ '}{disparo.msg}</div>}
          <div style={{fontSize:9.5,color:TXD,marginTop:8,borderTop:`1px dashed ${BD}`,paddingTop:8}}>
            ⏱ O <b>diagnóstico</b> do robô sai <b>em minutos</b>. A <b>análise cruzada com o blueprint</b> só sai <b>na próxima conversa com a Claude</b> — não vem sozinha. O roadmap como indicador separado entra depois.
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// AMBIENTES
// ════════════════════════════════════════
function Ambientes(){
  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:20}}>
        <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${Y}30`,borderLeft:`4px solid ${Y}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{width:40,height:40,borderRadius:10,background:Y+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🟡</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:Y}}>STAGING (Homologacao)</div>
              <div style={{fontSize:10,color:TXM}}>Teste aqui ANTES de ir para producao</div>
            </div>
          </div>
          <div style={{background:BG3,borderRadius:8,padding:10,marginBottom:12,fontSize:10,color:TXM,wordBreak:"break-all"}}>{STAGING_URL}</div>
          <a href={STAGING_URL} target="_blank" style={{display:"inline-block",padding:"8px 20px",borderRadius:8,background:Y+"20",border:`1px solid ${Y}40`,color:Y,fontSize:12,fontWeight:600,textDecoration:"none"}}>🔗 Abrir Staging</a>
          <div style={{fontSize:10,color:TXD,marginTop:10}}>
            <div>▸ Todas as mudancas vao aqui primeiro</div>
            <div>▸ Testar funcionalidades novas</div>
            <div>▸ Nao afeta clientes em producao</div>
          </div>
        </div>
        <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${G}30`,borderLeft:`4px solid ${G}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
            <div style={{width:40,height:40,borderRadius:10,background:G+"15",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🟢</div>
            <div>
              <div style={{fontSize:16,fontWeight:700,color:G}}>PRODUCAO</div>
              <div style={{fontSize:10,color:TXM}}>Ambiente do cliente — so codigo aprovado</div>
            </div>
          </div>
          <div style={{background:BG3,borderRadius:8,padding:10,marginBottom:12,fontSize:10,color:TXM,wordBreak:"break-all"}}>{PROD_URL}</div>
          <a href={PROD_URL} target="_blank" style={{display:"inline-block",padding:"8px 20px",borderRadius:8,background:G+"20",border:`1px solid ${G}40`,color:G,fontSize:12,fontWeight:600,textDecoration:"none"}}>🔗 Abrir Producao</a>
          <div style={{fontSize:10,color:TXD,marginTop:10}}>
            <div>▸ Clientes acessam aqui</div>
            <div>▸ So recebe codigo testado em staging</div>
            <div>▸ Rollback: Vercel → deploy anterior → Promote</div>
          </div>
        </div>
      </div>
      <div style={{background:BG2,borderRadius:14,padding:16,border:`1px solid ${BD}`}}>
        <div style={{fontSize:13,fontWeight:600,color:GOL,marginBottom:10}}>Fluxo de Deploy</div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          {[
            {icon:"💻",label:"Desenvolvimento",desc:"Claude faz as mudancas",cor:B},
            {icon:"→",label:"",desc:"",cor:TXD},
            {icon:"🟡",label:"Staging",desc:"Push → branch staging",cor:Y},
            {icon:"→",label:"",desc:"",cor:TXD},
            {icon:"✅",label:"Homologacao",desc:"Admin testa e aprova",cor:GOL},
            {icon:"→",label:"",desc:"",cor:TXD},
            {icon:"🟢",label:"Producao",desc:"Merge → branch main",cor:G},
          ].map((s,i)=>(
            <div key={i} style={{textAlign:"center",minWidth:s.label?80:20}}>
              <div style={{fontSize:s.label?24:16,color:s.cor}}>{s.icon}</div>
              {s.label&&<div style={{fontSize:9,fontWeight:600,color:s.cor,marginTop:2}}>{s.label}</div>}
              {s.desc&&<div style={{fontSize:8,color:TXD}}>{s.desc}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// SEGURANCA
// ════════════════════════════════════════
function Seguranca({secResults,secLoading,testar}:{secResults:any[];secLoading:boolean;testar:()=>void}){
  return(
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:14,fontWeight:600,color:TX}}>Auditoria de Seguranca — Quem ve o que?</div>
        <button onClick={testar} disabled={secLoading} style={{padding:"8px 18px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:BG,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>{secLoading?"Verificando...":"🔍 Verificar Acessos"}</button>
      </div>
      {secResults.length>0&&(
        <div style={{background:BG2,borderRadius:14,border:`1px solid ${BD}`,overflow:"hidden"}}>
          <table style={{width:"100%",fontSize:11}}>
            <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
              <th style={{padding:10,textAlign:"left",color:GO,fontSize:10}}>USUARIO</th>
              <th style={{padding:10,textAlign:"left",color:GO,fontSize:10}}>NIVEL</th>
              <th style={{padding:10,textAlign:"center",color:GO,fontSize:10}}>STATUS</th>
              <th style={{padding:10,textAlign:"left",color:GO,fontSize:10}}>EMPRESAS COM ACESSO</th>
            </tr></thead>
            <tbody>
              {secResults.map((r:any,i:number)=>(
                <tr key={i} style={{borderBottom:`0.5px solid ${BD}30`}}>
                  <td style={{padding:10,color:TX,fontWeight:500}}>{r.user}</td>
                  <td style={{padding:10,color:TXM}}>{r.role}</td>
                  <td style={{padding:10,textAlign:"center"}}><span style={{padding:"2px 8px",borderRadius:4,fontSize:9,fontWeight:600,background:`${r.cor}15`,color:r.cor,border:`1px solid ${r.cor}30`}}>{r.status==="ok"?"✅ Seguro":"⚠️ Atencao"}</span></td>
                  <td style={{padding:10,fontSize:10,color:TXM}}>{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {secResults.length===0&&!secLoading&&(
        <div style={{background:BG2,borderRadius:14,padding:30,border:`1px solid ${BD}`,textAlign:"center"}}>
          <div style={{fontSize:28,marginBottom:8}}>🔒</div>
          <div style={{fontSize:12,color:TXM}}>Clique em Verificar Acessos para auditar permissoes</div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// CHANGELOG
// ════════════════════════════════════════
function Changelog(){
  const versions=[
    {data:"14/04/2026",ver:"v8.7.5",items:["🏆 Role adm_investimentos (acesso irrestrito)","🔧 Fix: layout le role da tabela users","🔧 Dev/Admin/Assessor visiveis no menu","📋 Changelog restaurado"]},
    {data:"13-14/04/2026",ver:"v8.7.4",items:["🔗 Central Conectores funcional (38 conectores)","🔗 Omie sync auto-save","🔗 Nibo sync ativo (ApiToken + URL param)","🔗 ContaAzul OAuth flow","📊 Hub Dados 3 metodos (API/Excel/Manual)","🏢 Mariele Moveis conectada via Nibo (14.900+ registros)","📈 FluxoCaixa aceita datas ISO","📈 Process API aceita anos 2015-2035"]},
    {data:"13/04/2026",ver:"v8.7.3",items:["🛡️ Anti-Fraude score integrado ao BPO","🚀 BPO Rodar Dia (9 modulos)","📊 BPO Executar: anomalias, cobranca, contas pagar, fluxo caixa, DRE, fechamento, obrigacoes, balanco, resumo IA","🔗 Anti-Fraude link no grid BPO"]},
    {data:"13/04/2026",ver:"v8.7.2",items:["🔄 API retroalimentar BPO → omie_imports","📁 BPO agrupador empresas (grupo)","🔘 Botao Aplicar ao Dashboard"]},
    {data:"13/04/2026",ver:"v8.7.1",items:["🛡️ Anti-Fraude 11 camadas + score 0-100","📝 Parecer executivo automatico","📁 Agrupador empresas no Anti-Fraude","🏷️ Version bump v8.7.1"]},
    {data:"12-13/04/2026",ver:"v8.7.0",items:["🎭 Demo mode (blur + text-shadow)","🔗 Registry 38 conectores em 10 categorias","🏭 Industrial Bovinos N5 (8 tabelas + 6 arquivos)","📊 Contador Sprint 1","🔒 Sprint seguranca (13 API routes withAuth)"]},
    {data:"11/04/2026",ver:"v8.5-v8.6",items:["🔒 Seguranca: env vars, deploy endpoint protegido, dataFilters unificado","📊 DRE expandivel + Mapa Custos 13 grupos","🤖 Consultor IA V19 CEO Edition (18 slides)","📊 PS Assessor (5 Pilares + ABC + Dashboard CEO)","📋 Drill-down linhas de negocio (5 sub-abas)"]},
    {data:"08/04/2026",ver:"v8.0",items:["💰 PS Wealth MFO (22 tabelas, dashboard escritorio+cliente)","📊 Modelo licenciamento 3 tiers","📋 INPI: 3 modulos, 10 patentes, 3 marcas"]},
    {data:"07/04/2026",ver:"v7.2",items:["💳 Conciliacao de Cartao (OFX/CSV)","🤖 Agente IA flutuante","🔧 Ficha Tecnica (50 fichas)","📊 Orcamento (real vs orcado)","🤖 BPO Automacao IA","📋 12 niveis de acesso","🔒 RLS Supabase (16 tabelas)"]},
    {data:"06/04/2026",ver:"v7.1",items:["📊 Dashboard 8 abas","📊 DRE com mapa de custos","📊 Indicadores Fundamentalistas","📊 Fluxo de Caixa Diario","📊 Relatorio V19 CEO Edition","🔗 Integracao Omie API"]},
  ];

  return(
    <div style={{background:BG2,borderRadius:14,padding:20,border:`1px solid ${BD}`}}>
      <div style={{fontSize:14,fontWeight:600,color:GOL,marginBottom:12}}>📋 Changelog — Historico de Mudancas</div>
      <div style={{fontSize:11,color:TXM,marginBottom:16}}>Registro das principais entregas. {versions.length} versoes documentadas.</div>
      {versions.map((v,i)=>(
        <div key={i} style={{marginBottom:16,paddingLeft:16,borderLeft:`3px solid ${i===0?G:i<4?GOL:TXD}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontSize:13,fontWeight:700,color:i===0?G:i<4?GOL:TX}}>{v.ver}</span>
            <span style={{fontSize:10,color:TXD}}>{v.data}</span>
            {i===0&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:4,background:G+"20",color:G,fontWeight:600}}>ATUAL</span>}
          </div>
          {v.items.map((item,j)=><div key={j} style={{fontSize:11,color:TXM,padding:"2px 0"}}>{item}</div>)}
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════
// CHAT DEV
// ════════════════════════════════════════
function ChatDev() {
  const [messages, setMessages] = useState<{role:string;content:string}[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  async function send() {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/dev/chat', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: messages.slice(-10) })
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.response || data.error || 'Sem resposta' }]);
    } catch (e: any) { setMessages(prev => [...prev, { role: 'assistant', content: 'Erro: ' + e.message }]); }
    setLoading(false);
    setTimeout(() => chatRef.current?.scrollTo(0, chatRef.current.scrollHeight), 100);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 500, background: BG2, borderRadius: 14, border: `1px solid ${BD}`, overflow: 'hidden' }}>
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {messages.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 14 }}>Chat Dev — Claude integrado ao ERP</div>
            <div style={{ fontSize: 11, color: TXM, marginTop: 6 }}>Pergunte sobre codigo, bugs, deploy, SQL, arquitetura...</div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              {['Gere a rota para...','Qual o status do deploy?','Monte o SQL para...','Corrija o bug em...'].map((s, i) => (
                <button key={i} onClick={() => setInput(s)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, background: BG3, border: `1px solid ${BD}`, color: TXM, cursor: 'pointer' }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 8, padding: '8px 12px', borderRadius: 10, background: m.role === 'user' ? GO + '15' : BG3, borderLeft: `3px solid ${m.role === 'user' ? GO : G}`, fontSize: 12, whiteSpace: 'pre-wrap' }}>
            <div style={{ fontSize: 9, color: TXD, marginBottom: 4 }}>{m.role === 'user' ? '👤 Voce' : '🤖 Claude'}</div>
            {m.content}
          </div>
        ))}
        {loading && <div style={{ padding: 8, fontSize: 12, color: TXM }}>🤖 Pensando...</div>}
      </div>
      <div style={{ display: 'flex', gap: 6, padding: 8, borderTop: `1px solid ${BD}` }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder="Pergunte sobre o ERP..." style={{ flex: 1, background: BG3, border: `1px solid ${BD}`, color: TX, padding: '8px 12px', borderRadius: 8, fontSize: 12, outline: 'none' }} />
        <button onClick={send} disabled={loading} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: `linear-gradient(135deg,${GO},${GOL})`, color: BG, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Enviar</button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════
// DEPLOY MANAGER
// ════════════════════════════════════════
function DeployManager() {
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState<{path:string;content:string;status:string}[]>([]);
  const is:any = { background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none', width: '100%', fontFamily: 'inherit', boxSizing: 'border-box' as const };

  function addToQueue() { if (!path.trim() || !content.trim()) return; setQueue([...queue, { path: path.trim(), content, status: 'pendente' }]); setPath(''); setContent(''); }
  async function deployOne(filePath: string, fileContent: string, index: number) {
    const updated = [...queue]; updated[index].status = 'deployando'; setQueue([...updated]);
    const res = await fetch('/api/dev/deploy', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: filePath, content: fileContent, message: message || 'Deploy via Dev Module' }) });
    const data = await res.json(); updated[index].status = data.success ? 'ok' : 'erro'; setQueue([...updated]); return data;
  }
  async function deployAll() { setLoading(true); for (let i = 0; i < queue.length; i++) { if (queue[i].status === 'pendente') await deployOne(queue[i].path, queue[i].content, i); } setLoading(false); }
  async function deploySingle() {
    if (!path.trim() || !content.trim()) return; setLoading(true);
    const res = await fetch('/api/dev/deploy', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: path.trim(), content, message: message || 'Deploy via Dev Module' }) });
    setResult(await res.json()); setLoading(false);
  }

  return (
    <div style={{ background: BG2, borderRadius: 14, padding: 16, border: `1px solid ${BD}` }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: GOL, marginBottom: 12 }}>🚀 Deploy Manager</div>
      <input style={is} value={path} onChange={e => setPath(e.target.value)} placeholder="Caminho: src/app/dashboard/modulo/page.tsx" />
      <textarea style={{ ...is, height: 200, marginTop: 8, resize: 'vertical' as const }} value={content} onChange={e => setContent(e.target.value)} placeholder="Cole o codigo aqui..." />
      <input style={{ ...is, marginTop: 8 }} value={message} onChange={e => setMessage(e.target.value)} placeholder="Mensagem do commit (opcional)" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={deploySingle} disabled={loading} style={{ padding: '8px 18px', borderRadius: 8, background: `linear-gradient(135deg,${GO},${GOL})`, color: BG, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>{loading ? 'Deployando...' : '🚀 Deploy Direto'}</button>
        <button onClick={addToQueue} style={{ padding: '8px 18px', borderRadius: 8, background: B + '20', border: `1px solid ${B}40`, color: B, fontSize: 12, cursor: 'pointer' }}>+ Adicionar a Fila</button>
        {queue.length > 0 && <button onClick={deployAll} disabled={loading} style={{ padding: '8px 18px', borderRadius: 8, background: G + '20', border: `1px solid ${G}40`, color: G, fontSize: 12, cursor: 'pointer' }}>🚀 Deploy Fila ({queue.length})</button>}
      </div>
      {result && <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: result.success ? G + '15' : R + '15', fontSize: 11, color: result.success ? G : R }}>{result.success ? '✅ ' + result.path + ' — commit ' + result.commit : '❌ ' + result.error}</div>}
      {queue.length > 0 && <div style={{ marginTop: 10 }}>{queue.map((q, i) => <div key={i} style={{ fontSize: 11, color: q.status === 'ok' ? G : q.status === 'erro' ? R : TXM, padding: '2px 0' }}>{q.status === 'ok' ? '✅' : q.status === 'erro' ? '❌' : '⏳'} {q.path}</div>)}</div>}
    </div>
  );
}

// ════════════════════════════════════════
// SQL EDITOR
// ════════════════════════════════════════
function SQLEditor() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const is:any = { background: BG3, border: `1px solid ${BD}`, color: TX, borderRadius: 8, padding: '8px 12px', fontSize: 12, outline: 'none', width: '100%', fontFamily: "'Courier New',monospace", boxSizing: 'border-box' as const };

  async function runQuery() {
    if (!query.trim()) return; setLoading(true); setResult(null);
    try {
      const res = await fetch('/api/dev/sql', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query.trim() }) });
      setResult(await res.json());
    } catch (e: any) { setResult({ error: e.message }); }
    setLoading(false);
  }

  return (
    <div style={{ background: BG2, borderRadius: 14, padding: 16, border: `1px solid ${BD}` }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: GOL, marginBottom: 12 }}>🗄 SQL Editor — Supabase</div>
      <textarea style={{ ...is, height: 120, resize: 'vertical' as const }} value={query} onChange={e => setQuery(e.target.value)} placeholder="SELECT * FROM users LIMIT 10;" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <button onClick={runQuery} disabled={loading} style={{ padding: '8px 18px', borderRadius: 8, background: `linear-gradient(135deg,${GO},${GOL})`, color: BG, fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer' }}>{loading ? 'Executando...' : '▶ Executar'}</button>
        {['SELECT * FROM users LIMIT 5', 'SELECT * FROM companies ORDER BY created_at', 'SELECT import_type, record_count FROM omie_imports', 'SELECT * FROM bpo_execucoes ORDER BY created_at DESC LIMIT 5'].map((q, i) => (
          <button key={i} onClick={() => setQuery(q)} style={{ fontSize: 9, padding: '4px 10px', borderRadius: 6, background: BG3, border: `1px solid ${BD}`, color: TXM, cursor: 'pointer' }}>{q.substring(0, 30)}...</button>
        ))}
      </div>
      {result && (
        <div style={{ marginTop: 12, maxHeight: 400, overflow: 'auto' }}>
          {result.error ? <div style={{ color: R, fontSize: 12 }}>❌ {result.error}</div> : result.data ? (
            <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
              <thead><tr>{Object.keys(result.data[0] || {}).map(k => <th key={k} style={{ padding: 6, textAlign: 'left', color: GO, borderBottom: `1px solid ${BD}`, fontSize: 9 }}>{k}</th>)}</tr></thead>
              <tbody>{result.data.slice(0, 50).map((row: any, i: number) => <tr key={i}>{Object.values(row).map((v: any, j) => <td key={j} style={{ padding: 6, color: TXM, borderBottom: `0.5px solid ${BD}30`, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{typeof v === 'object' ? JSON.stringify(v).substring(0, 50) : String(v ?? '')}</td>)}</tr>)}</tbody>
            </table>
          ) : <div style={{ color: G, fontSize: 12 }}>✅ Query executada ({result.rowCount ?? 0} rows)</div>}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════
// FILE EXPLORER
// ════════════════════════════════════════
function FileExplorer() {
  const [files, setFiles] = useState<any[]>([]);
  const [currentPath, setCurrentPath] = useState('src/app');
  const [loading, setLoading] = useState(false);
  useEffect(() => { loadFiles(currentPath); }, [currentPath]);
  async function loadFiles(path: string) {
    setLoading(true);
    try { const res = await fetch('/api/dev/deploy?path=' + encodeURIComponent(path), { credentials: 'include' }); const data = await res.json(); setFiles(Array.isArray(data) ? data : []); }
    catch { setFiles([]); }
    setLoading(false);
  }
  function navigate(item: any) { if (item.type === 'dir') setCurrentPath(item.path); }
  function goUp() { const parts = currentPath.split('/'); if (parts.length > 1) { parts.pop(); setCurrentPath(parts.join('/')); } }

  return (
    <div style={{ background: BG2, borderRadius: 14, padding: 16, border: `1px solid ${BD}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: GOL }}>📁 {currentPath}</div>
        <button onClick={goUp} style={{ padding: '4px 12px', borderRadius: 6, background: BG3, border: `1px solid ${BD}`, color: TXM, fontSize: 11, cursor: 'pointer' }}>⬆ Subir</button>
      </div>
      {loading ? <div style={{ color: TXM, fontSize: 12 }}>Carregando...</div> : files.length === 0 ? <div style={{ color: TXD, fontSize: 12 }}>Nenhum arquivo. Verifique GITHUB_TOKEN no Vercel.</div> : (
        <div>{files.map((f, i) => (
          <div key={i} onClick={() => navigate(f)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, cursor: f.type === 'dir' ? 'pointer' : 'default', borderBottom: `0.5px solid ${BD}30` }}>
            <span style={{ fontSize: 14 }}>{f.type === 'dir' ? '📂' : '📄'}</span>
            <span style={{ fontSize: 12, color: f.type === 'dir' ? GOL : TX }}>{f.name}</span>
            {f.size && <span style={{ fontSize: 9, color: TXD, marginLeft: 'auto' }}>{(f.size / 1024).toFixed(1)}KB</span>}
          </div>
        ))}</div>
      )}
    </div>
  );
}
