import "./globals.css";
import { ToastHost } from "@/components/ToastHost";

export const runtime = "edge";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
