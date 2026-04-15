'use client'
import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

const C = {bg:'#0F0F0F',card:'#1A1410',card2:'#1E1E1B',border:'#2A2822',gold:'#C8941A',goldL:'#E8C872',text:'#FAF7F2',muted:'#B0AB9F',dim:'#918C82',green:'#22C55E',red:'#EF4444',blue:'#3B82F6',yellow:'#F59E0B',purple:'#8B5CF6'}

type Lancamento = {
  id?: string; data_emissao: string; data_vencimento: string; data_previsao: string;
  data_pagamento?: string; status_titulo: string; valor_documento: number;
  numero_documento?: string; observacao?: string; codigo_categoria?: string;
  descricao_categoria?: string; nome_fornecedor?: string; nome_cliente?: string;
  codigo_cliente_fornecedor?: string; distribuicao?: any[];
}

const STATUS_COLORS: Record<string,string> = {PAGO:C.green,RECEBIDO:C.green,'A VENCER':C.yellow,VENCIDO:C.red,CANCELADO:C.dim}
const fmtVal = (v:number) => `R$ ${v.toLocaleString('pt-BR',{minimumFractionDigits:2})}`
const fmtDate = (d:string) => {if(!d)return'—';const p=d.split('/');return p.length===3?`${p[0]}/${p[1]}`:d}
const today = () => {const d=new Date();return`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`}

