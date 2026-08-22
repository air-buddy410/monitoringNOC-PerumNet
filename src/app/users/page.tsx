import type { Metadata } from "next";
import TvTokenManager from "@/components/tv/tv-token-manager";
import UserTable from "@/components/users/user-table";

export const metadata: Metadata = {
  title: "Manajemen Pengguna • PerumNet NOC",
  description: "Daftar pengguna aplikasi beserta peran RBAC PerumNet.",
};

export default function UsersPage() {
  return (
    <main className="noc-page">
      <div className="noc-page-intro"><div><h1>Manajemen pengguna</h1><p>Kontrol akses berbasis peran untuk tim PerumNet.</p></div></div>
      <section>
        <UserTable />
      </section>
      <section className="noc-tv-token-section" aria-label="Manajemen token wallboard TV">
        <TvTokenManager />
      </section>
    </main>
  );
}
