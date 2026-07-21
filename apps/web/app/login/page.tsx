import { LoginForm } from "@/features/auth";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-1 items-start justify-start p-8 md:p-16">
      <LoginForm />
    </div>
  );
}
