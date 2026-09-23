'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// Identidade PS (RD visual): Espresso #3D2314 (estrutura/texto) · Off-white #FAF7F2 (fundos) · Dourado #C8941A (destaques).
// (Antes a Central estava invertida — fundo escuro. Corrigido para o padrão claro. Verde/amarelo/vermelho ficam só nas 3 barras (performance), em tons com contraste sobre off-white.)
const C={p:'#3D2314',s:'#C8941A',f:'#3D2314',bg:'#FAF7F2',card:'#FFFFFF',g:'#16A34A',r:'#C0392B'};
const ONGOLD="#3D2314"; // texto sobre o gradiente dourado (Espresso lê bem no dourado)
const GO="#C8941A",GOL="#E0B048",BG="#FAF7F2",BG2="#FFFFFF",BG3="#F0ECE3",G="#16A34A",R="#DC2626",Y="#CA8A04",B="#2563EB",P="#7C3AED",BD="#E7DED3",TX="#3D2314",TXM="#6B5D4F",TXD="#9C8E80";
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
    <div style={{ fontFamily:"system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", background:C.bg, color:C.f, minHeight:'100vh' }}>
      <div style={{ background:C.card, padding:'12px 20px', borderBottom:'2px solid '+C.s, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div>
          <span style={{ color:C.s, fontWeight:700, fontSize:16 }}>Central de Desenvolvimento</span>
          <span style={{ color:TXD, fontSize:11, marginLeft:12 }}>PS Gestão ERP</span>
        </div>
        <a href="/dashboard" style={{ color:C.s, fontSize:12, textDecoration:'none' }}>← Dashboard</a>
      </div>

      {/* Seletor das duas telas irmãs (Central de Desenvolvimento) + Ferramentas do dev */}
      <div style={{ display:'flex', gap:8, background:C.card, borderBottom:`1px solid ${BD}`, padding:'8px 12px', flexWrap:'wrap' }}>
        {([
          {id:'leitura',label:'📊 Leitura e diagnóstico'},
          {id:'desenvolvimento',label:'📄 Desenvolvimento'},
          // 'Ferramentas do dev' fica fora do seletor (porta ?dev=ferramentas) — utilitário técnico.
          ...(view==='ferramentas' ? [{id:'ferramentas' as const,label:'🛠 Ferramentas do dev'}] : []),
        ] as const).map(v=>(
          <button key={v.id} onClick={()=>setView(v.id)}
            style={{ background:view===v.id?`linear-gradient(135deg,${GO},${GOL})`:'transparent', color:view===v.id?ONGOLD:C.f, border:`1px solid ${view===v.id?'transparent':BD}`, padding:'8px 16px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
            {v.label}
          </button>
        ))}
      </div>

      {view==='leitura' && <div style={{ padding:16 }}><LeituraDiagnostico/></div>}
      {view==='desenvolvimento' && <div style={{ padding:16 }}><DesenvolvimentoDoc isAdmin={isAdmin}/></div>}

      {view==='ferramentas' && <>
        <div style={{ display:'flex', borderBottom:`1px solid ${BD}`, background:C.card, flexWrap:'wrap' }}>
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

// Renderizador de markdown LEVE (sem dependência) — o público (CEO, André, Jordana, Rodrigo) não é dev:
// cabeçalho vira título, ** vira negrito, tabela vira tabela, > vira citação. Nada de #, **, | crus na tela.
function mdInline(s:string):any[]{
  const parts:any[]=[]; let key=0,last=0; const re=/(\*\*([^*]+)\*\*|`([^`]+)`)/g; let m:RegExpExecArray|null;
  while((m=re.exec(s))){
    if(m.index>last) parts.push(s.slice(last,m.index));
    if(m[2]!=null) parts.push(<strong key={key++} style={{color:TX,fontWeight:700}}>{m[2]}</strong>);
    else if(m[3]!=null) parts.push(<code key={key++} style={{background:BG3,padding:'1px 5px',borderRadius:4,fontSize:'0.92em'}}>{m[3]}</code>);
    last=m.index+m[0].length;
  }
  if(last<s.length) parts.push(s.slice(last));
  return parts;
}
function MarkdownView({md}:{md:string}){
  const lines=(md||'').replace(/\r\n/g,'\n').split('\n'); const blocks:any[]=[]; let i=0,key=0;
  const isPara=(l:string)=>!/^\s*$/.test(l)&&!/^(#{1,6})\s/.test(l)&&!l.includes('|')&&!/^\s*>\s?/.test(l)&&!/^\s*([-*]|\d+\.)\s+/.test(l)&&!/^\s*([-*_])\1{2,}\s*$/.test(l);
  while(i<lines.length){
    const ln=lines[i];
    if(/^\s*$/.test(ln)){ i++; continue; }
    const h=/^(#{1,6})\s+(.*)$/.exec(ln);
    if(h){ const lvl=h[1].length, size=lvl<=1?19:lvl===2?15.5:13.5;
      blocks.push(<div key={key++} style={{fontSize:size,fontWeight:700,color:lvl<=2?GO:TX,margin:lvl<=1?'18px 0 8px':'13px 0 5px'}}>{mdInline(h[2])}</div>); i++; continue; }
    if(/^\s*([-*_])\1{2,}\s*$/.test(ln)){ blocks.push(<hr key={key++} style={{border:'none',borderTop:`1px solid ${BD}`,margin:'14px 0'}}/>); i++; continue; }
    if(ln.includes('|')){
      const tbl:string[]=[]; while(i<lines.length&&lines[i].includes('|')){ tbl.push(lines[i]); i++; }
      const rows=tbl.map(r=>r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map(c=>c.trim()));
      const isSep=(r:string[])=>r.every(c=>/^:?-{2,}:?$/.test(c.replace(/\s/g,''))||c==='');
      const header=rows[0], body=rows.slice(1).filter(r=>!isSep(r));
      blocks.push(<div key={key++} style={{overflowX:'auto',margin:'10px 0'}}><table style={{borderCollapse:'collapse',width:'100%',fontSize:12}}>
        <thead><tr>{header.map((c,j)=><th key={j} style={{textAlign:'left',padding:'6px 10px',borderBottom:`2px solid ${BD}`,color:GO,fontWeight:700,background:BG3}}>{mdInline(c)}</th>)}</tr></thead>
        <tbody>{body.map((r,ri)=><tr key={ri}>{r.map((c,j)=><td key={j} style={{padding:'6px 10px',borderBottom:`1px solid ${BD}`,color:TX,verticalAlign:'top'}}>{mdInline(c)}</td>)}</tr>)}</tbody>
      </table></div>); continue;
    }
    if(/^\s*>\s?/.test(ln)){
      const q:string[]=[]; while(i<lines.length&&/^\s*>\s?/.test(lines[i])){ q.push(lines[i].replace(/^\s*>\s?/,'')); i++; }
      blocks.push(<div key={key++} style={{borderLeft:`3px solid ${GO}`,padding:'6px 12px',margin:'10px 0',background:BG3,color:TXM,borderRadius:'0 6px 6px 0'}}>{q.map((l,li)=><div key={li}>{mdInline(l)}</div>)}</div>); continue;
    }
    if(/^\s*([-*]|\d+\.)\s+/.test(ln)){
      const items:string[]=[]; const ordered=/^\s*\d+\.\s+/.test(ln);
      while(i<lines.length&&/^\s*([-*]|\d+\.)\s+/.test(lines[i])){ items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/,'')); i++; }
      const Tag:any=ordered?'ol':'ul';
      blocks.push(<Tag key={key++} style={{margin:'6px 0 6px 20px',color:TX,fontSize:13,lineHeight:1.6}}>{items.map((it,ii)=><li key={ii} style={{marginBottom:3}}>{mdInline(it)}</li>)}</Tag>); continue;
    }
    const para:string[]=[]; while(i<lines.length&&isPara(lines[i])){ para.push(lines[i]); i++; }
    blocks.push(<p key={key++} style={{margin:'6px 0',color:TX,fontSize:13,lineHeight:1.65}}>{para.map((l,li)=><span key={li}>{mdInline(l)}{li<para.length-1?<br/>:null}</span>)}</p>);
  }
  return <div style={{padding:16,maxHeight:640,overflow:'auto'}}>{blocks}</div>;
}
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
  const [doc,setDoc]=useState<{titulo:string;versao:number;status:string;conteudo_md:string;criado_em:string;aprovado_por:string|null;aprovado_em:string|null}|null>(null);
  const [aprovadorNome,setAprovadorNome]=useState<string|null>(null);
  const [carregando,setCarregando]=useState(false);
  const [semDoc,setSemDoc]=useState(false);
  const [orc,setOrc]=useState<Orc|null>(null);
  const [disparando,setDisparando]=useState(false);
  const [disparo,setDisparo]=useState<{ok:boolean;msg:string}|null>(null);
  const [aprovando,setAprovando]=useState(false);
  const [versoes,setVersoes]=useState<any[]>([]);   // A3 — histórico (todas as versões desta vertical)
  const [barra,setBarra]=useState<any|null>(null);   // A2 — as 3 barras desta vertical, resumidas
  const [verVersao,setVerVersao]=useState<any|null>(null); // A3 — versão antiga aberta para leitura
  const [audit,setAudit]=useState<any|null>(null);   // ⑧ — número VERDADEIRO da auditoria (X de N · sem botão)
  const [verSemBotao,setVerSemBotao]=useState(false); // ⑧ — expandir a lista das telas sem botão de auditoria
  // Cadastro de verticais na Central de Dev: a lista vem de dev_vertical (não mais fixa no código).
  const [verticais,setVerticais]=useState<{id:string;slug:string;nome:string;ativo:boolean;ordem:number}[]>([]);
  const [gerVert,setGerVert]=useState(false);
  const [novoSlug,setNovoSlug]=useState(''); const [novoNome,setNovoNome]=useState('');
  const [nomeEdits,setNomeEdits]=useState<Record<string,string>>({});
  const [vertBusy,setVertBusy]=useState(false); const [vertMsg,setVertMsg]=useState<string|null>(null);
  async function carregarVerticais(){
    const{data}=await supabase.from('dev_vertical').select('id,slug,nome,ativo,ordem').order('ordem').order('nome');
    const lista=((data||[]) as {id:string;slug:string;nome:string;ativo:boolean;ordem:number}[]);
    setVerticais(lista);
    const ativos=lista.filter(v=>v.ativo);
    if(ativos.length && !ativos.some(v=>v.slug===vertical)) setVertical(ativos[0].slug);
  }
  useEffect(()=>{ void carregarVerticais(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ },[]);
  async function incluirVertical(){
    const slug=novoSlug.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    const nome=novoNome.trim();
    if(!slug||!nome){ setVertMsg('Informe o slug e o nome.'); return; }
    setVertBusy(true); setVertMsg(null);
    const ordem=verticais.reduce((m,v)=>Math.max(m,v.ordem||0),0)+1;
    const{error}=await supabase.from('dev_vertical').insert({slug,nome,ordem});
    if(error) setVertMsg(/duplicate|unique/i.test(error.message)?'Já existe uma vertical com esse slug.':error.message);
    else { setNovoSlug(''); setNovoNome(''); await carregarVerticais(); }
    setVertBusy(false);
  }
  async function salvarNomeVert(id:string){
    const nome=(nomeEdits[id]??'').trim(); if(!nome){ setVertMsg('O nome não pode ficar vazio.'); return; }
    setVertBusy(true); setVertMsg(null);
    const{error}=await supabase.from('dev_vertical').update({nome}).eq('id',id);
    if(error) setVertMsg(error.message); else await carregarVerticais();
    setVertBusy(false);
  }
  async function toggleAtivoVert(id:string,ativo:boolean){
    setVertBusy(true); setVertMsg(null);
    const{error}=await supabase.from('dev_vertical').update({ativo:!ativo}).eq('id',id);
    if(error) setVertMsg(error.message); else await carregarVerticais();
    setVertBusy(false);
  }
  async function carregarDoc(){
    setCarregando(true);setSemDoc(false);setDoc(null);setAprovadorNome(null);
    const{data}=await supabase.from('erp_documento_vertical')
      .select('titulo,versao,status,conteudo_md,criado_em,aprovado_por,aprovado_em')
      .eq('vertical',vertical).eq('vigente',true).maybeSingle();
    if(data){ setDoc(data as any);
      if((data as any).aprovado_por){ const{data:ap}=await supabase.from('users').select('full_name,email').eq('id',(data as any).aprovado_por).maybeSingle(); if(ap)setAprovadorNome((ap as any).full_name||(ap as any).email); }
    } else setSemDoc(true);
    // A3 — o histórico já é guardado por construção (índice único garante 1 vigente; anteriores vigente=false).
    const{data:vs}=await supabase.from('erp_documento_vertical')
      .select('versao,resumo_mudanca,vigente,criado_em,aprovado_por,aprovado_em,conteudo_md')
      .eq('vertical',vertical).order('versao',{ascending:false});
    setVersoes((vs||[]) as any[]);
    setCarregando(false);
  }
  useEffect(()=>{(async()=>{
    setDisparo(null);setOrc(null);setVerVersao(null);
    await carregarDoc();
    const{data:o}=await supabase.rpc('fn_dev_vertical_orcamento',{p_vertical:vertical});
    if(o)setOrc(o as Orc);
    // A2 — as 3 barras desta vertical (mesma RPC da aba Leitura), pra não precisar trocar de aba.
    const{data:barras}=await supabase.rpc('fn_dev_central_barras');
    setBarra(((barras||[]) as any[]).find(b=>b.area_slug===vertical)||null);
    // ⑧ — status VERDADEIRO da auditoria desta vertical (X de N auditadas · telas sem botão)
    const{data:au}=await supabase.rpc('fn_dev_vertical_auditoria_status',{p_vertical:vertical});
    setAudit(au||null); setVerSemBotao(false);
  })();},[vertical]);

  async function aprovarDoc(){
    if(aprovando)return;
    if(!confirm('Aprovar este documento?\n\nAo aprovar, ele passa a ser a REFERÊNCIA da vertical — a Claude e o auditor vão comparar o sistema contra ele.'))return;
    setAprovando(true);
    try{ const{data:d}=await supabase.rpc('fn_dev_documento_aprovar',{p_vertical:vertical}); if((d as any)?.ok)await carregarDoc(); else alert((d as any)?.mensagem||'Falha ao aprovar.'); }
    catch(e:any){ alert(e.message||'Erro ao aprovar.'); }
    setAprovando(false);
  }
  async function revogarDoc(){
    if(aprovando)return;
    if(!confirm('Revogar a aprovação? O documento volta a rascunho e deixa de ser a referência oficial até ser aprovado de novo.'))return;
    setAprovando(true);
    try{ const{data:d}=await supabase.rpc('fn_dev_documento_desaprovar',{p_vertical:vertical}); if((d as any)?.ok)await carregarDoc(); else alert((d as any)?.mensagem||'Falha ao revogar.'); }
    catch(e:any){ alert(e.message||'Erro ao revogar.'); }
    setAprovando(false);
  }

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
      else{setDisparo({ok:true,msg:`Disparei a auditoria de ${d.rotas_disparadas} tela(s) com botão-ouro. Roda em minutos — o número "auditadas" abaixo atualiza quando terminar. Rode de novo para reforçar.`});
        const{data:o}=await supabase.rpc('fn_dev_vertical_orcamento',{p_vertical:vertical}); if(o)setOrc(o as Orc);
        const{data:au}=await supabase.rpc('fn_dev_vertical_auditoria_status',{p_vertical:vertical}); if(au)setAudit(au);}
    }catch(e:any){setDisparo({ok:false,msg:e.message||'Erro de rede.'});}
    setDisparando(false);
  }
  return(
    <div>
      <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
        <span style={{fontSize:13,color:GOL,fontWeight:600}}>📄 Documento vivo da vertical</span>
        <select value={vertical} onChange={e=>setVertical(e.target.value)}
          style={{background:BG3,color:TX,border:`1px solid ${BD}`,borderRadius:8,padding:'6px 10px',fontSize:12,fontFamily:'inherit'}}>
          {(verticais.filter(v=>v.ativo).length
            ? verticais.filter(v=>v.ativo).map(v=>({k:v.slug,n:v.nome}))
            : Object.entries(NOME_VERTICAL).map(([k,n])=>({k,n}))
          ).map(o=><option key={o.k} value={o.k}>{o.n}</option>)}
        </select>
        {isAdmin && <button onClick={()=>setGerVert(v=>!v)} style={{background:'transparent',color:GOL,border:`1px solid ${BD}`,borderRadius:8,padding:'6px 10px',fontSize:11.5,cursor:'pointer'}}>{gerVert?'Fechar':'⚙ Gerenciar verticais'}</button>}
      </div>
      {isAdmin && gerVert && (
        <div style={{background:BG2,border:`1px solid ${BD}`,borderRadius:12,padding:14,marginBottom:14}}>
          <div style={{fontSize:12.5,fontWeight:600,color:TX,marginBottom:2}}>Verticais da Central de Dev</div>
          <div style={{fontSize:11,color:TXM,marginBottom:10}}>A lista vem do banco (dev_vertical). Inativar tira da lista sem apagar — o histórico e o blueprint continuam.</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:12}}>
            <input value={novoSlug} onChange={e=>setNovoSlug(e.target.value)} placeholder="slug (ex.: corretora_seguros)" style={{flex:'1 1 200px',background:BG3,color:TX,border:`1px solid ${BD}`,borderRadius:8,padding:'6px 10px',fontSize:12}} />
            <input value={novoNome} onChange={e=>setNovoNome(e.target.value)} placeholder="Nome" style={{flex:'1 1 200px',background:BG3,color:TX,border:`1px solid ${BD}`,borderRadius:8,padding:'6px 10px',fontSize:12}} />
            <button onClick={()=>void incluirVertical()} disabled={vertBusy} style={{background:`linear-gradient(135deg,${GO},${GOL})`,color:ONGOLD,border:'none',borderRadius:8,padding:'6px 14px',fontSize:12,fontWeight:600,cursor:vertBusy?'not-allowed':'pointer'}}>Incluir</button>
          </div>
          {vertMsg && <div style={{fontSize:11.5,color:Y,marginBottom:8}}>{vertMsg}</div>}
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {verticais.map(v=>(
              <div key={v.id} style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',opacity:v.ativo?1:0.55}}>
                <code style={{fontSize:11,color:TXM,minWidth:150}}>{v.slug}</code>
                <input defaultValue={v.nome} onChange={e=>setNomeEdits(p=>({...p,[v.id]:e.target.value}))} style={{flex:'1 1 200px',background:BG3,color:TX,border:`1px solid ${BD}`,borderRadius:8,padding:'5px 9px',fontSize:12}} />
                <button onClick={()=>void salvarNomeVert(v.id)} disabled={vertBusy||!(v.id in nomeEdits)} style={{background:'transparent',color:GOL,border:`1px solid ${BD}`,borderRadius:8,padding:'5px 10px',fontSize:11.5,cursor:vertBusy?'not-allowed':'pointer'}}>Salvar</button>
                <button onClick={()=>void toggleAtivoVert(v.id,v.ativo)} disabled={vertBusy} style={{background:'transparent',color:v.ativo?Y:GOL,border:`1px solid ${BD}`,borderRadius:8,padding:'5px 10px',fontSize:11.5,cursor:vertBusy?'not-allowed':'pointer'}}>{v.ativo?'Inativar':'Reativar'}</button>
              </div>
            ))}
          </div>
        </div>
      )}
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
          {/* Faixa de rascunho: diz o que é e oferece aprovar (só PS_ADMIN) */}
          {doc.status!=='aprovado' && (
            <div style={{background:Y+'14',borderBottom:`1px solid ${Y}33`,padding:'10px 16px',display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,flexWrap:'wrap'}}>
              <span style={{fontSize:11.5,color:Y}}>📝 Este documento está em <b>rascunho</b> — ainda não é a versão oficial da vertical.</span>
              {isAdmin && (
                <button onClick={aprovarDoc} disabled={aprovando}
                  style={{padding:'7px 14px',borderRadius:8,border:'none',fontSize:12,fontWeight:600,cursor:aprovando?'not-allowed':'pointer',background:`linear-gradient(135deg,${GO},${GOL})`,color:ONGOLD,whiteSpace:'nowrap'}}>
                  {aprovando?'Aprovando…':'Aprovar este documento'}
                </button>
              )}
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 16px',borderBottom:`1px solid ${BD}`,flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontSize:13,fontWeight:700,color:TX}}>{doc.titulo}</div>
              <div style={{fontSize:10,color:TXD}}>versão {doc.versao} · {doc.conteudo_md.length.toLocaleString('pt-BR')} caracteres</div>
            </div>
            {doc.status==='aprovado' ? (
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:10.5,color:G}}>✅ Aprovado{aprovadorNome?` por ${aprovadorNome}`:''}{doc.aprovado_em?` em ${fmtDia(doc.aprovado_em.slice(0,10))}`:''}</div>
                {isAdmin && <button onClick={revogarDoc} disabled={aprovando} style={{marginTop:3,border:'none',background:'none',color:TXD,textDecoration:'underline',fontSize:10,cursor:'pointer'}}>revogar aprovação</button>}
              </div>
            ) : (
              <span style={{fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:6,background:Y+'20',color:Y,border:`1px solid ${Y}40`}}>📝 rascunho</span>
            )}
          </div>
          {/* A2 · estatísticas da vertical + as 3 barras resumidas (pra não precisar voltar na aba Leitura) */}
          <div style={{display:'flex',flexWrap:'wrap',gap:16,padding:'12px 16px',borderBottom:`1px solid ${BD}`,background:BG}}>
            <div style={{flex:'1 1 220px',fontSize:11,color:TXM,lineHeight:1.75}}>
              <div>versão atual: <b style={{color:TX}}>{doc.versao}</b> · <b style={{color:TX}}>{doc.conteudo_md.length.toLocaleString('pt-BR')}</b> caracteres</div>
              <div>mudou em: <b style={{color:TX}}>{fmtDia((doc.criado_em||'').slice(0,10))}</b></div>
              <div>aprovação: {doc.status==='aprovado'?<b style={{color:G}}>{aprovadorNome||'—'} · {fmtDia((doc.aprovado_em||'').slice(0,10))}</b>:<span style={{color:Y}}>rascunho (não aprovado)</span>}</div>
              <div>{versoes.length} versã{versoes.length===1?'o':'es'} no documento vivo</div>
              {(()=>{ const mv=versoes.length?Math.min(...versoes.map((v:any)=>Number(v.versao))):Number(doc.versao); return mv>1?<div style={{marginTop:3,color:TXD,fontStyle:'italic'}}>as versões anteriores à v{mv} viveram em arquivo (.md), antes do documento vivo</div>:null; })()}
            </div>
            {barra && (
              <div style={{flex:'1 1 240px',minWidth:200}}>
                <Barra label="Construído" pct={barra.construido_pct} semDado={barra.construido_sem_dado} cor={G}/>
                <Barra label={`Auditado${barra.auditado_sem_dado?'':` (${barra.telas_auditadas}/${barra.telas})`}`} pct={barra.auditado_pct} semDado={barra.auditado_sem_dado} cor={B}/>
                <div style={{fontSize:10,color:TXM,marginTop:2}}>Em uso: {barra.em_uso_sem_dado?<span style={{color:TXD}}>núcleo compartilhado</span>:(barra.em_uso_empresas??0)===0?<span style={{color:Y}}>0 empresas</span>:<span style={{color:G}}>{barra.em_uso_empresas} empresa(s)</span>}</div>
              </div>
            )}
          </div>
          {verVersao && (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'8px 16px',background:P+'12',borderBottom:`1px solid ${P}33`,fontSize:11.5,color:P}}>
              <span>👁️ Lendo a <b>versão {verVersao.versao}</b> (histórica) — não é a vigente.</span>
              <button onClick={()=>setVerVersao(null)} style={{border:'none',background:'none',color:P,textDecoration:'underline',cursor:'pointer',fontSize:11.5}}>voltar à versão atual</button>
            </div>
          )}
          <MarkdownView md={verVersao?verVersao.conteudo_md:doc.conteudo_md}/>
        </div>
      )}
      {/* A3 · histórico de versões — a estrutura já guarda por construção (índice único: 1 vigente, resto vigente=false) */}
      {!carregando && doc && versoes.length>0 && (
        <div style={{marginTop:14,background:BG2,borderRadius:12,border:`1px solid ${BD}`,padding:14}}>
          <div style={{fontSize:12,fontWeight:700,color:GO,marginBottom:8}}>🕑 Histórico de versões</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {versoes.map((v:any)=>(
              <div key={v.versao} style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,padding:'8px 10px',borderRadius:8,background:v.vigente?G+'10':BG3,border:`1px solid ${v.vigente?G+'44':BD}`}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:12,color:TX,fontWeight:600}}>versão {v.versao}{v.vigente?<span style={{color:G,fontWeight:700}}> · vigente</span>:''}</div>
                  <div style={{fontSize:10.5,color:TXM,marginTop:2}}>{fmtDia((v.criado_em||'').slice(0,10))}{v.aprovado_em?` · aprovada ${fmtDia(v.aprovado_em.slice(0,10))}`:''}</div>
                  <div style={{fontSize:11.5,color:v.resumo_mudanca?TX:TXD,marginTop:3,fontStyle:v.resumo_mudanca?'normal':'italic'}}>{v.resumo_mudanca||'— sem resumo do que mudou (obrigatório a partir da próxima versão)'}</div>
                </div>
                {!v.vigente && <button onClick={()=>setVerVersao(v)} style={{border:`1px solid ${BD}`,background:BG2,color:TX,borderRadius:6,padding:'5px 10px',fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>abrir</button>}
              </div>
            ))}
          </div>
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
                color:orc.pode&&!disparando?ONGOLD:TXD}}>
              {disparando?'Disparando…':'🔄 Atualizar a vertical'}
            </button>
          </div>
          {!orc.pode&&orc.motivo&&<div style={{fontSize:10.5,color:Y,marginTop:8}}>{orc.motivo}</div>}
          {disparo&&<div style={{fontSize:11,color:disparo.ok?G:R,marginTop:8,lineHeight:1.5}}>{disparo.ok?'✅ ':'❌ '}{disparo.msg}</div>}
          {/* ⑧ — número VERDADEIRO: X de N auditadas · telas sem botão (não-auditáveis) · última auditoria */}
          {audit&&audit.total>0&&(
            <div style={{fontSize:11,color:TX,marginTop:8,borderTop:`1px dashed ${BD}`,paddingTop:8,lineHeight:1.6}}>
              <b style={{color:audit.auditadas>=audit.auditaveis?G:GO}}>{audit.auditadas} de {audit.total} auditadas</b>
              {audit.sem_botao>0&&<> · <button type="button" onClick={()=>setVerSemBotao(v=>!v)} style={{background:'none',border:'none',color:Y,cursor:'pointer',fontSize:11,textDecoration:'underline',padding:0,fontFamily:'inherit'}}>{audit.sem_botao} sem botão de auditoria</button></>}
              {audit.ultima_em&&<> · última {new Date(audit.ultima_em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</>}
              {audit.auditaveis>0&&audit.auditadas<audit.auditaveis&&<span style={{color:TXM}}> · rode de novo para as próximas</span>}
              {audit.auditaveis>0&&audit.auditadas>=audit.auditaveis&&audit.sem_botao>0&&<span style={{color:TXM}}> · é o máximo hoje ({audit.auditaveis} de {audit.total} têm botão)</span>}
              {verSemBotao&&audit.sem_botao_lista&&(
                <div style={{marginTop:6,maxHeight:180,overflowY:'auto',background:BG3,borderRadius:8,border:`1px solid ${BD}`,padding:8}}>
                  <div style={{fontSize:10,color:TXM,marginBottom:4}}>Telas sem botão-ouro (o robô ainda não consegue auditá-las):</div>
                  {(audit.sem_botao_lista as any[]).map((t:any)=>(
                    <div key={t.rota} style={{fontSize:10.5,color:TX,padding:'2px 0'}}>· <b>{t.titulo||'(sem título)'}</b> <span style={{color:TXD}}>{t.rota}</span></div>
                  ))}
                </div>
              )}
            </div>
          )}
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
        <button onClick={testar} disabled={secLoading} style={{padding:"8px 18px",borderRadius:8,background:`linear-gradient(135deg,${GO},${GOL})`,color:ONGOLD,fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>{secLoading?"Verificando...":"🔍 Verificar Acessos"}</button>
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
