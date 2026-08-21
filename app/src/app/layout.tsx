import type { Metadata } from 'next';
import '../../pl-design-system/styles/globals.scss';
import './app.scss';
import { ToastProvider } from '@/components/Toasts';
import { AppNav } from '@/components/AppNav';
import { Analytics } from '@/components/Analytics';

export const metadata: Metadata = {
  title: 'Roadmapper',
  description: 'Simple shareable product roadmaps for PL Network teams',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <Analytics />
          <AppNav />
          <main className="app-main">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
