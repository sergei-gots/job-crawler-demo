import { SourcesPage } from "@/widgets/sources";
import { Sidebar } from "@/widgets/sidebar";

export default function SourcesRoute() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <SourcesPage />
    </div>
  );
}
