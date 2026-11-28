'use client'

// IBPT por empresa (CEO 28/09) · Configurações › Fiscal › "Tributos aproximados (IBPT · Lei 12.741)".
// A empresa cadastra o SEU token da API "De Olho no Imposto". "Salvar e testar" faz uma consulta real ao IBPT (pelo
// servidor) e só guarda se o IBPT aceitar. Depois de salvo, a tela mostra só "Token configurado em DD/MM" — o token
// NUNCA volta, nem para a própria empresa. Sem token (ou com erro), as notas usam a tabela genérica do IBPT.

import { useCallback, useEffect, useState } from 'react'
import { authFetch } from '@/lib/authFetch'
import { Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import AjudaCampo from '@/components/ajuda/AjudaCampo'

type Estado = {
  configurado: boolean; salvoEm: string | null; ultimaConsultaOk: string | null; ultimoErro: string | null; ultimoErroEm: string | null
  versao: string | null; vigenciaFim: string | null; usoNasNotas: boolean
  lei12741Ativo: boolean; ehSimples: boolean; pctTributosSn: number | null
  generica: { versao: string | null; vigenciaFim: string | null } | null
}

// Interruptor próprio (RD-96) — acessível (role=switch), funciona no toque/celular.
function Switch({ ligado, onToggle, disabled, testid }: { ligado: boolean; onToggle: () => void; disabled?: boolean; testid: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={ligado} disabled={disabled} onClick={onToggle} data-testid={testid}
      className={`relative inline-flex h-[22px] w-[40px] flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${ligado ? 'bg-[#C8941A]' : 'bg-[#3D2314]/20'}`}
    >
      <span className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition-transform ${ligado ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}
type Teste = {
  tipo: 'produto' | 'servico'; codigo: string; uf: string; descricao: string; ok: boolean; erro: string | null
  nacional: number | null; importado: number | null; estadual: number | null; municipal: number | null
  versao: string | null; vigenciaInicio: string | null; vigenciaFim: string | null; fonte: string | null
  generica: { federal: number; estadual: number; municipal: number; versao: string | null } | null
}

const dm = (s: string | null | undefined) => {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? s + 'T12:00:00' : s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: s.length === 10 ? 'numeric' : undefined })
}
const pct = (n: number | null) => (n == null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`)

export default function IbptTokenCard({ companyId }: { companyId: string }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const [token, setToken] = useState('')
  const [trocando, setTrocando] = useState(false)
  const [fase, setFase] = useState<'ocioso' | 'testando' | 'removendo' | 'atualizando'>('ocioso')
  const [salvando, setSalvando] = useState<'lei12741Ativo' | 'ibptEmpresaNasNotas' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [teste, setTeste] = useState<{ generico: boolean; testes: Teste[] } | null>(null)

  const carregar = useCallback(async () => {
    const r = await authFetch(`/api/fiscal/ibpt-token?companyId=${encodeURIComponent(companyId)}`, { cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as (Estado & { ok?: boolean }) | null
    if (j?.ok) setEstado(j)
  }, [companyId])
  useEffect(() => { void carregar() }, [carregar])

  async function salvarETestar() {
    setFase('testando'); setMsg(null); setTeste(null)
    try {
      const r = await authFetch('/api/fiscal/ibpt-token', { method: 'POST', body: JSON.stringify({ companyId, token }) })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; mensagem?: string; generico?: boolean; testes?: Teste[] } | null
      if (r.ok && j?.ok && j.testes?.length) {
        setTeste({ generico: !!j.generico, testes: j.testes })
        setMsg({ ok: true, texto: 'Token salvo. O IBPT respondeu à consulta de teste.' })
        setToken(''); setTrocando(false)
        await carregar()
      } else {
        setMsg({ ok: false, texto: j?.mensagem ?? 'Não foi possível testar o token.' })
      }
    } finally { setFase('ocioso') }
  }

  async function remover() {
    if (!window.confirm('Remover o token do IBPT? As notas voltam a usar a tabela genérica do IBPT.')) return
    setFase('removendo'); setMsg(null); setTeste(null)
    try {
      const r = await authFetch('/api/fiscal/ibpt-token', { method: 'DELETE', body: JSON.stringify({ companyId }) })
      setMsg(r.ok ? { ok: true, texto: 'Token removido. As notas usam a tabela genérica.' } : { ok: false, texto: 'Não foi possível remover.' })
      await carregar()
    } finally { setFase('ocioso') }
  }

  // #bug NFS-e "sem tributos aproximados" · reconsulta o IBPT com o token já salvo e repopula o cache, sem trocar o token.
  async function atualizarAgora() {
    setFase('atualizando'); setMsg(null); setTeste(null)
    try {
      const r = await authFetch('/api/fiscal/ibpt-token', { method: 'PUT', body: JSON.stringify({ companyId }) })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; mensagem?: string; atualizados?: number; vigenciaFim?: string | null } | null
      if (r.ok && j?.ok) {
        setMsg({ ok: true, texto: `Tributos do IBPT atualizados (${j.atualizados ?? 0} ${j.atualizados === 1 ? 'código' : 'códigos'})${j.vigenciaFim ? ` · vigência até ${dm(j.vigenciaFim)}` : ''}.` })
        await carregar()
      } else {
        setMsg({ ok: false, texto: j?.mensagem ?? 'Não foi possível atualizar o IBPT agora.' })
      }
    } finally { setFase('ocioso') }
  }

  // #11321 · liga/desliga, por empresa, a Lei 12.741 nas notas e (regime normal) o uso do token.
  async function salvarToggle(campo: 'lei12741Ativo' | 'ibptEmpresaNasNotas', valor: boolean) {
    setSalvando(campo); setMsg(null)
    try {
      const r = await authFetch('/api/fiscal/ibpt-token', { method: 'PATCH', body: JSON.stringify({ companyId, [campo]: valor }) })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; mensagem?: string } | null
      if (r.ok && j?.ok) await carregar()
      else setMsg({ ok: false, texto: j?.mensagem ?? 'Não foi possível salvar.' })
    } finally { setSalvando(null) }
  }

  const gen = estado?.generica
  const mostrarCampo = !estado?.configurado || trocando

  return (
    <div className="bg-white border border-[#3D2314]/10 rounded-xl px-4 py-4 space-y-3" data-testid="ibpt-token-card">
      <div>
        <div className="text-[14px] font-medium text-[#3D2314]">Tributos aproximados (IBPT · Lei 12.741)</div>
        <div className="text-[12px] mt-1" data-testid="ibpt-estado">
          {!estado ? <span className="text-[#3D2314]/50">Carregando…</span>
            : !estado.configurado ? (
              <span className="text-[#3D2314]/70">Sem token — usando a tabela genérica do IBPT{gen?.versao ? ` (versão ${gen.versao}, vale até ${dm(gen.vigenciaFim)})` : ''}.</span>
            ) : estado.ultimoErro && (!estado.ultimaConsultaOk || (estado.ultimoErroEm ?? '') > estado.ultimaConsultaOk) ? (
              <span className="text-[#791F1F]">Token com erro: {estado.ultimoErro} — usando a tabela genérica.</span>
            ) : (
              <span className="text-[#234D08]">
                Token configurado em {dm(estado.salvoEm)}
                {estado.ultimaConsultaOk ? ` · última consulta OK em ${new Date(estado.ultimaConsultaOk).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
                {estado.versao ? ` · versão ${estado.versao}${estado.vigenciaFim ? `, vale até ${dm(estado.vigenciaFim)}` : ''}` : ''}
              </span>
            )}
        </div>
      </div>

      {/* #11321 · liga/desliga o "valor aproximado dos tributos" (Lei 12.741) nas notas, por empresa. */}
      {estado && (
        <div className="border-t border-[#3D2314]/10 pt-3 space-y-2.5" data-testid="ibpt-toggles">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 text-[13px] text-[#3D2314]">
              Mostrar os tributos aproximados nas notas (Lei 12.741)
              <AjudaCampo chave="fiscal.config.lei12741_ativo" />
            </div>
            <div className="flex items-center gap-2">
              {salvando === 'lei12741Ativo' && <Loader2 size={13} className="animate-spin text-[#3D2314]/50" />}
              <Switch ligado={estado.lei12741Ativo} disabled={salvando !== null} testid="ibpt-toggle-lei12741"
                onToggle={() => void salvarToggle('lei12741Ativo', !estado.lei12741Ativo)} />
            </div>
          </div>
          <div className="text-[11px] text-[#3D2314]/55 flex items-start gap-1.5"><Info size={12} className="mt-0.5 flex-shrink-0" />
            <span>
              Só aparece em vendas a <strong>consumidor final</strong> — em nota a contribuinte não sai.
              {estado.ehSimples
                ? ` No Simples, usa o percentual cadastrado${estado.pctTributosSn != null ? ` (${pct(estado.pctTributosSn)})` : ''}.`
                : ' No regime normal, usa a tabela/token do IBPT.'}
            </span>
          </div>

          {!estado.ehSimples && (
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <div className="flex items-center gap-1 text-[13px] text-[#3D2314]">
                Usar o token da empresa nas notas
                <AjudaCampo chave="fiscal.config.ibpt_empresa_nas_notas" />
                {(!estado.configurado || !estado.ultimaConsultaOk) && <span className="text-[11px] text-[#3D2314]/45">(configure e teste o token abaixo)</span>}
              </div>
              <div className="flex items-center gap-2">
                {salvando === 'ibptEmpresaNasNotas' && <Loader2 size={13} className="animate-spin text-[#3D2314]/50" />}
                <Switch ligado={estado.usoNasNotas} disabled={salvando !== null || !estado.configurado || !estado.ultimaConsultaOk} testid="ibpt-toggle-usar-token"
                  onToggle={() => void salvarToggle('ibptEmpresaNasNotas', !estado.usoNasNotas)} />
              </div>
            </div>
          )}
        </div>
      )}

      {mostrarCampo ? (
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[11px] text-[#3D2314]/60 mb-1">Token do IBPT</span>
            <input
              type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
              placeholder="cole aqui o token da empresa" data-testid="ibpt-token-input"
              className="w-full bg-white border border-[#3D2314]/15 rounded-md px-3 py-2 text-[13px] text-[#3D2314] font-mono"
            />
          </label>
          <div className="text-[11px] text-[#3D2314]/55">Gere em deolhonoimposto.ibpt.org.br › Gerenciar empresa, com o CNPJ desta empresa.</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void salvarETestar()} disabled={fase !== 'ocioso' || token.trim().length < 10} data-testid="ibpt-salvar-testar"
              className="px-4 py-2 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center gap-2">
              {fase === 'testando' && <Loader2 size={14} className="animate-spin" />} Salvar e testar
            </button>
            {trocando && <button type="button" onClick={() => { setTrocando(false); setToken('') }} className="px-3 py-2 rounded-md border border-[#3D2314]/15 text-[13px] text-[#3D2314]">Cancelar</button>}
          </div>
        </div>
      ) : (
        <div className="flex gap-2 items-center flex-wrap">
          <button type="button" onClick={() => void atualizarAgora()} disabled={fase !== 'ocioso'} data-testid="ibpt-atualizar"
            className="px-3 py-2 rounded-md bg-[#C8941A] text-[#3D2314] font-medium text-[13px] hover:bg-[#B07F12] disabled:opacity-50 inline-flex items-center gap-2">
            {fase === 'atualizando' && <Loader2 size={14} className="animate-spin" />} Atualizar agora
          </button>
          <AjudaCampo chave="fiscal.config.ibpt_atualizar_agora" />
          <button type="button" onClick={() => { setTrocando(true); setMsg(null) }} data-testid="ibpt-trocar" className="px-3 py-2 rounded-md border border-[#3D2314]/15 text-[13px] text-[#3D2314] hover:bg-[#3D2314]/5">Trocar</button>
          <button type="button" onClick={() => void remover()} disabled={fase !== 'ocioso'} data-testid="ibpt-remover" className="px-3 py-2 rounded-md border border-[#C94544]/40 text-[13px] text-[#791F1F] hover:bg-[#FCEBEB] disabled:opacity-50">Remover</button>
        </div>
      )}

      {msg && (
        <div className={`flex items-start gap-2 text-[12px] ${msg.ok ? 'text-[#234D08]' : 'text-[#791F1F]'}`} data-testid="ibpt-msg">
          {msg.ok ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}<span>{msg.texto}</span>
        </div>
      )}
      {teste && (
        <div className="rounded-md bg-[#EAF3DE] border border-[#3B6D11]/25 px-3 py-2 text-[12px] text-[#234D08] space-y-1.5" data-testid="ibpt-teste-resultado">
          {teste.generico && <div className="text-[#8A5A00]">Teste genérico: a empresa não tem produto nem serviço cadastrado, então consultamos um código padrão.</div>}
          {teste.testes.map((t) => (
            <div key={`${t.tipo}-${t.codigo}`} data-testid={`ibpt-teste-${t.tipo}`}>
              <div className="font-medium">{t.tipo === 'produto' ? 'Produto NCM' : 'Serviço LC 116'} {t.codigo} · {t.uf} · {t.descricao}</div>
              {t.ok ? (
                <div>IBPT (token da empresa): Nacional {pct(t.nacional)} · Importado {pct(t.importado)} · Estadual {pct(t.estadual)} · Municipal {pct(t.municipal)}{t.versao ? ` · versão ${t.versao}` : ''}{t.vigenciaFim ? ` · até ${dm(t.vigenciaFim)}` : ''}</div>
              ) : <div className="text-[#791F1F]">IBPT não respondeu para este item: {t.erro}</div>}
              <div className="text-[#3D2314]/70">Tabela genérica (usada hoje nas notas): {t.generica ? `Federal ${pct(t.generica.federal)} · Estadual ${pct(t.generica.estadual)} · Municipal ${pct(t.generica.municipal)}${t.generica.versao ? ` · versão ${t.generica.versao}` : ''}` : 'sem linha para este código'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
