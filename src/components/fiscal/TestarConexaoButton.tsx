'use client'

import { useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { Loader2, Zap } from 'lucide-react'

export default function TestarConexaoButton({ companyId }: { companyId: string }) {
  const [testando, setTestando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; mensagem: string } | null>(null)

  async function testar() {
    setTestando(true)
    setResultado(null)
    try {
      const resp = await authFetch('/api/fiscal/testar-conexao', {
        method: 'POST',
        body: JSON.stringify({ companyId }),
      })
      const json = await resp.json()
      setResultado({
        ok: !!json.ok,
        mensagem: json.mensagem ?? (json.ok ? 'Conexão OK' : json.erro ?? 'Erro desconhecido'),
      })
    } catch (err) {
      setResultado({ ok: false, mensagem: err instanceof Error ? err.message : 'Erro' })
    } finally {
      setTestando(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        disabled={testando}
        onClick={testar}
        data-testid="testar-conexao"
        className="px-3 py-1.5 text-[12px] font-medium rounded-lg bg-[#3D2314] text-[#FAF7F2] hover:bg-[#5A3522] transition-colors disabled:opacity-50 flex items-center gap-1.5"
      >
        {testando ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
        Testar
      </button>
      {resultado && (
        <div className={`text-[11px] ${resultado.ok ? 'text-[#3F7012]' : 'text-[#C94544]'}`}>
          {resultado.mensagem}
        </div>
      )}
    </div>
  )
}
