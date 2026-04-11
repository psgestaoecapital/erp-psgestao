'use client'
import React, { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function RegistrarContadorPage() {
  const router = useRouter()
  const [form, setForm] = useState({ nome:'', cnpj:'', responsavel:'', email:'', telefone:'', crc_uf:'' })
  const [loading, setLoading] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')

  const set = (k: string, v: string) => setForm(f => ({...f,[k]:v}))

  async function registrar() {
    if (!form.nome || !form.email) { setError('Nome e email são obrigatórios'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/contador/escritorio', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Erro ao registrar')
      setApiKey(data.api_key)
    } catch(e:any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (apiKey) return (
    <div className='p-6 max-w-lg mx-auto'>
      <h1 className='text-xl font-bold mb-2'>Escritório registrado!</h1>
      <div className='bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4'>
        <p className='text-sm font-bold text-amber-800 mb-2'>⚠ Guarde sua API Key agora — não será exibida novamente:</p>
        <code className='text-xs break-all bg-white p-2 rounded block border'>{apiKey}</code>
      </div>
      <button onClick={() => router.push('/dashboard/contador')}
        className='bg-primary text-primary-foreground px-4 py-2 rounded text-sm font-medium'>
        Ir para o Módulo Contador →
      </button>
    </div>
  )

  return (
    <div className='p-6 max-w-lg mx-auto'>
      <h1 className='text-xl font-bold mb-1'>Registrar Escritório Contábil</h1>
      <p className='text-sm text-muted-foreground mb-6'>
        Conecte seu escritório para acessar dados dos clientes em tempo real.
      </p>
      {error && <div className='bg-red-50 border border-red-300 rounded p-3 text-sm text-red-800 mb-4'>{error}</div>}
      <div className='space-y-3'>
        {[
          ['nome','Nome do Escritório','text',true],
          ['email','Email','email',true],
          ['cnpj','CNPJ','text',false],
          ['responsavel','CRC Responsável','text',false],
          ['crc_uf','UF do CRC','text',false],
          ['telefone','Telefone','tel',false],
        ].map(([k,l,t,req]:any) => (
          <div key={k}>
            <label className='text-xs text-muted-foreground uppercase tracking-wide'>{l}{req?' *':''}</label>
            <input type={t} value={(form as any)[k]} onChange={e=>set(k,e.target.value)}
              className='w-full border rounded px-3 py-2 text-sm mt-1' placeholder={l}/>
          </div>
        ))}
      </div>
      <button onClick={registrar} disabled={loading}
        className='mt-6 w-full bg-primary text-primary-foreground py-2 rounded text-sm font-medium disabled:opacity-50'>
        {loading ? 'Registrando...' : 'Registrar Escritório →'}
      </button>
    </div>
  )
}
