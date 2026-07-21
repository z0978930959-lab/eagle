import './globals.css';

export const metadata = {
  title: '資訊軟體開發',
  description: '專案模組整合與進度管理工具',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-Hant">
      <body className="bg-field-night text-field-chalk min-h-screen">{children}</body>
    </html>
  );
}
