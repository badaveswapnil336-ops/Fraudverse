import { AdvisorConsole } from "@/components/AdvisorConsole";
import { Sidebar } from "@/components/Sidebar";

export default function AdvisorPage() {
  return (
    <div className="relative z-10 flex min-h-screen gap-4 p-4">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <AdvisorConsole />
      </main>
    </div>
  );
}
