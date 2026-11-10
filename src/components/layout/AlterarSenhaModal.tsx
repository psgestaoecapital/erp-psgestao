'use client'
// Chamado #7899 — "Alterar minha senha" no menu do usuário. Usa a autenticação já existente (Supabase Auth):
// confere a senha atual (signInWithPassword do próprio e-mail) e troca com updateUser. Nunca mostra nem define senha de outra pessoa.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function AlterarSenhaModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [conf, setConf] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  async function salvar(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!atual) { setMsg({ ok: false, t: 'Informe a senha atual.' }); return }
    if (nova.length < 8) { setMsg({ ok: false, t: 'A nova senha deve ter no mínimo 8 caracteres.' }); return }
    if (nova !== conf) { setMsg({ ok: false, t: 'A confirmação não é igual à nova senha.' }); return }
    if (nova === atual) { setMsg({ ok: false, t: 'A nova senha precisa ser diferente da atual.' }); return }
    setBusy(true)
    const { error: e1 } = await supabase.auth.signInWithPassword({ email, password: atual })
    if (e1) { setBusy(false); setMsg({ ok: false, t: 'A senha atual não confere. Se esqueceu, saia e use "Esqueci minha senha" na tela de login.' }); return }
    const { error: e2 } = await supabase.auth.updateUser({ password: nova })
    setBusy(false)
    if (e2) { setMsg({ ok: false, t: 'Não foi possível trocar a senha agora. Tente novamente em instantes.' }); return }
    setAtual(''); setNova(''); setConf('')
    setMsg({ ok: true, t: 'Senha alterada com sucesso.' })
  }

  const campo = 'w-full border border-[#3D2314]/20 rounded-lg px-3 py-2 text-[14px] text-[#3D2314]'
  return (
    <div role="dialog" aria-modal="true" aria-label="Alterar minha senha" data-testid="alterar-senha-modal"
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={salvar} data-ajuda="alterar-senha" onClick={(ev) => ev.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3">
        <h2 className="text-[16px] font-semibold text-[#3D2314]">Alterar minha senha</h2>
        <label className="block text-[12.5px] text-[#3D2314]/70">Senha atual
          <input type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} className={campo} />
        </label>
        <label className="block text-[12.5px] text-[#3D2314]/70">Nova senha (mínimo 8 caracteres)
          <input type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} className={campo} />
        </label>
        <label className="block text-[12.5px] text-[#3D2314]/70">Confirmar nova senha
          <input type="password" autoComplete="new-password" value={conf} onChange={(e) => setConf(e.target.value)} className={campo} />
        </label>
        {msg && <p role="status" className={`text-[13px] font-medium ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.t}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-[13px] font-medium text-[#3D2314]">Fechar</button>
          <button type="submit" disabled={busy} className="px-4 py-2 rounded-lg bg-[#C8941A] text-[#3D2314] text-[13px] font-semibold disabled:opacity-60">
            {busy ? 'Salvando…' : 'Salvar senha'}
          </button>
        </div>
      </form>
    </div>
  )
}
