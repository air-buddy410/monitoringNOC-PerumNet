import { redirect } from "next/navigation";

// Registrasi publik ditutup — akun dibuat oleh admin lewat pengelolaan user.
// Halaman ini dipertahankan agar deep-link/browser-cache tidak error.
export default function RegisterPage() {
  redirect("/login");
}
