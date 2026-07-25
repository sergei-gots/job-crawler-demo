import { JobsPage } from "@/widgets/jobs";
import { Sidebar } from "@/widgets/sidebar";

export default function JobsRoute() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <JobsPage />
    </div>
  );
}
