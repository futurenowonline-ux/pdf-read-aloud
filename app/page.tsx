import PdfReader from '@/components/PdfReader';

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">PDF Voice Reader</h1>
        <p className="text-zinc-400 mt-2">Upload a PDF to listen with live sentence tracking</p>
      </div>
      <PdfReader />
    </main>
  );
}
