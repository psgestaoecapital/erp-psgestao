// CPF: só dígitos + dígitos verificadores (a mesma regra de public.fn__cpf_valido no banco).
export const soDigitosCpf = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

export function cpfValido(v: string | null | undefined): boolean {
  const d = soDigitosCpf(v)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n: number) => {
    let s = 0
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i)
    const r = (s * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

/** 52998224725 → 529.982.247-25 (enquanto digita, formata o que já tem). */
export function mascaraCpf(v: string): string {
  const d = soDigitosCpf(v).slice(0, 11)
  return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2')
}
