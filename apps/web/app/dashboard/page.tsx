import { Dashboard } from "@/widgets/dashboard";
import { Sidebar } from "@/widgets/sidebar";

export default function DashboardPage() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <Dashboard />
    </div>
  );
}
