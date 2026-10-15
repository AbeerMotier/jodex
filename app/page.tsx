import { redirect } from 'next/navigation';

// التوجيه حسب الدور يتم في proxy.ts؛ هذا احتياط فقط
export default function Home() {
  redirect('/login');
}
