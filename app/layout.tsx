import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Voice Reader",
  description: "Upload a PDF and listen to it read aloud",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
