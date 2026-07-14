import './globals.css';

export const metadata = {
  title: '中職對戰｜文字棒球對決',
  description: '線上雙人即時對戰的逐球猜球心理戰棒球遊戲',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body className="bg-field-night text-field-chalk min-h-screen">{children}</body>
    </html>
  );
}
