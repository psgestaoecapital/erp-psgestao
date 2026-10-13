// Versão do bundle em execução (build id), para carimbar TODO evento de telemetria (P0 · item 3).
// Vercel injeta NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA no build; fora da Vercel cai em 'dev'. Curto (12).
// É inlinado no build (env NEXT_PUBLIC_*), então é o mesmo para todo o bundle servido — é isso que
// queremos: saber de QUAL deploy veio cada evento (celular preso em bundle antigo aparece aqui).
export const BUNDLE_VERSION: string =
  (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'dev').slice(0, 12)
