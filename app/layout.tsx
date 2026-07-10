import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Word Art Engine",
  description: "Turn a photo into SVG word art built from the names of its parts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
