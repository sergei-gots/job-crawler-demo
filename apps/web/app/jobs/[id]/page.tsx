import { JobDetailPage } from "@/widgets/job-detail";
import { Sidebar } from "@/widgets/sidebar";

export default async function JobDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <JobDetailPage jobId={Number(id)} />
    </div>
  );
}
