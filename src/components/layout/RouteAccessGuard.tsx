'use client'

// F2 · BLOQUEIO DE ROTA POR PAPEL (emergência LGPD/acesso — msg eng_chefe c910e458, fatia F2).
//
// A F1 esconde do MENU as seções que o papel do usuário não libera. Mas abrir a tela pela URL
// (digitando a rota) ainda renderizava a seção — o vazamento continuava para quem conhece o caminho.
// Esta guarda fecha isso no cliente, com a MESMA regra do menu (RD-71: uma fonte de verdade):
// pergunta ao servidor `fn_pode_acessar_rota(rota, área, empresa, usuário)` — que só libera a rota
// se o MÓDULO dono dela está no menu autorizado do papel (fn_modulos_sidebar_por_area).
//
// Decisões (revisão do Eng. Chefe):
//  * A RLS e as 11 funções de guarda (RD-91) continuam sendo a parede REAL do dado — intocadas.
//    Esta guarda é defesa em profundidade na CAMADA DE ROTA/aparência (não substitui a RLS).
//  * Fail-closed no VEREDITO: papel ativo + rota de seção não liberada => mostra "Acesso restrito"
//    no lugar da tela (nunca tela vazia — RD-51; há sempre o caminho de volta ao Início).
//  * RD-97: usuário SEM papel ativo → a RPC devolve true (nada muda). Equipe PS vê tudo.
//  * Não derruba o dashboard: a verificação corre com prazo+retry (comPrazo, padrão do app). Se a
//    RPC falhar de vez (rede/trava), a guarda NÃO bloqueia a navegação (a RLS segue protegendo o
//    dado) e registra o erro — em vez de prender toda a navegação num soluço de rede.
//  * Enquanto verifica (rota ainda sem veredito em cache), renderiza a tela; só troca para o
//    bloqueio quando a RPC diz, explicitamente, que a rota é restrita (FALSE).

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { comPrazo } from '@/lib/comPrazo'
import { useUsuario } from '@/lib/AuthProvider'

const EMPRESA_STORAGE_KEY = 'ps_empresa_sel'
const AREA_STORAGE_KEY = 'ps_area_sel'

function resolveCompanyId(): string | null {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(EMPRESA_STORAGE_KEY)
  // Sem empresa única (consolidado/grupo) não há papel por empresa a avaliar → libera (a RPC também).
  if (!v || v === 'consolidado' || v.startsWith('group_')) return null
  return v
}

function resolveArea(searchArea: string | null): string | null {
  if (searchArea) return searchArea
  if (typeof window === 'undefined') return null
  try { return localStorage.getItem(AREA_STORAGE_KEY) } catch { return null }
}

// Cache por (usuário|empresa|área|rota) — evita repetir a RPC a cada re-render ou ao voltar numa rota já vista.
// `true` = liberado, `false` = restrito. Ausente = ainda não verificado (render otimista da tela).
const cache = new Map<string, boolean>()

export default function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || ''
  const searchParams = useSearchParams()
  const router = useRouter()
  const { userId } = useUsuario()
  // só serve para re-renderizar quando o veredito assíncrono chega ao cache.
  const [, forcarRender] = useState(0)
  // id da verificação em curso — descarta resposta tardia de uma rota que o usuário já deixou.
  const execId = useRef(0)

  const area = resolveArea(searchParams?.get('area') ?? null)
  const companyId = resolveCompanyId()

  // Precisa checar? (fora disso a rota é sempre liberada: sem usuário, raiz do dashboard, ou sem área situável)
  const precisaChecar = !!userId && pathname.startsWith('/dashboard') && pathname !== '/dashboard' && !!area
  const chave = precisaChecar ? `${userId}|${companyId ?? ''}|${area}|${pathname}` : null

  useEffect(() => {
    if (!chave || cache.has(chave)) return
    const id = ++execId.current
    void (async () => {
      try {
        const { data, error } = await comPrazo(
          async () => await supabase.rpc('fn_pode_acessar_rota', {
            p_rota: pathname, p_area_id: area, p_company_id: companyId, p_user_id: userId,
          }),
          { ms: 6000, tentativas: 1, label: 'pode_acessar_rota' },
        )
        if (id !== execId.current) return // rota mudou no meio — ignora
        if (error) {
          // Fail-safe de disponibilidade: não derruba a navegação num erro de RPC (a RLS protege o dado).
          console.warn('[route-guard] fn_pode_acessar_rota falhou · libera e registra', error.message)
          forcarRender((n) => n + 1)
          return
        }
        cache.set(chave, data !== false) // só bloqueia no FALSE explícito
        forcarRender((n) => n + 1)
      } catch (e) {
        if (id !== execId.current) return
        console.warn('[route-guard] verificação de acesso indisponível · libera', e instanceof Error ? e.message : String(e))
        forcarRender((n) => n + 1)
      }
    })()
  }, [chave, pathname, area, companyId, userId])

  // Bloqueia só quando o veredito em cache é, explicitamente, FALSE. Ausente/true/sem-checagem → mostra a tela.
  if (chave && cache.get(chave) === false) {
    return (
      <div
        role="alert"
        style={{
          maxWidth: 560, margin: '48px auto 0', padding: 'clamp(20px, 5vw, 32px)',
          background: '#FFFFFF', border: '1px solid #E0D8CC', borderRadius: 14,
          textAlign: 'center', color: '#3D2314',
        }}
      >
        <div
          style={{
            width: 56, height: 56, margin: '0 auto 16px', borderRadius: '50%',
            background: '#FAF0DF', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-hidden="true"
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#C8941A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Acesso restrito à sua função</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: '#6B5D4F', margin: '0 0 20px' }}>
          Esta área não faz parte das telas liberadas para a sua função nesta empresa. Se você precisa
          acessá-la, fale com o administrador da sua empresa para ajustar o seu papel.
        </p>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          style={{
            appearance: 'none', border: 'none', cursor: 'pointer',
            background: '#3D2314', color: '#FFFFFF', fontWeight: 600, fontSize: 14,
            padding: '11px 22px', borderRadius: 10,
          }}
        >
          Voltar ao início
        </button>
      </div>
    )
  }

  return <>{children}</>
}
