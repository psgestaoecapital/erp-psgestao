import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export interface Escritorio {
  id: string
  nome: string
  plano: string
  max_clientes: number
}

export interface ContadorData {
  id: string
  escritorio_id: string
  nome: string
  admin: boolean
  escritorio: Escritorio
}

export function useContador() {
  const [contador, setContador] = useState<ContadorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function buscar() {
      try {
        const res = await fetch('/api/contador/escritorio')
        if (!res.ok) throw new Error('Não encontrado')
        const json = await res.json()
        if (json.contador) setContador(json.contador)
      } catch (e: any) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    }
    buscar()
  }, [])

  return { contador, loading, error, isContador: !!contador }
}
