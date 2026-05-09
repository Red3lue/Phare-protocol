import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Archivo_Black } from 'next/font/google';
import './globals.css';

const sans = Inter({
    subsets: ['latin'],
    variable: '--font-sans',
    display: 'swap',
});

const mono = JetBrains_Mono({
    subsets: ['latin'],
    variable: '--font-mono',
    display: 'swap',
});

const display = Archivo_Black({
    subsets: ['latin'],
    weight: '400',
    variable: '--font-display',
    display: 'swap',
});

export const metadata: Metadata = {
    title: 'Phare — bonded sighting registry',
    description: 'Citizen-funded sentinel network for sanctioned tankers',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
            <body>{children}</body>
        </html>
    );
}
