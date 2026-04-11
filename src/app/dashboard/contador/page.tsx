'use client'
import React, { useState, useEffect } from 'react'
import { useContador } from '@/hooks/useContador'

interface EmpresaResumida {
  id: string
  razao_social: string
  nome_fantasia?: string
  fiscal?: { receita_bruta: number; carga_efetiva: number } | null
}

export default function ContadorPage() {
  const { contador, loading } = useContador()
  const [empresas, setEmpresas] = useState<EmpresaResumida[]>([])
  const [apiKey, setApiKey] = useState('')
  const [loadingEmpresas, setLoadingEmpresas] = useState(false)
  const [tab, setTab] = useState<'empresas'|'calendario'|'fiscal'|'config'>('empresas')

  const brl = (v: number) => 'R$ ' + (v||0).toLocaleString('pt-BR',{maximumFractionDigits:0})

  useEffect(() => {
    if (!contador) return
    setLoadingEmpresas(true)
    fetch('/api/contador/clientes')
      .then(r => r.json())
      .then(d => setEmpresas((d.clientes||[]).map((c:any)=>({ ...c.companies, id:c.company_id, fiscal:null }))))
      .finally(() => setLoadingEmpresas(false))
  }, [contador])

  if (loading) return <div className='p-6 text-sm text-muted-foreground'>Carregando módulo contador...</div>

  if (!contador) return (
    <div className='p-6 max-w-xl mx-auto'>
      <h1 className='text-xl font-bold mb-2'>Módulo Contador</h1>
      <p className='text-sm text-muted-foreground mb-6'>
        Conecte seu escritório contábil ao PS Gestão para acessar dados dos clientes
        em tempo real, gerar SPED e simular o impacto da Reforma Tributária.
      </p>
      <a href='/dashboard/contador/registrar'
         className='inline-block bg-primary text-primary-foreground px-6 py-2 rounded-lg text-sm font-medium'>
        Registrar Escritório →
      </a>
    </div>
  )

  return (
    <div className='p-6 space-y-6 max-w-7xl mx-auto'>
      <div className='flex items-center justify-between'>
        <div>
          <h1 className='text-2xl font-bold'>Módulo Contador</h1>
          <p className='text-sm text-muted-foreground mt-0.5'>
            {contador.escritorio?.nome}  ·  Plano {contador.escritorio?.plano}
            ·  {empresas.length} empresa(s) vinculada(s)
          </p>
        </div>
        <div className='flex gap-2'>
          <a href='/dashboard/contador/api-keys'
             className='text-sm border rounded px-3 py-1.5 hover:bg-muted'>
            🔑 API Keys
          </a>
          <a href='/dashboard/contador/vincular'
             className='text-sm border rounded px-3 py-1.5 hover:bg-muted'>
            + Vincular Empresa
          </a>
        </div>
      </div>

      <div className='flex gap-2 border-b pb-0'>
        {([['empresas','Empresas'],['calendario','Calendário Fiscal'],['fiscal','Reforma Tributária'],['config','Configuração']] as const).map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={'px-4 py-2 text-sm font-medium border-b-2 -mb-px ' +
              (tab===key ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'empresas' && (
        <div>
          {loadingEmpresas && <p className='text-sm text-muted-foreground'>Carregando empresas...</p>}
          {!loadingEmpresas && empresas.length === 0 && (
            <div className='border-2 border-dashed rounded-xl p-10 text-center'>
              <p className='text-sm text-muted-foreground mb-3'>Nenhuma empresa vinculada ainda.</p>
              <a href='/dashboard/contador/vincular'
                 className='inline-block bg-primary text-primary-foreground px-5 py-2 rounded text-sm'>
                Vincular primeira empresa →
              </a>
            </div>
          )}
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
            {empresas.map(emp => (
              <div key={emp.id} className='bg-card border rounded-xl p-4 space-y-2'>
                <p className='font-semibold text-sm truncate'>{emp.razao_social}</p>
                {emp.nome_fantasia && emp.nome_fantasia !== emp.razao_social && (
                  <p className='text-xs text-muted-foreground truncate'>{emp.nome_fantasia}</p>
                )}
                <div className='flex gap-2 pt-1'>
                  <a href={'/dashboard/contador/empresa/'+emp.id}
                     className='text-xs border rounded px-2 py-1 hover:bg-muted'>
                    Ver DRE
                  </a>
                  <a href={'/dashboard/contador/empresa/'+emp.id+'/reforma'}
                     className='text-xs border rounded px-2 py-1 hover:bg-muted'>
                    Reforma Trib.
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'fiscal' && (
        <div className='bg-card border rounded-xl p-6'>
          <h2 className='font-bold text-lg mb-2'>Reforma Tributária 2026</h2>
          <p className='text-sm text-muted-foreground mb-4'>
            2026 é o ano de testes — IBS+CBS devem ser destacados nas NF-e mas sem cobrança efetiva.
          </p>
          <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
            {[
              {a:'CBS 2026','v':'0,9%','desc':'Substitui PIS+COFINS','cor':'text-amber-600'},
              {a:'IBS 2026','v':'0,1%','desc':'Substitui ICMS+ISS (início)','cor':'text-amber-600'},
              {a:'Split Pay.','v':'2028','desc':'Obrigatório progressivo','cor':'text-blue-600'},
            ].map((item:any,i) => (
              <div key={i} className='bg-muted/50 rounded-lg p-4'>
                <p className={'text-2xl font-bold '+item.cor}>{item.v}</p>
                <p className='font-medium text-sm mt-1'>{item.a}</p>
                <p className='text-xs text-muted-foreground'>{item.desc}</p>
              </div>
            ))}
          </div>
          <div className='mt-4'>
            <p className='text-sm font-medium mb-2'>Para cada empresa, acesse o simulador completo:</p>
            <div className='flex flex-wrap gap-2'>
              {empresas.slice(0,6).map(emp => (
                <a key={emp.id} href={'/dashboard/contador/empresa/'+emp.id+'/reforma'}
                   className='text-xs border rounded px-3 py-1.5 hover:bg-muted truncate max-w-48'>
                  {emp.nome_fantasia || emp.razao_social}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'config' && (
        <div className='bg-card border rounded-xl p-6 max-w-lg'>
          <h2 className='font-bold text-lg mb-4'>Configuração do Escritório</h2>
          <div className='space-y-3 text-sm'>
            <div className='flex justify-between'><span className='text-muted-foreground'>Escritório</span><span className='font-medium'>{contador.escritorio?.nome}</span></div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Plano</span><span className='font-medium capitalize'>{contador.escritorio?.plano}</span></div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Empresas</span><span className='font-medium'>{empresas.length} / {contador.escritorio?.max_clientes}</span></div>
            <div className='flex justify-between'><span className='text-muted-foreground'>Responsável</span><span className='font-medium'>{contador.nome}</span></div>
          </div>
          <div className='mt-4 pt-4 border-t'>
            <a href='/dashboard/contador/api-keys' className='text-sm text-primary hover:underline'>
              Gerenciar API Keys →
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
