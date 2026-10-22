// Cliente do Web Push (chamado #120 · custo zero): suporte, permissão, assinatura e preferência.
// A chave pública VAPID vem de NEXT_PUBLIC_VAPID_PUBLIC_KEY (o CEO cadastra); sem ela o toggle fica indisponível.
import { supabase } from '@/lib/supabase'

export const TIPO_ETAPA = 'oportunidade_etapa'

export type EstadoPush = 'sem_suporte' | 'ios_instalar' | 'sem_chave' | 'negado' | 'desligado' | 'ligado'

export function chavePublica(): string {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
}

export function ehIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function instaladoComoApp(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export function urlBase64ParaUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

function b64url(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function estadoAtual(): Promise<EstadoPush> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iPhone no Safari comum (fora da tela de início) não expõe PushManager: orienta a instalar.
    return ehIos() && !instaladoComoApp() ? 'ios_instalar' : 'sem_suporte'
  }
  if (ehIos() && !instaladoComoApp()) return 'ios_instalar'
  if (!chavePublica()) return 'sem_chave'
  if (Notification.permission === 'denied') return 'negado'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'ligado' : 'desligado'
}

export async function ligar(userId: string, companyId: string): Promise<EstadoPush> {
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'negado' : 'desligado'
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ParaUint8(chavePublica()) as unknown as BufferSource,
  }))
  const { error } = await supabase.from('erp_push_assinatura').upsert({
    user_id: userId, company_id: companyId, endpoint: sub.endpoint,
    p256dh: b64url(sub.getKey('p256dh')), auth: b64url(sub.getKey('auth')),
    user_agent: navigator.userAgent.slice(0, 200), ativo: true,
  }, { onConflict: 'endpoint' })
  if (error) throw error
  await supabase.from('erp_push_preferencia').upsert({ user_id: userId, tipo: TIPO_ETAPA, ativo: true }, { onConflict: 'user_id,tipo' })
  return 'ligado'
}

export async function desligar(userId: string): Promise<EstadoPush> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await supabase.from('erp_push_assinatura').delete().eq('endpoint', sub.endpoint).eq('user_id', userId)
    await sub.unsubscribe().catch(() => { /* já expirada */ })
  }
  return 'desligado'
}
