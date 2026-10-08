'use client'
import { useCallback, useEffect, useState } from 'react'
import { EHS_LANGS, EHS_LANG_KEY, ehsT, type EhsLang } from './i18n'

export function useEhsLang() {
  const [lang, setLangState] = useState<EhsLang>('pt')
  useEffect(() => {
    try {
      const v = localStorage.getItem(EHS_LANG_KEY) as EhsLang | null
      if (v && EHS_LANGS.includes(v)) setLangState(v)
    } catch {}
  }, [])
  const setLang = useCallback((l: EhsLang) => {
    setLangState(l)
    try { localStorage.setItem(EHS_LANG_KEY, l) } catch {}
  }, [])
  const t = useCallback((chave: string) => ehsT(lang, chave), [lang])
  return { lang, setLang, t }
}
