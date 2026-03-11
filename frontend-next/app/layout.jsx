import './globals.css';

export const metadata = {
  title: 'Quantum-Aero F1 | Next Dark Dashboard',
  description: 'Next.js dark-mode dashboard for VLM + CFD + Quantum F1 optimization',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
