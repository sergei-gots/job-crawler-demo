import { ProfilePage as Profile } from "@/widgets/profile";
import { Sidebar } from "@/widgets/sidebar";

export default function ProfileRoute() {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <Profile />
    </div>
  );
}
