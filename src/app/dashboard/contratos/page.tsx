"use client";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useCompanyIds } from "@/lib/useCompanyIds";

const BG="var(--ps-bg,#FAF7F2)",BG2="var(--ps-bg2,#FFFFFF)",BG3="var(--ps-bg3,#F0ECE3)";
const TX="var(--ps-text,#3D2314)",TXM="var(--ps-text-m,#6B5D4F)",TXD="var(--ps-text-d,#9C8E80)";
const BD="var(--ps-border,#E0D8CC)",GO="var(--ps-gold,#C8941A)";
const G="#22C55E",R="#EF4444",B="#3B82F6",Y="#F59E0B",P="#8B5CF6",T="#14B8A6";

type Contrato={
  id:string;company_id:string;numero:string;
  cliente_id:string;cliente_nome:string;cliente_cnpj:string;cliente_email:string;
  tipo:string;nome:string;descricao:string;escopo:string;
  valor_mensal:number;valor_atual:number;
  data_inicio:string;data_fim:string;data_primeiro_vencimento:string;dia_vencimento:number;
  periodicidade:string;
  tipo_reajuste:string;reajuste_percentual:number;mes_reajuste:number;
  ultimo_reajuste_em:string;proximo_reajuste_em:string;
  forma_pagamento:string;status:string;
  data_encerramento:string;motivo_encerramento:string;
  responsavel:string;observacoes:string;
  ultimo_titulo_gerado_em:string;total_titulos_gerados:number;total_faturado:number;
  created_at:string;
};

const TIPOS_CONTRATO=[
  {v:'bpo_financeiro',l:'BPO Financeiro',icon:'💰'},
  {v:'consultoria',l:'Consultoria',icon:'📊'},
  {v:'assessoria_cvm',l:'Assessoria CVM',icon:'📈'},
  {v:'saas_erp',l:'SaaS / ERP',icon:'💻'},
  {v:'manutencao',l:'Manutenção',icon:'🔧'},
  {v:'academia',l:'Academia/Fitness',icon:'💪'},
  {v:'escola',l:'Escola/Curso',icon:'🎓'},
  {v:'clinica',l:'Clínica/Saúde',icon:'🏥'},
  {v:'limpeza',l:'Limpeza',icon:'🧹'},
  {v:'seguranca',l:'Segurança',icon:'🛡️'},
  {v:'ti',l:'TI/Infraestrutura',icon:'🖥️'},
  {v:'juridico',l:'Jurídico',icon:'⚖️'},
  {v:'contabilidade',l:'Contabilidade',icon:'📋'},
  {v:'outros',l:'Outros',icon:'📝'},
];

const STATUS_CFG:Record<string,{cor:string;icon:string;label:string}>={
  ativo:      {cor:G, icon:"✅", label:"Ativo"},
  suspenso:   {cor:Y, icon:"⏸️", label:"Suspenso"},
  encerrado:  {cor:TXD,icon:"🏁",label:"Encerrado"},
  cancelado:  {cor:R, icon:"❌", label:"Cancelado"},
};

const fmtR=(v:any)=>`R$ ${(Number(v)||0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`;
const fmtRk=(v:any)=>{const n=Number(v)||0;if(Math.abs(n)>=1000)return`R$ ${(n/1000).toFixed(1)}k`;return`R$ ${n.toFixed(0)}`;};
const fmtD=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR"):'—';
const fmtMes=(v:string)=>v?new Date(v+'T00:00:00').toLocaleDateString("pt-BR",{month:'short',year:'2-digit'}):'—';
const hoje=()=>new Date().toISOString().slice(0,10);

