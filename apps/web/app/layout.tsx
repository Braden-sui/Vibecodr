import "./globals.css";
import { ToastHost } from "@/components/ToastHost";

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
