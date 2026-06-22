import type { LucideIcon } from 'lucide-react';

type Feature = { title: string; desc: string };

export default function OdontoEmptyState({
  eyebrow, title, subtitle, Icon, features, cta,
}: { eyebrow: string; title: string; subtitle: string; Icon: LucideIcon; features: Feature[]; cta?: string }) {
  return (
    <div className="min-h-[calc(100vh-120px)] bg-[#FAF7F2] px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-[#8A7765]">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-semibold text-[#3D2314] md:text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-[#8A7765]">{subtitle}</p>

        <div className="mt-7 rounded-2xl border border-[#E7DDCF] bg-[#FFFDFA] p-6 shadow-[0_8px_24px_rgba(61,35,20,0.06)] md:p-8">
          <div className="flex flex-col items-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-[#F6ECD6] text-[#C8941A]">
              <Icon size={30} strokeWidth={1.8} />
            </div>
            <p className="mt-4 max-w-md text-sm text-[#5A3A28]">
              Ainda sem dados. Conforme você usa, tudo aparece aqui — organizado e no celular.
            </p>
            {cta ? (
              <button disabled className="mt-4 cursor-not-allowed rounded-lg bg-[#3D2314]/30 px-4 py-2 text-sm font-semibold text-white">
                {cta} <span className="ml-1 text-xs opacity-80">· em breve</span>
              </button>
            ) : null}
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-[#EDE5D8] bg-white p-4">
                <p className="text-sm font-semibold text-[#3D2314]">{f.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#8A7765]">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-[#8A7765]">
          O financeiro desta clínica fica na área <span className="font-semibold text-[#5A3A28]">Gestão Empresarial</span> — troque de área no topo do menu.
        </p>
      </div>
    </div>
  );
}
