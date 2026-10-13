import { CronometroGlobal } from "@/components/pm/CronometroGlobal";

// PM-T (1): o cronômetro global fica fixo no topo de toda tela de /dashboard/pm/*.
export default function PmLayout({ children }: { children: React.ReactNode }) {
  return (<><CronometroGlobal />{children}</>);
}