export default function OperacionalPage() {
  const [empresas,setEmpresas] = useState<any[]>([])
  const [sel,setSel] = useState('')
  const [tab,setTab] = useState<'receber'|'pagar'>('receber')
  const [items,setItems] = useState<Lancamento[]>([])
  const [loading,setLoading] = useState(true)
  const [showForm,setShowForm] = useState(false)
  const [editing,setEditing] = useState<Lancamento|null>(null)
  const [saving,setSaving] = useState(false)
  const [msg,setMsg] = useState('')
  const [filtro,setFiltro] = useState('')
  const [filtroStatus,setFiltroStatus] = useState('')
  const [form,setForm] = useState<Lancamento>({
    data_emissao:today(), data_vencimento:today(), data_previsao:today(),
    status_titulo:'A VENCER', valor_documento:0, observacao:'', codigo_categoria:'',
    descricao_categoria:'', nome_fornecedor:'', nome_cliente:'', numero_documento:''
  })

  // Load companies
  useEffect(() => {
    (async () => {
      const {data:{user}} = await supabase.auth.getUser()
      if(!user) return
      const {data:up} = await supabase.from('users').select('role').eq('id',user.id).single()
      let comps:any[] = []
      if(up?.role==='adm'||up?.role==='acesso_total'||up?.role==='adm_investimentos') {
        const {data} = await supabase.from('companies').select('id,nome_fantasia,razao_social').order('nome_fantasia')
        comps = data||[]
      } else {
        const {data:uc} = await supabase.from('user_companies').select('companies(id,nome_fantasia,razao_social)').eq('user_id',user.id)
        comps = (uc||[]).map((u:any)=>u.companies).filter(Boolean)
      }
      setEmpresas(comps)
      if(comps.length>0) setSel(comps[0].id)
      setLoading(false)
    })()
  }, [])

  // Load data when company or tab changes
  const loadData = useCallback(async () => {
    if(!sel) return
    setLoading(true)
    const importType = tab === 'pagar' ? 'contas_pagar' : 'contas_receber'
    const {data} = await supabase.from('omie_imports')
      .select('import_data')
      .eq('company_id', sel)
      .eq('import_type', importType)
      .order('imported_at', {ascending:false})

    const all:Lancamento[] = []
    if(data) {
      for(const imp of data) {
        const key = tab === 'pagar' ? 'conta_pagar_cadastro' : 'conta_receber_cadastro'
        const regs = imp.import_data?.[key] || []
        if(Array.isArray(regs)) {
          regs.forEach((r:any,i:number) => {
            all.push({
              id: `${imp.import_data?.manual_id || 'imp'}_${i}`,
              data_emissao: r.data_emissao||'',
              data_vencimento: r.data_vencimento||'',
              data_previsao: r.data_previsao||r.data_vencimento||'',
              data_pagamento: r.data_pagamento||r.data_baixa||'',
              status_titulo: r.status_titulo||'A VENCER',
              valor_documento: Number(r.valor_documento)||0,
              numero_documento: r.numero_documento||'',
              observacao: r.observacao||'',
              codigo_categoria: r.codigo_categoria||'',
              descricao_categoria: r.descricao_categoria||'',
              nome_fornecedor: r.nome_fornecedor||'',
              nome_cliente: r.nome_cliente||'',
              codigo_cliente_fornecedor: r.codigo_cliente_fornecedor||'',
            })
          })
        }
      }
    }

    // Also load from erp tables if they exist
    const erpTable = tab === 'pagar' ? 'erp_pagar' : 'erp_receber'
    try {
      const {data:erpData} = await supabase.from(erpTable).select('*').eq('company_id',sel).order('created_at',{ascending:false})
      if(erpData) {
        erpData.forEach((r:any) => {
          all.push({
            id: r.id,
            data_emissao: r.data_emissao||'',
            data_vencimento: r.data_vencimento||'',
            data_previsao: r.data_previsao||r.data_vencimento||'',
            data_pagamento: r.data_pagamento||'',
            status_titulo: r.status_titulo||'A VENCER',
            valor_documento: Number(r.valor_documento)||0,
            numero_documento: r.numero_documento||'',
            observacao: r.observacao||'',
            codigo_categoria: r.codigo_categoria||'',
            descricao_categoria: r.descricao_categoria||'',
            nome_fornecedor: r.nome_fornecedor||'',
            nome_cliente: r.nome_cliente||'',
          })
        })
      }
    } catch {}

    // Sort by date desc
    all.sort((a,b) => {
      const da = (a.data_vencimento||'').split('/').reverse().join('')
      const db = (b.data_vencimento||'').split('/').reverse().join('')
      return db.localeCompare(da)
    })

    setItems(all)
    setLoading(false)
  }, [sel, tab])

  useEffect(() => { loadData() }, [loadData])

  // Save new record
  const handleSave = async () => {
    if(!sel || form.valor_documento <= 0) {
      setMsg('Preencha pelo menos o valor e a data de vencimento')
      return
    }
    setSaving(true)

    const importType = tab === 'pagar' ? 'contas_pagar' : 'contas_receber'
    const key = tab === 'pagar' ? 'conta_pagar_cadastro' : 'conta_receber_cadastro'

    const registro:any = {
      data_emissao: form.data_emissao || form.data_vencimento,
      data_vencimento: form.data_vencimento,
      data_previsao: form.data_previsao || form.data_vencimento,
      status_titulo: form.status_titulo,
      valor_documento: form.valor_documento,
      numero_documento: form.numero_documento || '',
      observacao: form.observacao || '',
      codigo_categoria: form.codigo_categoria || '',
      descricao_categoria: form.descricao_categoria || '',
      codigo_cliente_fornecedor: form.numero_documento || '',
    }

    if(tab === 'pagar') {
      registro.nome_fornecedor = form.nome_fornecedor || ''
      if(form.status_titulo === 'PAGO' && form.data_pagamento) {
        registro.data_pagamento = form.data_pagamento
        registro.data_baixa = form.data_pagamento
      }
    } else {
      registro.nome_cliente = form.nome_cliente || ''
      if(form.status_titulo === 'RECEBIDO' && form.data_pagamento) {
        registro.data_pagamento = form.data_pagamento
        registro.data_baixa = form.data_pagamento
      }
    }

    const wrapper = { [key]: [registro], manual_id: 'manual_' + Date.now(), importado_em: new Date().toISOString() }

    const {error} = await supabase.from('omie_imports').insert({
      company_id: sel,
      import_type: importType,
      import_data: wrapper,
      record_count: 1,
    })

    if(error) {
      setMsg('Erro: ' + error.message)
    } else {
      setMsg(tab === 'pagar' ? '✅ Conta a pagar cadastrada!' : '✅ Conta a receber cadastrada!')
      setShowForm(false)
      resetForm()
      await loadData()
    }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const resetForm = () => {
    setForm({
      data_emissao:today(), data_vencimento:today(), data_previsao:today(),
      status_titulo:'A VENCER', valor_documento:0, observacao:'', codigo_categoria:'',
      descricao_categoria:'', nome_fornecedor:'', nome_cliente:'', numero_documento:''
    })
    setEditing(null)
  }

  // Filter items
  const filtered = items.filter(item => {
    const searchStr = `${item.observacao} ${item.nome_fornecedor} ${item.nome_cliente} ${item.descricao_categoria} ${item.numero_documento}`.toLowerCase()
    const matchSearch = !filtro || searchStr.includes(filtro.toLowerCase())
    const matchStatus = !filtroStatus || item.status_titulo === filtroStatus
    return matchSearch && matchStatus
  })

  // Totals
  const totalValor = filtered.reduce((s,i) => s + i.valor_documento, 0)
  const totalPago = filtered.filter(i => i.status_titulo === 'PAGO' || i.status_titulo === 'RECEBIDO').reduce((s,i) => s + i.valor_documento, 0)
  const totalPendente = filtered.filter(i => i.status_titulo === 'A VENCER').reduce((s,i) => s + i.valor_documento, 0)
  const totalVencido = filtered.filter(i => i.status_titulo === 'VENCIDO').reduce((s,i) => s + i.valor_documento, 0)

  const inp:React.CSSProperties = {background:C.card2,border:`1px solid ${C.border}`,color:C.text,borderRadius:6,padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'Arial'}
  const selStyle:React.CSSProperties = {...inp,cursor:'pointer'}

  const empresaNome = empresas.find(e=>e.id===sel)?.nome_fantasia || empresas.find(e=>e.id===sel)?.razao_social || ''

  return (
    <div style={{padding:16,minHeight:'100vh',background:C.bg,color:C.text}}>
      {/* HEADER */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
        <div>
          <div style={{fontSize:20,fontWeight:700,color:C.gold}}>PS Gestão — Operacional</div>
          <div style={{fontSize:10,color:C.dim}}>Contas a Pagar · Contas a Receber · Cadastros · Integrado com Dashboard e BPO</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <select value={sel} onChange={e=>setSel(e.target.value)} style={{...selStyle,minWidth:200,fontWeight:600,color:C.goldL}}>
            {empresas.map(e=><option key={e.id} value={e.id}>{e.nome_fantasia||e.razao_social}</option>)}
          </select>
          <a href="/dashboard" style={{padding:'6px 14px',border:`1px solid ${C.border}`,borderRadius:8,color:C.text,fontSize:11,textDecoration:'none'}}>← Dashboard</a>
        </div>
      </div>

      {msg && <div style={{background:msg.includes('Erro')?C.red+'20':C.green+'20',border:`1px solid ${msg.includes('Erro')?C.red:C.green}`,borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:msg.includes('Erro')?C.red:C.green}} onClick={()=>setMsg('')}>{msg}</div>}

      {/* TABS */}
      <div style={{display:'flex',gap:4,marginBottom:16}}>
        {([
          {id:'receber' as const, label:'📥 Contas a Receber', color:C.green},
          {id:'pagar' as const, label:'📤 Contas a Pagar', color:C.red},
        ]).map(t => (
          <button key={t.id} onClick={()=>{setTab(t.id);setShowForm(false);setFiltro('');setFiltroStatus('')}} style={{
            padding:'10px 20px',borderRadius:8,fontSize:13,fontWeight:tab===t.id?700:400,cursor:'pointer',
            border:tab===t.id?`2px solid ${t.color}`:`1px solid ${C.border}`,
            background:tab===t.id?t.color+'15':'transparent',
            color:tab===t.id?t.color:C.muted
          }}>{t.label}</button>
        ))}
      </div>

      {/* KPIs */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:8,marginBottom:16}}>
        {[
          {l:'Total',v:fmtVal(totalValor),c:tab==='receber'?C.green:C.red,icon:'📊'},
          {l:tab==='receber'?'Recebido':'Pago',v:fmtVal(totalPago),c:C.green,icon:'✅'},
          {l:'Pendente',v:fmtVal(totalPendente),c:C.yellow,icon:'⏳'},
          {l:'Vencido',v:fmtVal(totalVencido),c:C.red,icon:'🚨'},
          {l:'Registros',v:String(filtered.length),c:C.gold,icon:'📋'},
        ].map((k,i) => (
          <div key={i} style={{background:`linear-gradient(135deg,${C.card},${C.card2})`,borderRadius:10,padding:10,border:`1px solid ${C.border}`,borderLeft:`4px solid ${k.c}`}}>
            <div style={{fontSize:8,color:C.dim,textTransform:'uppercase'}}>{k.icon} {k.l}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.c,marginTop:2}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* TOOLBAR */}
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>{resetForm();setShowForm(!showForm)}} style={{
          padding:'10px 20px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',
          background:tab==='receber'?`linear-gradient(135deg,${C.green},#10B981)`:`linear-gradient(135deg,${C.red},#DC2626)`,
          color:C.text
        }}>
          + {tab==='receber'?'Nova Conta a Receber':'Nova Conta a Pagar'}
        </button>
        <input value={filtro} onChange={e=>setFiltro(e.target.value)} placeholder="🔍 Buscar por descrição, fornecedor, categoria..." style={{...inp,flex:1,minWidth:200}}/>
        <select value={filtroStatus} onChange={e=>setFiltroStatus(e.target.value)} style={{...selStyle,width:'auto'}}>
          <option value="">Todos os status</option>
          <option value="A VENCER">A Vencer</option>
          <option value={tab==='receber'?'RECEBIDO':'PAGO'}>{tab==='receber'?'Recebido':'Pago'}</option>
          <option value="VENCIDO">Vencido</option>
          <option value="CANCELADO">Cancelado</option>
        </select>
      </div>

      {/* FORM */}
      {showForm && (
        <div style={{background:C.card,borderRadius:12,padding:20,marginBottom:16,border:`1px solid ${tab==='receber'?C.green:C.red}40`}}>
          <div style={{fontSize:15,fontWeight:700,color:tab==='receber'?C.green:C.red,marginBottom:14}}>
            {editing ? 'Editar' : 'Novo'} — {tab==='receber'?'Conta a Receber':'Conta a Pagar'}
            <span style={{fontSize:11,color:C.dim,marginLeft:8}}>{empresaNome}</span>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
            {/* Nome */}
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>{tab==='receber'?'CLIENTE *':'FORNECEDOR *'}</div>
              <input value={tab==='receber'?form.nome_cliente:form.nome_fornecedor}
                onChange={e=>tab==='receber'?setForm({...form,nome_cliente:e.target.value}):setForm({...form,nome_fornecedor:e.target.value})}
                placeholder={tab==='receber'?'Nome do cliente':'Nome do fornecedor'} style={inp}/>
            </div>

            {/* Valor */}
            <div>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>VALOR (R$) *</div>
              <input type="number" step="0.01" value={form.valor_documento||''} onChange={e=>setForm({...form,valor_documento:parseFloat(e.target.value)||0})}
                placeholder="0,00" style={{...inp,fontSize:16,fontWeight:700,color:tab==='receber'?C.green:C.red}}/>
            </div>

            {/* Emissão */}
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>DATA EMISSÃO</div>
              <input value={form.data_emissao} onChange={e=>setForm({...form,data_emissao:e.target.value})} placeholder="DD/MM/AAAA" style={inp}/>
            </div>

            {/* Vencimento */}
            <div>
              <div style={{fontSize:10,color:C.gold,marginBottom:3,fontWeight:600}}>DATA VENCIMENTO *</div>
              <input value={form.data_vencimento} onChange={e=>setForm({...form,data_vencimento:e.target.value,data_previsao:e.target.value})} placeholder="DD/MM/AAAA" style={inp}/>
            </div>

            {/* Status */}
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>SITUAÇÃO</div>
              <select value={form.status_titulo} onChange={e=>setForm({...form,status_titulo:e.target.value})} style={selStyle}>
                <option value="A VENCER">A Vencer</option>
                <option value={tab==='receber'?'RECEBIDO':'PAGO'}>{tab==='receber'?'Recebido':'Pago'}</option>
                <option value="VENCIDO">Vencido</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </div>

            {/* Data Pagamento */}
            {(form.status_titulo==='PAGO'||form.status_titulo==='RECEBIDO') && (
              <div>
                <div style={{fontSize:10,color:C.green,marginBottom:3,fontWeight:600}}>DATA PAGAMENTO</div>
                <input value={form.data_pagamento||''} onChange={e=>setForm({...form,data_pagamento:e.target.value})} placeholder="DD/MM/AAAA" style={inp}/>
              </div>
            )}

            {/* Categoria */}
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>CATEGORIA</div>
              <input value={form.descricao_categoria||''} onChange={e=>{
                const val = e.target.value
                const parts = val.split(' > ')
                setForm({...form, descricao_categoria:val, codigo_categoria:parts[0]?.trim()||val})
              }} placeholder="Ex: DESPESAS ADMINISTRATIVAS > Aluguel" style={inp}/>
              <div style={{fontSize:9,color:C.dim,marginTop:2}}>Use &gt; para subcategoria</div>
            </div>

            {/* Descrição */}
            <div style={{gridColumn:'span 2'}}>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>DESCRIÇÃO / OBSERVAÇÃO</div>
              <input value={form.observacao||''} onChange={e=>setForm({...form,observacao:e.target.value})} placeholder="Descrição do lançamento" style={inp}/>
            </div>

            {/* Documento */}
            <div>
              <div style={{fontSize:10,color:C.muted,marginBottom:3}}>Nº DOCUMENTO</div>
              <input value={form.numero_documento||''} onChange={e=>setForm({...form,numero_documento:e.target.value})} placeholder="NF, boleto, etc." style={inp}/>
            </div>
          </div>

          {/* Buttons */}
          <div style={{display:'flex',gap:8,marginTop:16}}>
            <button onClick={handleSave} disabled={saving} style={{
              padding:'10px 24px',borderRadius:8,fontWeight:700,fontSize:13,cursor:'pointer',border:'none',
              background:saving?C.border:`linear-gradient(135deg,${C.gold},${C.goldL})`,color:C.bg,
            }}>
              {saving?'⏳ Salvando...':'💾 Salvar'}
            </button>
            <button onClick={()=>{setShowForm(false);resetForm()}} style={{padding:'10px 16px',borderRadius:8,fontSize:12,cursor:'pointer',border:`1px solid ${C.border}`,background:'transparent',color:C.text}}>Cancelar</button>
          </div>
        </div>
      )}

      {/* LIST */}
      <div style={{background:C.card,borderRadius:12,border:`1px solid ${C.border}`,overflow:'auto'}}>
        {loading ? (
          <div style={{padding:40,textAlign:'center',color:C.gold}}>⏳ Carregando...</div>
        ) : filtered.length === 0 ? (
          <div style={{padding:40,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:8}}>{tab==='receber'?'📥':'📤'}</div>
            <div style={{fontSize:14,color:C.gold,fontWeight:600}}>Nenhum registro encontrado</div>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>Clique no botão acima para adicionar {tab==='receber'?'uma conta a receber':'uma conta a pagar'}</div>
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:800}}>
            <thead>
              <tr style={{borderBottom:`2px solid ${C.gold}40`}}>
                {['Status','Vencimento',tab==='receber'?'Cliente':'Fornecedor','Descrição','Categoria','Documento','Valor'].map(h => (
                  <th key={h} style={{padding:'10px 8px',textAlign:h==='Valor'?'right':'left',color:C.gold,fontSize:9,fontWeight:600,position:'sticky',top:0,background:C.card}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item,i) => {
                const statusColor = STATUS_COLORS[item.status_titulo] || C.dim
                const nome = tab==='receber' ? (item.nome_cliente||'—') : (item.nome_fornecedor||'—')
                return (
                  <tr key={i} style={{borderBottom:`0.5px solid ${C.border}30`,cursor:'pointer'}}
                    onMouseEnter={e=>e.currentTarget.style.background=C.card2}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <td style={{padding:'8px'}}>
                      <span style={{fontSize:9,padding:'2px 8px',borderRadius:4,fontWeight:600,background:statusColor+'18',color:statusColor}}>
                        {item.status_titulo}
                      </span>
                    </td>
                    <td style={{padding:'8px',color:C.text,fontWeight:500,whiteSpace:'nowrap'}}>{item.data_vencimento||'—'}</td>
                    <td style={{padding:'8px',color:C.text,fontWeight:500,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{nome}</td>
                    <td style={{padding:'8px',color:C.muted,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.observacao||'—'}</td>
                    <td style={{padding:'8px',fontSize:9}}>
                      {item.descricao_categoria ? (
                        <span style={{padding:'2px 6px',borderRadius:4,background:C.purple+'15',color:C.purple}}>{item.descricao_categoria}</span>
                      ) : <span style={{color:C.dim}}>—</span>}
                    </td>
                    <td style={{padding:'8px',color:C.dim,fontSize:10}}>{item.numero_documento||'—'}</td>
                    <td style={{padding:'8px',textAlign:'right',fontWeight:700,fontSize:13,color:tab==='receber'?C.green:C.red,whiteSpace:'nowrap'}}>{fmtVal(item.valor_documento)}</td>
                  </tr>
                )
              })}
              {/* TOTAL ROW */}
              <tr style={{borderTop:`2px solid ${C.gold}`,background:C.gold+'08'}}>
                <td colSpan={6} style={{padding:'10px 8px',fontWeight:700,color:C.gold,fontSize:12}}>TOTAL ({filtered.length} registros)</td>
                <td style={{padding:'10px 8px',textAlign:'right',fontWeight:700,fontSize:15,color:tab==='receber'?C.green:C.red}}>{fmtVal(totalValor)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div style={{fontSize:9,color:C.dim,textAlign:'center',marginTop:16}}>
        PS Gestão e Capital — Operacional v8.8.0 | Dados integrados com Dashboard, BPO e Custeio por Absorção
      </div>
    </div>
  )
}
