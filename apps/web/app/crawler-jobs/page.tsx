import { CrawlerJobsPage } from "@/widgets/crawler-jobs";
import { Sidebar } from "@/widgets/sidebar";

export default function CrawlerJobsRoute() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <CrawlerJobsPage />
    </div>
  );
}