export default function ContratosPage(){
  const { companyIds, companies, selInfo } = useCompanyIds();
  // Estabiliza dependencia (array novo a cada render)
  const companyIdsKey = useMemo(()=>[...(companyIds??[])].sort().join(','), [companyIds]);
  const empresaUnica = companyIds.length === 1 ? companyIds[0] : null;
  const multiEmpresa = companyIds.length > 1;
  const empresaPorId = useMemo(()=>{
    const m = new Map<string,string>();
    for (const c of companies) m.set(c.id, c.nome_fantasia || c.razao_social || 'Empresa');
    return m;
  }, [companies]);
  const empresasNoEscopo = useMemo(()=>{
    const ids = companyIdsKey ? companyIdsKey.split(',') : [];
    return ids.map(id => ({ id, nome: empresaPorId.get(id) || 'Empresa' }))
              .sort((a,b)=>a.nome.localeCompare(b.nome));
  }, [companyIdsKey, empresaPorId]);

  const [contratos,setContratos]=useState<Contrato[]>([]);
  const [clientes,setClientes]=useState<any[]>([]);
  const [tab,setTab]=useState<'contratos'|'dashboard'|'acoes'>('dashboard');
  const [loading,setLoading]=useState(true);
  const [busca,setBusca]=useState("");
  const [filtroStatus,setFiltroStatus]=useState("ativo");
  const [msg,setMsg]=useState("");

  const [metricas,setMetricas]=useState<any>(null);
  const [historico,setHistorico]=useState<any[]>([]);
  const [mrrPorTipo,setMrrPorTipo]=useState<any[]>([]);
  const [topClientes,setTopClientes]=useState<any[]>([]);

  // Estados Acoes (carregados da view enriquecida + count)
  const [reajustesPendentes,setReajustesPendentes]=useState<Contrato[]>([]);
  const [renovacoesProximas,setRenovacoesProximas]=useState<Contrato[]>([]);
  const [gerandoEsteMesCount,setGerandoEsteMesCount]=useState(0);

  const [showNovo,setShowNovo]=useState(false);
  const [showDetalhe,setShowDetalhe]=useState<Contrato|null>(null);
  const [eventosDetalhe,setEventosDetalhe]=useState<any[]>([]);
  const [reajustesDetalhe,setReajustesDetalhe]=useState<any[]>([]);
  const [buscaCli,setBuscaCli]=useState("");
  const [novoContrato,setNovoContrato]=useState<any>({
    cliente_id:'',cliente_nome:'',cliente_cnpj:'',cliente_email:'',
    tipo:'bpo_financeiro',nome:'',descricao:'',escopo:'',
    valor_mensal:0,data_inicio:hoje(),data_fim:'',dia_vencimento:10,
    periodicidade:'mensal',tipo_reajuste:'ipca',reajuste_percentual:0,mes_reajuste:1,
    forma_pagamento:'boleto',
  });
  // Empresa-alvo do novo contrato (necessario quando multi)
  const [novoCompanyId,setNovoCompanyId]=useState<string>("");

  const [showReajuste,setShowReajuste]=useState<Contrato|null>(null);
  const [pctReajuste,setPctReajuste]=useState(0);
  const [processando,setProcessando]=useState(false);

  // Define empresa-alvo padrao do modal sempre que escopo muda
  useEffect(()=>{
    if (empresaUnica) setNovoCompanyId(empresaUnica);
    else if (empresasNoEscopo.length>0) setNovoCompanyId(empresasNoEscopo[0].id);
    else setNovoCompanyId("");
  }, [empresaUnica, empresasNoEscopo]);

  // --- LOADERS ---

  const loadContratos = useCallback(async ()=>{
    if (!companyIdsKey) { setContratos([]); setLoading(false); return; }
    setLoading(true);
    const ids = companyIdsKey.split(',');
    // View enriquecida traz mrr_equivalente, situacao_vigencia, situacao_reajuste,
    // faturas_em_aberto, faturas_vencidas, total_recebido, proxima_fatura_prevista.
    const { data, error } = await supabase
      .from('v_contratos_dashboard')
      .select('*')
      .in('company_id', ids)
      .order('created_at', { ascending: false });
    if (error && !error.message.includes('does not exist')) {
      setMsg("Erro: "+error.message);
    }
    setContratos((data as any) || []);
    setLoading(false);
  }, [companyIdsKey]);

  const loadClientes = useCallback(async ()=>{
    if (!companyIdsKey) { setClientes([]); return; }
    const ids = companyIdsKey.split(',');
    const { data } = await supabase
      .from('erp_clientes')
      .select('id, company_id, razao_social, nome_fantasia, nome, cpf_cnpj, email')
      .in('company_id', ids)
      .eq('ativo', true)
      .order('razao_social');
    if (data) setClientes(data);
  }, [companyIdsKey]);

  const loadMetricas = useCallback(async ()=>{
    // KPIs/grafico SaaS so fazem sentido em empresa unica (LTV/churn nao somam)
    if (!empresaUnica) { setMetricas(null); setHistorico([]); return; }
    const [{ data: m }, { data: h }] = await Promise.all([
      supabase.rpc('calcular_metricas_saas', { p_company_id: empresaUnica }),
      supabase.rpc('historico_mrr', { p_company_id: empresaUnica, p_meses: 12 }),
    ]);
    if (m && m[0]) setMetricas(m[0]); else setMetricas(null);
    setHistorico(h || []);
  }, [empresaUnica]);

  const loadDashboardSplits = useCallback(async ()=>{
    if (!companyIdsKey) { setMrrPorTipo([]); setTopClientes([]); return; }
    const ids = companyIdsKey.split(',');
    const [tipoR, topR] = await Promise.all([
      supabase.from('v_contratos_mrr_por_tipo').select('*').in('company_id', ids),
      supabase.from('v_contratos_top_clientes').select('*').in('company_id', ids),
    ]);
    setMrrPorTipo((tipoR.data as any) || []);
    setTopClientes((topR.data as any) || []);
  }, [companyIdsKey]);

  const loadAcoesData = useCallback(async ()=>{
    if (!companyIdsKey) {
      setReajustesPendentes([]); setRenovacoesProximas([]); setGerandoEsteMesCount(0);
      return;
    }
    const ids = companyIdsKey.split(',');
    const mesYM = new Date().toISOString().slice(0,7);
    // Reajustes pendentes + renovacoes proximas: filtra na view enriquecida
    const [rajR, renR, contagemR] = await Promise.all([
      supabase.from('v_contratos_dashboard').select('*')
        .in('company_id', ids).eq('situacao_reajuste','reajuste_pendente'),
      supabase.from('v_contratos_dashboard').select('*')
        .in('company_id', ids).eq('situacao_vigencia','renovacao_proxima')
        .order('data_fim', { ascending: true }),
      // Quantos contratos ativos AINDA NAO tiveram fatura este mes
      supabase.from('erp_contratos').select('id, ultimo_titulo_gerado_em', { count: 'exact', head: false })
        .in('company_id', ids).eq('status','ativo'),
    ]);
    setReajustesPendentes((rajR.data as any) || []);
    setRenovacoesProximas((renR.data as any) || []);
    // Contagem: contratos ativos cujo ultimo_titulo_gerado_em nao corresponde ao mes atual
    const ativos = (contagemR.data as any[]) || [];
    const pendentes = ativos.filter(c => !c.ultimo_titulo_gerado_em || !String(c.ultimo_titulo_gerado_em).startsWith(mesYM));
    setGerandoEsteMesCount(pendentes.length);
  }, [companyIdsKey]);

  // Reload tudo quando escopo muda
  useEffect(()=>{
    loadContratos();
    loadClientes();
    loadMetricas();
    loadDashboardSplits();
    loadAcoesData();
  }, [loadContratos, loadClientes, loadMetricas, loadDashboardSplits, loadAcoesData]);

  const refetchAll = ()=>{
    loadContratos(); loadMetricas(); loadDashboardSplits(); loadAcoesData();
  };

  const criarContrato=async()=>{
    if (!novoCompanyId) { setMsg("❌ Selecione a empresa"); return; }
    if(!novoContrato.cliente_nome||!novoContrato.nome||!novoContrato.valor_mensal){
      setMsg("❌ Preencha cliente, nome e valor");return;
    }
    const{data:{user}}=await supabase.auth.getUser();
    const{data:numero}=await supabase.rpc('next_contrato_numero',{p_company_id:novoCompanyId});

    // Calcula primeiro vencimento
    const dataIni=new Date(novoContrato.data_inicio+'T00:00:00');
    const primeiroVenc=new Date(dataIni.getFullYear(),dataIni.getMonth(),novoContrato.dia_vencimento);
    if(primeiroVenc<dataIni)primeiroVenc.setMonth(primeiroVenc.getMonth()+1);

    // Calcula próximo reajuste
    const proxReaj=new Date(dataIni);
    proxReaj.setFullYear(proxReaj.getFullYear()+1);

    const{error}=await supabase.from("erp_contratos").insert({
      ...novoContrato,
      company_id:novoCompanyId,
      numero,
      valor_atual:novoContrato.valor_mensal,
      data_primeiro_vencimento:primeiroVenc.toISOString().slice(0,10),
      proximo_reajuste_em:proxReaj.toISOString().slice(0,10),
      data_fim:novoContrato.data_fim||null,
      created_by:user?.id,
    });

    if(error){setMsg("❌ "+error.message);return;}
    setMsg(`✅ Contrato ${numero} criado com sucesso`);
    setShowNovo(false);
    setNovoContrato({cliente_id:'',cliente_nome:'',cliente_cnpj:'',cliente_email:'',tipo:'bpo_financeiro',nome:'',descricao:'',escopo:'',valor_mensal:0,data_inicio:hoje(),data_fim:'',dia_vencimento:10,periodicidade:'mensal',tipo_reajuste:'ipca',reajuste_percentual:0,mes_reajuste:1,forma_pagamento:'boleto'});
    setBuscaCli("");
    refetchAll();
    setTimeout(()=>setMsg(""),3000);
  };

  // RPC nova: fn_contrato_processar_lote_diario(p_data_referencia date)
  // Retorna jsonb { success, total_processado, total_sucesso, total_idempotente, total_erro, erros }
  const gerarTitulosMes=async()=>{
    if (gerandoEsteMesCount === 0) return;
    if(!confirm(`Gerar títulos de ${new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'})} para todos os contratos ativos?`))return;
    setProcessando(true);
    const dataRef = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase.rpc('fn_contrato_processar_lote_diario', { p_data_referencia: dataRef });
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    const r:any = Array.isArray(data) ? (data[0]||{}) : (data||{});
    const sucesso = r.total_sucesso ?? r.gerados ?? 0;
    const idemp = r.total_idempotente ?? r.ja_existentes ?? 0;
    const erro = r.total_erro ?? 0;
    setMsg(`✅ ${sucesso} título(s) gerados · ${idemp} já existiam${erro>0?` · ${erro} erro(s)`:''}`);
    setProcessando(false);
    refetchAll();
    setTimeout(()=>setMsg(""),5000);
  };

  // RPC nova: fn_contrato_aplicar_reajuste(p_contrato_id, p_indice_aplicado)
  // p_indice_aplicado=null usa reajuste_percentual configurado no contrato
  const aplicarReajusteIndice=async(c:Contrato)=>{
    if(!confirm(`Aplicar reajuste configurado (${c.tipo_reajuste?.toUpperCase()} ${Number(c.reajuste_percentual||0).toFixed(2)}%) em "${c.cliente_nome}"?`))return;
    setProcessando(true);
    const { error } = await supabase.rpc('fn_contrato_aplicar_reajuste', {
      p_contrato_id: c.id,
      p_indice_aplicado: null,
    });
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    setMsg(`✅ Reajuste aplicado em ${c.cliente_nome}`);
    setProcessando(false);
    refetchAll();
    setTimeout(()=>setMsg(""),3000);
  };

  const aplicarReajuste=async()=>{
    if(!showReajuste||pctReajuste<=0)return;
    setProcessando(true);
    const { error } = await supabase.rpc('fn_contrato_aplicar_reajuste',{
      p_contrato_id: showReajuste.id,
      p_indice_aplicado: pctReajuste,
    });
    if(error){setMsg("❌ "+error.message);setProcessando(false);return;}
    setMsg(`✅ Reajuste de ${pctReajuste}% aplicado`);
    setShowReajuste(null);
    setPctReajuste(0);
    setProcessando(false);
    refetchAll();
    setTimeout(()=>setMsg(""),3000);
  };

  const encerrarContrato=async(c:Contrato)=>{
    const motivo=prompt("Motivo do encerramento:");
    if(!motivo)return;
    await supabase.from("erp_contratos").update({
      status:'encerrado',
      data_encerramento:hoje(),
      motivo_encerramento:motivo,
    }).eq("id",c.id);
    await supabase.from("erp_contratos_eventos").insert({
      contrato_id:c.id,
      company_id:c.company_id,
      evento:'encerrado',
      detalhe:'Motivo: '+motivo,
    });
    setMsg("✅ Contrato encerrado");
    setShowDetalhe(null);
    refetchAll();
    setTimeout(()=>setMsg(""),3000);
  };

  const abrirDetalhe=async(c:Contrato)=>{
    setShowDetalhe(c);
    const[{data:ev},{data:rj}]=await Promise.all([
      supabase.from("erp_contratos_eventos").select("*").eq("contrato_id",c.id).order("created_at",{ascending:false}).limit(20),
      supabase.from("erp_contratos_reajustes").select("*").eq("contrato_id",c.id).order("data_reajuste",{ascending:false}),
    ]);
    setEventosDetalhe(ev||[]);
    setReajustesDetalhe(rj||[]);
  };

  const filtrados=useMemo(()=>{
    let r=contratos;
    if(filtroStatus!=='todos')r=r.filter(c=>c.status===filtroStatus);
    if(busca.trim()){
      const b=busca.toLowerCase();
      r=r.filter(c=>(c.numero||'').toLowerCase().includes(b)||(c.cliente_nome||'').toLowerCase().includes(b)||(c.nome||'').toLowerCase().includes(b));
    }
    return r;
  },[contratos,filtroStatus,busca]);

  const clientesBusca=useMemo(()=>{
    if(!buscaCli.trim())return[];
    const b=buscaCli.toLowerCase();
    // Filtra clientes da empresa-alvo do novo contrato (quando definida)
    const baseCli = novoCompanyId ? clientes.filter(c=>c.company_id===novoCompanyId) : clientes;
    return baseCli.filter(c=>(c.razao_social||'').toLowerCase().includes(b)||(c.nome_fantasia||'').toLowerCase().includes(b)||(c.cpf_cnpj||'').includes(b.replace(/\D/g,''))).slice(0,8);
  },[clientes,buscaCli,novoCompanyId]);

  const selSt:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:8,padding:"6px 10px",fontSize:11,fontWeight:600};
  const inp:React.CSSProperties={background:BG3,border:`1px solid ${BD}`,color:TX,borderRadius:6,padding:"8px 10px",fontSize:12,outline:"none",width:"100%"};

  // Gráfico MRR
  const graficoMRR=useMemo(()=>{
    if(historico.length===0)return null;
    const W=900,H=180,PAD_L=60,PAD_R=20,PAD_T=15,PAD_B=35;
    const plotW=W-PAD_L-PAD_R,plotH=H-PAD_T-PAD_B;
    const maxMRR=Math.max(...historico.map((h:any)=>Number(h.mrr)),1);
    
    const xAt=(i:number)=>PAD_L+(plotW*i)/Math.max(historico.length-1,1);
    const yAt=(v:number)=>PAD_T+plotH-(v/maxMRR)*plotH;
    
    const path=historico.map((h:any,i:number)=>`${i===0?'M':'L'}${xAt(i)},${yAt(Number(h.mrr))}`).join(' ');
    
    return(
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto"}}>
        {[0,0.25,0.5,0.75,1].map((t,i)=>(
          <g key={i}>
            <line x1={PAD_L} y1={yAt(maxMRR*t)} x2={W-PAD_R} y2={yAt(maxMRR*t)} stroke={BD} strokeWidth={0.5} strokeDasharray="2 4"/>
            <text x={PAD_L-8} y={yAt(maxMRR*t)+3} fontSize={9} fill={TXD} textAnchor="end">{fmtRk(maxMRR*t)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke={GO} strokeWidth={2.5}/>
        <path d={path+' L'+xAt(historico.length-1)+','+(PAD_T+plotH)+' L'+PAD_L+','+(PAD_T+plotH)+' Z'} fill={GO} opacity={0.1}/>
        {historico.map((h:any,i:number)=>(
          <g key={i}>
            <circle cx={xAt(i)} cy={yAt(Number(h.mrr))} r={3} fill={GO}/>
            {i%2===0&&<text x={xAt(i)} y={H-PAD_B+12} fontSize={9} fill={TXD} textAnchor="middle">{fmtMes(h.mes)}</text>}
          </g>
        ))}
      </svg>
    );
  },[historico]);

  return(
    <div style={{minHeight:"100vh",background:BG,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontSize:22,fontWeight:700,color:TX}}>🔄 Contratos Recorrentes</div>
          <div style={{fontSize:11,color:TXD}}>
            BPO · Consultoria · SaaS · Serviços mensais · Geração automática · MRR/Churn/LTV
            {selInfo && (
              <span style={{marginLeft:8,padding:"2px 8px",borderRadius:6,background:GO+"15",color:GO,fontWeight:600}}>
                {selInfo.nome}{multiEmpresa?` · ${companyIds.length} empresas`:''}
              </span>
            )}
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setShowNovo(true)} disabled={empresasNoEscopo.length===0} style={{padding:"8px 16px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:empresasNoEscopo.length===0?"not-allowed":"pointer",opacity:empresasNoEscopo.length===0?0.5:1}}>+ Novo Contrato</button>
        </div>
      </div>

      {msg&&<div style={{background:msg.startsWith("✅")?G+"15":msg.startsWith("❌")?R+"15":Y+"15",border:`1px solid ${msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y}40`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:11,color:msg.startsWith("✅")?G:msg.startsWith("❌")?R:Y,cursor:"pointer"}} onClick={()=>setMsg("")}>{msg}</div>}

      {/* Tabs */}
      <div style={{display:"flex",gap:6,marginBottom:16,borderBottom:`1px solid ${BD}`}}>
        {[{k:'dashboard',l:'📊 Dashboard SaaS'},{k:'contratos',l:'📋 Contratos'},{k:'acoes',l:'⚡ Ações'}].map(t=>(
          <button key={t.k} onClick={()=>setTab(t.k as any)} style={{padding:"10px 20px",fontSize:12,fontWeight:tab===t.k?700:500,background:"transparent",border:"none",color:tab===t.k?GO:TXM,borderBottom:`3px solid ${tab===t.k?GO:"transparent"}`,cursor:"pointer",marginBottom:-1}}>{t.l}</button>
        ))}
      </div>

      {/* TAB DASHBOARD SAAS */}
      {tab==='dashboard'&&(
        <>
          {multiEmpresa && (
            <div style={{background:GO+"10",border:`1px solid ${GO}40`,borderRadius:10,padding:14,marginBottom:16,fontSize:12,color:TX}}>
              <div style={{fontWeight:600,marginBottom:4,color:GO}}>ℹ️ Múltiplas empresas selecionadas</div>
              <div style={{color:TXM}}>
                Selecione uma única empresa no header para ver KPIs SaaS detalhados e gráfico de evolução do MRR.
                Métricas como churn, LTV e ticket médio não são matematicamente agregáveis entre empresas.
                As abas <b>Contratos</b> e <b>Ações</b> continuam funcionando com todas as empresas selecionadas.
              </div>
            </div>
          )}
          {empresaUnica && metricas?(
            <>
              <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:16}}>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>💎 MRR Mensal</div>
                  <div style={{fontSize:20,fontWeight:800,color:GO,marginTop:2,fontFamily:"monospace"}}>{fmtR(metricas.mrr)}</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>ARR: {fmtR(metricas.arr)}</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>👥 Clientes Ativos</div>
                  <div style={{fontSize:20,fontWeight:800,color:B,marginTop:2}}>{metricas.total_clientes_ativos}</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>Ticket: {fmtR(metricas.ticket_medio)}</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>📉 Churn Rate (12m)</div>
                  <div style={{fontSize:20,fontWeight:800,color:Number(metricas.churn_rate_12m)>10?R:Number(metricas.churn_rate_12m)>5?Y:G,marginTop:2}}>{Number(metricas.churn_rate_12m||0).toFixed(1)}%</div>
                  <div style={{fontSize:9,color:TXD,marginTop:2}}>LTV: {fmtR(metricas.ltv)}</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>📈 Novo MRR (30d)</div>
                  <div style={{fontSize:20,fontWeight:800,color:G,marginTop:2}}>+{fmtR(metricas.novo_mrr_30d)}</div>
                  <div style={{fontSize:9,color:R,marginTop:2}}>-{fmtR(metricas.churned_mrr_30d)} churn</div>
                </div>
                <div style={{background:BG2,borderRadius:10,padding:12,border:`1px solid ${BD}`}}>
                  <div style={{fontSize:9,color:TXD,textTransform:"uppercase",letterSpacing:0.5}}>📅 Renovações 60d</div>
                  <div style={{fontSize:20,fontWeight:800,color:metricas.proximas_renovacoes_60d>0?Y:G,marginTop:2}}>{metricas.proximas_renovacoes_60d}</div>
                </div>
              </div>

              {/* Gráfico de evolução MRR */}
              <div style={{background:BG2,borderRadius:12,padding:16,marginBottom:16,border:`1px solid ${BD}`}}>
                <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>📈 Evolução do MRR (últimos 12 meses)</div>
                {graficoMRR||<div style={{padding:40,textAlign:"center",color:TXD}}>Sem dados históricos ainda</div>}
              </div>
            </>
          ):(empresaUnica?(
            <div style={{padding:40,textAlign:"center",color:TXD}}>Carregando métricas...</div>
          ):null)}

          {/* Splits MRR por Tipo + Top 5 (multi-tenant via views) */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
              <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>💼 MRR por Tipo de Serviço</div>
              {(()=>{
                // Agrega view (varias linhas por empresa) por tipo
                const porTipo:Record<string,{count:number,mrr:number}>={};
                for (const r of (mrrPorTipo||[]) as any[]) {
                  const t = String(r.tipo || 'outros');
                  const mrr = Number(r.mrr_total ?? r.mrr ?? r.valor_total ?? 0);
                  const cnt = Number(r.qtd_contratos ?? r.count ?? r.qtd ?? 1);
                  if (!porTipo[t]) porTipo[t] = { count:0, mrr:0 };
                  porTipo[t].count += cnt;
                  porTipo[t].mrr += mrr;
                }
                const itens = Object.entries(porTipo).sort((a,b)=>b[1].mrr-a[1].mrr);
                const maxMRR = Math.max(...itens.map(i=>i[1].mrr), 1);
                return itens.length===0 ? (
                  <div style={{padding:20,textAlign:"center",color:TXD,fontSize:11}}>Nenhum contrato ativo ainda</div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {itens.map(([tipo,d])=>{
                      const cfg = TIPOS_CONTRATO.find(t=>t.v===tipo);
                      return (
                        <div key={tipo}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,marginBottom:3}}>
                            <span style={{color:TX,fontWeight:500}}>{cfg?.icon} {cfg?.l||tipo} ({d.count})</span>
                            <span style={{color:GO,fontWeight:700}}>{fmtR(d.mrr)}</span>
                          </div>
                          <div style={{background:BG3,height:8,borderRadius:4,overflow:"hidden"}}>
                            <div style={{width:(d.mrr/maxMRR)*100+"%",height:"100%",background:GO}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
              <div style={{fontSize:12,fontWeight:600,color:GO,marginBottom:10,textTransform:"uppercase",letterSpacing:0.5}}>🏆 Top 5 Clientes por MRR</div>
              {(()=>{
                // Ordena view por mrr desc; aceita variacoes de nome
                const top = [...(topClientes||[])].map((r:any)=>({
                  cliente_id: r.cliente_id ?? r.id,
                  cliente_nome: r.cliente_nome ?? r.nome ?? r.razao_social ?? '—',
                  contrato_nome: r.contrato_nome ?? r.nome_contrato ?? r.nome ?? '',
                  mrr: Number(r.mrr_total ?? r.mrr ?? r.valor_atual ?? 0),
                  company_id: r.company_id,
                })).sort((a,b)=>b.mrr-a.mrr).slice(0,5);
                return top.length===0 ? (
                  <div style={{padding:20,textAlign:"center",color:TXD,fontSize:11}}>Nenhum contrato ativo</div>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {top.map((c,i)=>(
                      <div key={(c.cliente_id||'')+i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:8,background:BG3,borderRadius:6}}>
                        <div style={{display:"flex",alignItems:"center",gap:10}}>
                          <div style={{fontSize:14,fontWeight:800,color:i===0?GO:TXD,minWidth:20}}>{i+1}</div>
                          <div>
                            <div style={{fontSize:11,fontWeight:600,color:TX}}>{c.cliente_nome}</div>
                            <div style={{fontSize:9,color:TXD}}>
                              {c.contrato_nome}{multiEmpresa && c.company_id?` · ${empresaPorId.get(c.company_id)||''}`:''}
                            </div>
                          </div>
                        </div>
                        <div style={{fontSize:13,fontWeight:700,color:G,fontFamily:"monospace"}}>{fmtR(c.mrr)}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* TAB CONTRATOS */}
      {tab==='contratos'&&(
        <>
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:200,position:"relative"}}>
              <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar por número, cliente, nome do contrato..." style={{...inp,paddingLeft:32}}/>
              <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:14,color:TXD}}>🔍</span>
            </div>
            <div style={{display:"flex",gap:4}}>
              <button onClick={()=>setFiltroStatus("todos")} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus==="todos"?GO:BD}`,background:filtroStatus==="todos"?GO+"12":"transparent",color:filtroStatus==="todos"?GO:TXM,cursor:"pointer",fontWeight:filtroStatus==="todos"?600:400}}>Todos</button>
              {Object.entries(STATUS_CFG).map(([k,cfg])=>(
                <button key={k} onClick={()=>setFiltroStatus(k)} style={{padding:"6px 10px",borderRadius:6,fontSize:10,border:`1px solid ${filtroStatus===k?cfg.cor:BD}`,background:filtroStatus===k?cfg.cor+"12":"transparent",color:filtroStatus===k?cfg.cor:TXM,cursor:"pointer",fontWeight:filtroStatus===k?600:400}}>{cfg.icon} {cfg.label}</button>
              ))}
            </div>
          </div>

          {loading?(<div style={{textAlign:"center",padding:40,color:TXD}}>Carregando...</div>):(
            <div style={{background:BG2,borderRadius:12,border:`1px solid ${BD}`,overflow:"auto"}}>
              {filtrados.length===0?(
                <div style={{padding:40,textAlign:"center"}}>
                  <div style={{fontSize:40,marginBottom:8}}>🔄</div>
                  <div style={{fontSize:14,fontWeight:600,color:TX,marginBottom:4}}>Nenhum contrato ainda</div>
                  <div style={{fontSize:11,color:TXD,marginBottom:16}}>Cadastre seus clientes BPO, de consultoria, SaaS, etc.</div>
                  <button onClick={()=>setShowNovo(true)} style={{padding:"10px 20px",borderRadius:8,background:GO,color:"#FFF",fontSize:12,fontWeight:600,border:"none",cursor:"pointer"}}>+ Primeiro Contrato</button>
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                  <thead><tr style={{borderBottom:`2px solid ${BD}`,background:BG3}}>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Número</th>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Cliente</th>
                    <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10}}>Contrato</th>
                    {multiEmpresa && <th style={{padding:"8px",textAlign:"left",color:TXD,fontSize:10,width:140}}>Empresa</th>}
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:60}}>Venc</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:110}}>Valor Mensal</th>
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:110}}>Reajuste</th>
                    <th style={{padding:"8px",textAlign:"center",color:TXD,fontSize:10,width:100}}>Status</th>
                    <th style={{padding:"8px",textAlign:"right",color:TXD,fontSize:10,width:80}}>Ações</th>
                  </tr></thead>
                  <tbody>
                    {filtrados.map(c=>{
                      const cfg=STATUS_CFG[c.status]||STATUS_CFG.ativo;
                      const tipoCfg=TIPOS_CONTRATO.find(t=>t.v===c.tipo);
                      return(
                        <tr key={c.id} style={{borderBottom:`0.5px solid ${BD}`,cursor:"pointer"}} onClick={()=>abrirDetalhe(c)}>
                          <td style={{padding:"8px",fontFamily:"monospace",fontWeight:600,color:GO}}>{c.numero}</td>
                          <td style={{padding:"8px"}}>
                            <div style={{fontWeight:500,color:TX}}>{c.cliente_nome}</div>
                            {c.cliente_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{c.cliente_cnpj}</div>}
                          </td>
                          <td style={{padding:"8px"}}>
                            <div style={{fontSize:11,fontWeight:500,color:TX}}>{tipoCfg?.icon} {c.nome}</div>
                            <div style={{fontSize:9,color:TXD}}>{tipoCfg?.l||c.tipo} · {c.periodicidade}</div>
                          </td>
                          {multiEmpresa && (
                            <td style={{padding:"8px",fontSize:11,color:TX}}>{empresaPorId.get(c.company_id)||'—'}</td>
                          )}
                          <td style={{padding:"8px",textAlign:"center",color:TXM,fontWeight:600}}>{c.dia_vencimento}</td>
                          <td style={{padding:"8px",textAlign:"right"}}>
                            <div style={{color:G,fontWeight:700}}>{fmtR(c.valor_atual||c.valor_mensal)}</div>
                            {Number(c.valor_atual)!==Number(c.valor_mensal)&&<div style={{fontSize:9,color:TXD}}>inicial: {fmtR(c.valor_mensal)}</div>}
                          </td>
                          <td style={{padding:"8px",textAlign:"center"}}>
                            {c.tipo_reajuste!=='nenhum'?(
                              <div>
                                <div style={{fontSize:10,color:TX,fontWeight:600}}>{c.tipo_reajuste.toUpperCase()}</div>
                                {c.proximo_reajuste_em&&<div style={{fontSize:9,color:TXD}}>{fmtD(c.proximo_reajuste_em)}</div>}
                              </div>
                            ):<span style={{fontSize:10,color:TXD}}>—</span>}
                          </td>
                          <td style={{padding:"8px",textAlign:"center"}}>
                            <span style={{fontSize:9,padding:"3px 10px",borderRadius:6,background:cfg.cor+"15",color:cfg.cor,fontWeight:600,whiteSpace:"nowrap"}}>{cfg.icon} {cfg.label}</span>
                          </td>
                          <td style={{padding:"8px",textAlign:"right"}} onClick={e=>e.stopPropagation()}>
                            <button onClick={()=>abrirDetalhe(c)} style={{fontSize:10,padding:"4px 10px",borderRadius:6,background:GO+"15",color:GO,border:`1px solid ${GO}40`,cursor:"pointer",fontWeight:600}}>Ver →</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {/* TAB AÇÕES */}
      {tab==='acoes'&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {/* Gerar títulos do mês */}
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:14,fontWeight:700,color:TX,marginBottom:8}}>⚡ Gerar Títulos do Mês</div>
            <div style={{fontSize:11,color:TXD,marginBottom:14}}>Processa todos os contratos ativos elegíveis e cria lançamentos em Contas a Receber (idempotente).</div>
            <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:12}}>
              <div style={{fontSize:10,color:TXD,marginBottom:4}}>MÊS ATUAL</div>
              <div style={{fontSize:16,fontWeight:700,color:TX}}>{new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'})}</div>
              <div style={{fontSize:11,color:TXM,marginTop:4}}><b>{gerandoEsteMesCount}</b> contrato(s) ainda não tiveram título gerado este mês</div>
            </div>
            <button onClick={gerarTitulosMes} disabled={processando||gerandoEsteMesCount===0} style={{width:"100%",padding:"12px",borderRadius:10,background:G,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:gerandoEsteMesCount===0?"not-allowed":"pointer",opacity:gerandoEsteMesCount===0?0.5:1}}>{processando?"⏳ Processando...":gerandoEsteMesCount===0?"✅ Tudo em dia":`💰 Gerar ${gerandoEsteMesCount} Título(s)`}</button>
          </div>

          {/* Reajustes pendentes (vem da view enriquecida: situacao_reajuste='reajuste_pendente') */}
          <div style={{background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:14,fontWeight:700,color:TX,marginBottom:8}}>📈 Reajustes Devidos</div>
            <div style={{fontSize:11,color:TXD,marginBottom:14}}>Contratos cujo aniversário de reajuste já passou.</div>
            {reajustesPendentes.length===0?(
              <div style={{background:G+"10",borderRadius:8,padding:16,textAlign:"center",fontSize:11,color:G,fontWeight:600,border:`1px solid ${G}30`}}>✅ Nenhum reajuste pendente</div>
            ):(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {reajustesPendentes.map(c=>{
                  const pct = Number(c.reajuste_percentual||0);
                  const tipoReaj = String(c.tipo_reajuste||'').toUpperCase();
                  return (
                    <div key={c.id} style={{background:BG3,borderRadius:8,padding:10}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,marginBottom:8}}>
                        <div style={{minWidth:0,flex:1}}>
                          <div style={{fontSize:11,fontWeight:600,color:TX}}>{c.cliente_nome}</div>
                          <div style={{fontSize:9,color:TXD}}>
                            {c.numero} · {tipoReaj} · devido desde {fmtD(c.proximo_reajuste_em)}
                            {multiEmpresa && c.company_id && ` · ${empresaPorId.get(c.company_id)||''}`}
                          </div>
                        </div>
                        <div style={{fontSize:11,fontWeight:700,color:G,fontFamily:"monospace",whiteSpace:"nowrap"}}>{fmtR(c.valor_atual||c.valor_mensal)}</div>
                      </div>
                      <div style={{display:"flex",gap:6}}>
                        <button
                          onClick={()=>aplicarReajusteIndice(c)}
                          disabled={processando||pct<=0}
                          style={{flex:1,padding:"6px 12px",borderRadius:6,background:GO,color:"#FFF",fontSize:10,fontWeight:600,border:"none",cursor:pct<=0?"not-allowed":"pointer",opacity:pct<=0?0.5:1}}
                          title={pct<=0?"Configure reajuste_percentual no contrato":""}
                        >
                          Aplicar {tipoReaj} {pct>0?`${pct.toFixed(2)}%`:''}
                        </button>
                        <button
                          onClick={()=>{setShowReajuste(c);setPctReajuste(pct||5);}}
                          disabled={processando}
                          style={{padding:"6px 12px",borderRadius:6,background:"transparent",color:TXM,fontSize:10,fontWeight:600,border:`1px solid ${BD}`,cursor:"pointer"}}
                        >
                          Customizar…
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Próximas renovações (vem da view: situacao_vigencia='renovacao_proxima') */}
          <div style={{gridColumn:"span 2",background:BG2,borderRadius:12,padding:16,border:`1px solid ${BD}`}}>
            <div style={{fontSize:14,fontWeight:700,color:TX,marginBottom:8}}>📅 Próximas Renovações (60 dias)</div>
            {renovacoesProximas.length===0?(
              <div style={{background:G+"10",borderRadius:8,padding:16,textAlign:"center",fontSize:11,color:G,fontWeight:600,border:`1px solid ${G}30`}}>✅ Nenhum contrato vencendo nos próximos 60 dias</div>
            ):(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                {renovacoesProximas.map(c=>{
                  const dias=Math.ceil((new Date(c.data_fim+'T00:00:00').getTime()-Date.now())/(1000*60*60*24));
                  return(
                    <div key={c.id} style={{background:BG3,borderRadius:8,padding:12,borderLeft:`4px solid ${dias<=15?R:dias<=30?Y:B}`}}>
                      <div style={{fontSize:11,fontWeight:600,color:TX}}>{c.cliente_nome}</div>
                      <div style={{fontSize:10,color:TXM}}>{c.nome}{multiEmpresa && c.company_id ? ` · ${empresaPorId.get(c.company_id)||''}`:''}</div>
                      <div style={{fontSize:13,fontWeight:700,color:dias<=15?R:dias<=30?Y:B,marginTop:6}}>
                        Vence em {dias} dias
                      </div>
                      <div style={{fontSize:9,color:TXD}}>{fmtD(c.data_fim)} · MRR: {fmtR(c.valor_atual||c.valor_mensal)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Novo Contrato */}
      {showNovo&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowNovo(false)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:800,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:700,color:TX}}>+ Novo Contrato Recorrente</div>
              <button onClick={()=>setShowNovo(false)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            {/* Empresa fornecedora (so quando multi) */}
            {multiEmpresa && (
              <div style={{marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:6}}>🏢 Empresa fornecedora *</div>
                <select value={novoCompanyId} onChange={e=>setNovoCompanyId(e.target.value)} style={{...inp,cursor:"pointer"}}>
                  {empresasNoEscopo.map(e=>(<option key={e.id} value={e.id}>{e.nome}</option>))}
                </select>
              </div>
            )}

            {/* Cliente */}
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:600,color:GO,marginBottom:6}}>👤 Cliente</div>
              {novoContrato.cliente_nome?(
                <div style={{background:BG3,borderRadius:8,padding:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:TX}}>{novoContrato.cliente_nome}</div>
                    {novoContrato.cliente_cnpj&&<div style={{fontSize:10,color:TXD,fontFamily:"monospace"}}>{novoContrato.cliente_cnpj}</div>}
                  </div>
                  <button onClick={()=>setNovoContrato({...novoContrato,cliente_id:'',cliente_nome:'',cliente_cnpj:'',cliente_email:''})} style={{background:"none",border:"none",color:R,cursor:"pointer"}}>✕</button>
                </div>
              ):(
                <div style={{position:"relative"}}>
                  <input value={buscaCli} onChange={e=>setBuscaCli(e.target.value)} placeholder="Digite nome ou CNPJ do cliente..." style={inp}/>
                  {clientesBusca.length>0&&(
                    <div style={{position:"absolute",top:"100%",left:0,right:0,background:BG2,border:`1px solid ${BD}`,borderRadius:8,maxHeight:240,overflowY:"auto",zIndex:10}}>
                      {clientesBusca.map(c=>(
                        <div key={c.id} onClick={()=>{setNovoContrato({...novoContrato,cliente_id:c.id,cliente_nome:c.razao_social||c.nome_fantasia||c.nome,cliente_cnpj:c.cpf_cnpj,cliente_email:c.email||''});setBuscaCli("");}} style={{padding:10,cursor:"pointer",borderBottom:`0.5px solid ${BD}`}} onMouseEnter={e=>(e.currentTarget.style.background=GO+"10")} onMouseLeave={e=>(e.currentTarget.style.background="transparent")}>
                          <div style={{fontSize:11,fontWeight:500,color:TX}}>{c.razao_social||c.nome_fantasia||c.nome}</div>
                          {c.cpf_cnpj&&<div style={{fontSize:9,color:TXD,fontFamily:"monospace"}}>{c.cpf_cnpj}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo *</div>
                <select value={novoContrato.tipo} onChange={e=>setNovoContrato({...novoContrato,tipo:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  {TIPOS_CONTRATO.map(t=><option key={t.v} value={t.v}>{t.icon} {t.l}</option>)}
                </select></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Periodicidade</div>
                <select value={novoContrato.periodicidade} onChange={e=>setNovoContrato({...novoContrato,periodicidade:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="mensal">Mensal</option>
                  <option value="bimestral">Bimestral</option>
                  <option value="trimestral">Trimestral</option>
                  <option value="semestral">Semestral</option>
                  <option value="anual">Anual</option>
                </select></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Nome do Contrato *</div>
                <input value={novoContrato.nome} onChange={e=>setNovoContrato({...novoContrato,nome:e.target.value})} placeholder="Ex: BPO Financeiro Mensal Premium" style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Valor Mensal (R$) *</div>
                <input type="number" step="0.01" value={novoContrato.valor_mensal||''} onChange={e=>setNovoContrato({...novoContrato,valor_mensal:parseFloat(e.target.value)||0})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Dia do Vencimento</div>
                <input type="number" min="1" max="28" value={novoContrato.dia_vencimento} onChange={e=>setNovoContrato({...novoContrato,dia_vencimento:parseInt(e.target.value)||10})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Data de Início *</div>
                <input type="date" value={novoContrato.data_inicio} onChange={e=>setNovoContrato({...novoContrato,data_inicio:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Data Final (opcional)</div>
                <input type="date" value={novoContrato.data_fim} onChange={e=>setNovoContrato({...novoContrato,data_fim:e.target.value})} style={inp}/></div>
              <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>Tipo de Reajuste</div>
                <select value={novoContrato.tipo_reajuste} onChange={e=>setNovoContrato({...novoContrato,tipo_reajuste:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="nenhum">Sem reajuste</option>
                  <option value="ipca">IPCA anual</option>
                  <option value="igpm">IGPM anual</option>
                  <option value="inpc">INPC anual</option>
                  <option value="fixo">Fixo %</option>
                  <option value="custom">Customizado</option>
                </select></div>
              {(novoContrato.tipo_reajuste==='fixo'||novoContrato.tipo_reajuste==='custom')&&(
                <div><div style={{fontSize:10,color:TXD,marginBottom:3}}>% Reajuste</div>
                  <input type="number" step="0.01" value={novoContrato.reajuste_percentual||''} onChange={e=>setNovoContrato({...novoContrato,reajuste_percentual:parseFloat(e.target.value)||0})} style={inp}/></div>
              )}
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Forma de Pagamento</div>
                <select value={novoContrato.forma_pagamento} onChange={e=>setNovoContrato({...novoContrato,forma_pagamento:e.target.value})} style={{...inp,cursor:"pointer"}}>
                  <option value="boleto">Boleto</option>
                  <option value="pix">PIX</option>
                  <option value="transferencia">Transferência</option>
                  <option value="cartao">Cartão de Crédito</option>
                  <option value="debito_automatico">Débito Automático</option>
                </select></div>
              <div style={{gridColumn:"span 2"}}><div style={{fontSize:10,color:TXD,marginBottom:3}}>Escopo dos Serviços</div>
                <textarea value={novoContrato.escopo} onChange={e=>setNovoContrato({...novoContrato,escopo:e.target.value})} rows={3} placeholder="Ex: Conciliação bancária · Lançamentos · Relatórios mensais · Atendimento ilimitado..." style={{...inp,resize:"vertical"}}/></div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowNovo(false)} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={criarContrato} style={{padding:"10px 24px",borderRadius:8,background:"#C8941A",color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:"pointer"}}>Criar Contrato</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Detalhe */}
      {showDetalhe&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowDetalhe(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:900,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div style={{fontSize:20,fontWeight:700,color:TX}}>{showDetalhe.nome}</div>
                <div style={{fontSize:11,color:TXD}}>Contrato <span style={{color:GO,fontFamily:"monospace"}}>{showDetalhe.numero}</span> · {showDetalhe.cliente_nome}</div>
              </div>
              <button onClick={()=>setShowDetalhe(null)} style={{background:"none",border:"none",color:TXD,fontSize:22,cursor:"pointer"}}>✕</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>VALOR ATUAL</div><div style={{fontSize:15,fontWeight:700,color:G}}>{fmtR(showDetalhe.valor_atual||showDetalhe.valor_mensal)}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>DIA VENCIMENTO</div><div style={{fontSize:15,fontWeight:700,color:TX}}>{showDetalhe.dia_vencimento}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TÍTULOS GERADOS</div><div style={{fontSize:15,fontWeight:700,color:B}}>{showDetalhe.total_titulos_gerados||0}</div></div>
              <div style={{background:BG3,borderRadius:8,padding:10}}><div style={{fontSize:9,color:TXD}}>TOTAL FATURADO</div><div style={{fontSize:15,fontWeight:700,color:GO}}>{fmtR(showDetalhe.total_faturado)}</div></div>
            </div>

            {showDetalhe.escopo&&(
              <div style={{background:BG3,borderRadius:10,padding:12,marginBottom:16,borderLeft:`3px solid ${GO}`}}>
                <div style={{fontSize:10,color:TXD,marginBottom:4,textTransform:"uppercase"}}>Escopo</div>
                <div style={{fontSize:12,color:TX,whiteSpace:"pre-wrap"}}>{showDetalhe.escopo}</div>
              </div>
            )}

            {reajustesDetalhe.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:GO,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📈 Histórico de Reajustes</div>
                <div style={{background:BG3,borderRadius:8,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                    <thead><tr style={{borderBottom:`1px solid ${BD}`}}>
                      <th style={{padding:6,textAlign:"left",color:TXD,fontSize:9}}>Data</th>
                      <th style={{padding:6,textAlign:"right",color:TXD,fontSize:9}}>De</th>
                      <th style={{padding:6,textAlign:"right",color:TXD,fontSize:9}}>Para</th>
                      <th style={{padding:6,textAlign:"right",color:TXD,fontSize:9}}>%</th>
                      <th style={{padding:6,textAlign:"center",color:TXD,fontSize:9}}>Índice</th>
                    </tr></thead>
                    <tbody>
                      {reajustesDetalhe.map((r:any)=>(
                        <tr key={r.id} style={{borderBottom:`0.5px solid ${BD}`}}>
                          <td style={{padding:6,color:TXM,fontSize:10}}>{fmtD(r.data_reajuste)}</td>
                          <td style={{padding:6,textAlign:"right",color:TXM}}>{fmtR(r.valor_anterior)}</td>
                          <td style={{padding:6,textAlign:"right",color:G,fontWeight:600}}>{fmtR(r.valor_novo)}</td>
                          <td style={{padding:6,textAlign:"right",color:Y,fontWeight:600}}>+{Number(r.percentual_aplicado).toFixed(2)}%</td>
                          <td style={{padding:6,textAlign:"center",color:TXD,fontSize:9}}>{r.tipo_indice}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {eventosDetalhe.length>0&&(
              <div style={{marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:700,color:GO,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>📜 Histórico de Eventos</div>
                <div style={{background:BG3,borderRadius:8,padding:10,maxHeight:200,overflowY:"auto"}}>
                  {eventosDetalhe.map((e:any)=>(
                    <div key={e.id} style={{padding:6,borderBottom:`0.5px solid ${BD}`,fontSize:11}}>
                      <span style={{fontSize:10,color:TXD,fontFamily:"monospace"}}>{new Date(e.created_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'})}</span>
                      <span style={{margin:"0 6px",color:P,fontWeight:600}}>{e.evento}</span>
                      <span style={{color:TX}}>{e.detalhe}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap",paddingTop:14,borderTop:`1px solid ${BD}`}}>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {showDetalhe.status==='ativo'&&(
                  <>
                    <button onClick={()=>{setShowReajuste(showDetalhe);setPctReajuste(Number(showDetalhe.reajuste_percentual)||5);}} style={{padding:"8px 14px",borderRadius:8,background:Y+"15",color:Y,fontSize:11,fontWeight:600,border:`1px solid ${Y}40`,cursor:"pointer"}}>📈 Reajustar</button>
                    <button onClick={()=>encerrarContrato(showDetalhe)} style={{padding:"8px 14px",borderRadius:8,background:R+"15",color:R,fontSize:11,fontWeight:600,border:`1px solid ${R}40`,cursor:"pointer"}}>🏁 Encerrar</button>
                  </>
                )}
              </div>
              <button onClick={()=>setShowDetalhe(null)} style={{padding:"8px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Reajuste */}
      {showReajuste&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:110,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setShowReajuste(null)}>
          <div style={{background:BG2,borderRadius:16,padding:24,maxWidth:500,width:"100%"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:18,fontWeight:700,color:Y,marginBottom:8}}>📈 Aplicar Reajuste</div>
            <div style={{fontSize:12,color:TXM,marginBottom:16}}>{showReajuste.cliente_nome} · {showReajuste.nome}</div>
            
            <div style={{background:BG3,borderRadius:8,padding:12,marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <span style={{fontSize:11,color:TXD}}>Valor atual:</span>
                <span style={{fontSize:13,fontWeight:600,color:TX}}>{fmtR(showReajuste.valor_atual||showReajuste.valor_mensal)}</span>
              </div>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <span style={{fontSize:11,color:TXD}}>Novo valor (com reajuste):</span>
                <span style={{fontSize:15,fontWeight:700,color:G}}>{fmtR((Number(showReajuste.valor_atual||showReajuste.valor_mensal))*(1+pctReajuste/100))}</span>
              </div>
            </div>

            <div style={{marginBottom:16}}>
              <div style={{fontSize:10,color:TXD,marginBottom:3}}>Percentual de Reajuste (%)</div>
              <input type="number" step="0.01" value={pctReajuste||''} onChange={e=>setPctReajuste(parseFloat(e.target.value)||0)} style={inp}/>
              <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
                {[3,4,5,6,8,10].map(p=>(
                  <button key={p} onClick={()=>setPctReajuste(p)} style={{padding:"4px 10px",borderRadius:4,background:pctReajuste===p?Y+"20":BG3,color:pctReajuste===p?Y:TXM,border:`1px solid ${pctReajuste===p?Y:BD}`,fontSize:10,cursor:"pointer"}}>+{p}%</button>
                ))}
              </div>
            </div>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowReajuste(null)} disabled={processando} style={{padding:"10px 20px",borderRadius:8,background:"transparent",border:`1px solid ${BD}`,color:TX,fontSize:12,cursor:"pointer"}}>Cancelar</button>
              <button onClick={aplicarReajuste} disabled={processando||pctReajuste<=0} style={{padding:"10px 24px",borderRadius:8,background:Y,color:"#FFF",fontSize:13,fontWeight:600,border:"none",cursor:processando?"wait":"pointer",opacity:pctReajuste<=0?0.5:1}}>{processando?"⏳":"Aplicar"}</button>
            </div>
          </div>
        </div>
      )}

      <div style={{fontSize:9,color:TXD,textAlign:"center",marginTop:20}}>PS Gestão e Capital — Contratos Recorrentes v1.0 · MRR/Churn/LTV · Sprint 2.4</div>
    </div>
  );
}
