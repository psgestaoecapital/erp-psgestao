'use client'
// Configurações › Aparência (CEO 10/10) — cada usuário escolhe a cor de destaque (preset curado) e o modo
// (claro/escuro/automático). Prévia AO VIVO: aplicar reflete no painel inteiro na hora. Só o visual muda; o semáforo
// e os documentos da marca NÃO mudam (avisado com "?"). Mobile-first, premium (RD-96, sem emoji de IA).
import { useEffect, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useUsuario } from '@/lib/AuthProvider'
import { AjudaCampo } from '@/components/ajuda/AjudaCampo'
import { aplicarTema } from '@/theme/aplicar-tema'
import { MODOS, MODO_DEFAULT, type ModoTema, TEMA_DEFAULT, TEMA_PRESETS, presetPorId } from '@/theme/theme-presets'

export default function AparenciaPage() {
  const { userId } = useUsuario()
  const [tema, setTema] = useState(TEMA_DEFAULT)
  const [modo, setModo] = useState<ModoTema>(MODO_DEFAULT)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [sujo, setSujo] = useState(false)
  const [salvo, setSalvo] = useState(false)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data } = await supabase.from('erp_usuario_preferencia').select('tema, modo').maybeSingle()
        if (vivo && data) { setTema(data.tema ?? TEMA_DEFAULT); setModo((data.modo as ModoTema) ?? MODO_DEFAULT) }
      } catch { /* sem preferência → default */ } finally { if (vivo) setCarregando(false) }
    })()
    return () => { vivo = false }
  }, [])

  const escolherTema = (id: string) => { setTema(id); setSujo(true); setSalvo(false); aplicarTema(id, modo) }
  const escolherModo = (m: ModoTema) => { setModo(m); setSujo(true); setSalvo(false); aplicarTema(tema, m) }

  async function salvar() {
    if (!userId || salvando) return
    setSalvando(true)
    try {
      const { error } = await supabase.from('erp_usuario_preferencia')
        .upsert({ user_id: userId, tema, modo, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' })
      if (!error) { setSujo(false); setSalvo(true) }
    } finally { setSalvando(false) }
  }

  const rot = 'text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)] flex items-center gap-1.5'
  const atual = presetPorId(tema)

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-[var(--gold)]">
          <Palette size={18} />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Aparência</h1>
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Deixe o painel com a sua cara. É só para você — não muda nada para os outros nem para a empresa.
        </p>
      </header>

      {/* Cor de destaque */}
      <section className="mb-7">
        <div className={rot}>Cor de destaque<AjudaCampo chave="configuracoes.aparencia.tema" /></div>
        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {TEMA_PRESETS.map((p) => {
            const sel = p.id === tema
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => escolherTema(p.id)}
                aria-pressed={sel}
                className={`flex items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors ${sel ? 'border-[var(--gold)] bg-[var(--gold-subtle)]' : 'border-[var(--border)] hover:border-[var(--border-light)]'}`}
              >
                <span
                  className="h-6 w-6 shrink-0 rounded-full ring-1 ring-black/10"
                  style={{ background: `linear-gradient(135deg, ${p.dia} 0 50%, ${p.noite} 50% 100%)` }}
                  aria-hidden
                />
                <span className="flex-1 text-sm text-[var(--text-primary)]">{p.nome}</span>
                {sel && <Check size={15} className="text-[var(--gold)]" />}
              </button>
            )
          })}
        </div>
      </section>

      {/* Modo */}
      <section className="mb-7">
        <div className={rot}>Claro / Escuro / Automático<AjudaCampo chave="configuracoes.aparencia.modo" /></div>
        <div className="mt-3 inline-flex rounded-[var(--radius-md)] border border-[var(--border)] p-1">
          {MODOS.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => escolherModo(m.id)}
              aria-pressed={modo === m.id}
              className={`rounded-[var(--radius-sm)] px-3.5 py-1.5 text-sm transition-colors ${modo === m.id ? 'bg-[var(--gold)] text-[var(--bg-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              {m.nome}
            </button>
          ))}
        </div>
      </section>

      {/* Prévia ao vivo */}
      <section className="mb-7 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">Prévia</div>
        <div className="flex items-center gap-2">
          <Palette size={16} className="text-[var(--gold)]" />
          <span className="font-semibold text-[var(--gold)]">{atual.nome}</span>
        </div>
        {/* mini gráfico: séries na cor de destaque */}
        <div className="mt-3 flex h-16 items-end gap-1.5">
          {[40, 70, 55, 90, 65].map((h, i) => (
            <span key={i} className="w-6 rounded-t bg-[var(--gold)]" style={{ height: `${h}%`, opacity: 0.55 + i * 0.09 }} />
          ))}
        </div>
        {/* semáforo FIXO — não muda com o tema */}
        <div className="mt-4 flex items-center gap-3">
          <span className={rot}>Status<AjudaCampo chave="configuracoes.aparencia.semaforo" /></span>
          <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--green)]" /> ok</span>
          <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--yellow)]" /> atenção</span>
          <span className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--red)]" /> problema</span>
        </div>
        {/* documento: sempre na marca PS */}
        <div className="mt-4 flex items-center gap-2">
          <span className={rot}>Documentos<AjudaCampo chave="configuracoes.aparencia.documentos" /></span>
          <span className="rounded px-2 py-0.5 text-xs font-medium" style={{ background: '#C6973F', color: '#1A120B' }}>Marca PS (fixo)</span>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={!sujo || salvando || carregando || !userId}
          className="rounded-[var(--radius-md)] bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--bg-primary)] transition-opacity disabled:opacity-40"
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        {salvo && <span className="inline-flex items-center gap-1 text-sm text-[var(--green)]"><Check size={15} /> Salvo</span>}
        {sujo && !salvo && <span className="text-sm text-[var(--text-muted)]">Prévia aplicada — salve para manter.</span>}
      </div>
    </div>
  )
}
