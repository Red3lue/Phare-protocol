export const metadata = {
    title: "Phare reporter",
    description: "Bonded vessel sighting submission"
};

export default function RootLayout({children}: {children: React.ReactNode}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
